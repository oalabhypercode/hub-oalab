import "server-only";
import { AwsClient, AwsV4Signer } from "aws4fetch";
import type pg from "pg";
import { asRole, sql, type Claims, type DbRole } from "./db";

/**
 * supabase-js's `storage` for the own platform: one Garage bucket holds every logical bucket under
 * `<bucket_id>/<name>`, exactly like Service OALab (packages/media/src/object-store.ts). The `storage.objects` row is
 * written and read under the caller's role and claims, so the catalog's RLS decides as Supabase Storage's did; only
 * then are bytes moved or a short link signed. The admin client works as `service_role` like the secret key did.
 *
 * Signed browser uploads go straight to the final key with a two-hour PUT link (Supabase's lifetime). `list` asks Garage
 * for the real size, so the Hub's check after an upload sees the bytes that arrived, not what was announced.
 */

type Scope = () => Promise<{ role: DbRole; claims: Claims | null }>;
type StorageErrorShape = { name: "StorageApiError"; message: string; status: number; statusCode: string };
type FileBody = Blob | ArrayBuffer | ArrayBufferView | Buffer;
type ListOptions = { limit?: number; offset?: number; search?: string; sortBy?: { column?: string; order?: string } };

const UPLOAD_SECONDS = 2 * 60 * 60;
const TIMEOUT_MS = 30_000;
const BUCKET_ID = /^[a-z0-9][a-z0-9-]{1,62}$/u;

const storageError = (message: string, status = 400): StorageErrorShape => ({ name: "StorageApiError", message, status, statusCode: String(status) });
const notFound = () => storageError("Object not found", 404);

type StoreConfig = { endpoint: string; internal: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

function storeConfig(): StoreConfig {
  const endpoint = process.env.OALAB_OBJECT_STORAGE_ENDPOINT?.trim();
  const accessKeyId = process.env.OALAB_OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OALAB_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("The object storage is not configured (OALAB_OBJECT_STORAGE_*).");
  const publicUrl = new URL(endpoint);
  if (publicUrl.protocol !== "https:" || publicUrl.pathname !== "/") throw new Error("OALAB_OBJECT_STORAGE_ENDPOINT must be an HTTPS origin.");
  // Server-side reads and writes may take the Docker network instead of the public host (no Cloudflare round trip).
  const internal = process.env.OALAB_OBJECT_STORAGE_INTERNAL_ENDPOINT?.trim();
  const bucket = process.env.OALAB_OBJECT_STORAGE_BUCKET?.trim() || "oalab-files";
  return {
    endpoint: publicUrl.origin,
    internal: internal ? new URL(internal).origin : publicUrl.origin,
    bucket,
    region: process.env.OALAB_OBJECT_STORAGE_REGION?.trim() || "garage",
    accessKeyId,
    secretAccessKey,
  };
}

function assertName(bucketId: string, name: string) {
  if (!BUCKET_ID.test(bucketId)) throw new TypeError("bucket id is invalid.");
  if (!name || name.length > 1024 || name.startsWith("/") || name.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError("object name is invalid.");
  }
}

class Store {
  readonly #config = storeConfig();
  readonly #client = new AwsClient({ accessKeyId: this.#config.accessKeyId, secretAccessKey: this.#config.secretAccessKey, region: this.#config.region, service: "s3" });

  #key(bucketId: string, name: string) {
    assertName(bucketId, name);
    return `${bucketId}/${name}`;
  }

  #url(origin: string, key: string) {
    return `${origin}/${encodeURIComponent(this.#config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async #fetch(method: string, bucketId: string, name: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    return this.#client.fetch(this.#url(this.#config.internal, this.#key(bucketId, name)), { method, ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async put(bucketId: string, name: string, bytes: Uint8Array, contentType: string, cacheControl?: string) {
    const response = await this.#fetch("PUT", bucketId, name, { body: bytes as BodyInit, headers: { "content-type": contentType, ...(cacheControl ? { "cache-control": cacheControl } : {}) } });
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) throw new Error(`Object storage put failed with HTTP ${response.status}.`);
  }

  async get(bucketId: string, name: string) {
    const response = await this.#fetch("GET", bucketId, name);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object storage get failed with HTTP ${response.status}.`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  /** Size and type of a stored object, null when it is missing. */
  async head(bucketId: string, name: string) {
    const response = await this.#fetch("HEAD", bucketId, name);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object storage head failed with HTTP ${response.status}.`);
    return { size: Number(response.headers.get("content-length") ?? NaN), type: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  async copy(bucketId: string, from: string, to: string) {
    const source = `/${this.#config.bucket}/${this.#key(bucketId, from).split("/").map(encodeURIComponent).join("/")}`;
    const response = await this.#fetch("PUT", bucketId, to, { headers: { "x-amz-copy-source": source } });
    const text = await response.text().catch(() => "");
    if (!response.ok || text.includes("<Error>")) throw new Error(`Object storage copy failed with HTTP ${response.status}.`);
  }

  async delete(bucketId: string, name: string) {
    const response = await this.#fetch("DELETE", bucketId, name);
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok && response.status !== 404) throw new Error(`Object storage delete failed with HTTP ${response.status}.`);
  }

  async sign(method: "GET" | "PUT", bucketId: string, name: string, seconds: number, download?: string | boolean) {
    const url = new URL(this.#url(this.#config.endpoint, this.#key(bucketId, name)));
    url.searchParams.set("X-Amz-Expires", String(Math.min(Math.max(Math.trunc(seconds), 1), 7 * 24 * 60 * 60)));
    if (download) {
      const fileName = typeof download === "string" && download ? download : name.slice(name.lastIndexOf("/") + 1);
      url.searchParams.set("response-content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    }
    const signer = new AwsV4Signer({ accessKeyId: this.#config.accessKeyId, secretAccessKey: this.#config.secretAccessKey, region: this.#config.region, service: "s3", method, url: url.toString(), signQuery: true });
    return (await signer.sign()).url.toString();
  }
}

let sharedStore: Store | null = null;
const store = () => (sharedStore ??= new Store());

async function bytesOf(body: FileBody) {
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

const ORDER_COLUMNS: Record<string, string> = { name: "name", created_at: "created_at", updated_at: "updated_at", last_accessed_at: "last_accessed_at" };

class OwnBucket {
  constructor(readonly bucket: string, readonly scope: Scope) {}

  async #catalog<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const { role, claims } = await this.scope();
    return asRole(role, claims, work);
  }

  /** Names among `names` the caller may read (select policy). */
  async #readable(names: string[]) {
    const rows = await this.#catalog((client) => client.query<{ name: string }>("select name from storage.objects where bucket_id = $1 and name = any($2::text[])", [this.bucket, names]));
    return new Set(rows.rows.map((row) => row.name));
  }

  async createSignedUploadUrl(path: string, options?: { upsert?: boolean }) {
    try {
      assertName(this.bucket, path);
      // The insert policy is the upload permission; no RETURNING (that would need the read policy too).
      await this.#catalog((client) => client.query(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, '{}'::jsonb)${options?.upsert ? " on conflict (bucket_id, name) do nothing" : ""}`,
        [this.bucket, path],
      ));
      const signedUrl = await store().sign("PUT", this.bucket, path, UPLOAD_SECONDS);
      return { data: { signedUrl, token: signedUrl, path }, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }) {
    try {
      if (!(await this.#readable([path])).has(path)) return { data: null, error: notFound() };
      return { data: { signedUrl: await store().sign("GET", this.bucket, path, expiresIn, options?.download) }, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async createSignedUrls(paths: string[], expiresIn: number, options?: { download?: string | boolean }) {
    try {
      const allowed = await this.#readable(paths);
      const data = await Promise.all(paths.map(async (path) => allowed.has(path)
        ? { path, signedUrl: await store().sign("GET", this.bucket, path, expiresIn, options?.download), error: null }
        : { path, signedUrl: "", error: "Either the object does not exist or you do not have access to it" }));
      return { data, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async download(path: string) {
    try {
      if (!(await this.#readable([path])).has(path)) return { data: null, error: notFound() };
      const object = await store().get(this.bucket, path);
      if (!object) return { data: null, error: notFound() };
      return { data: new Blob([object.bytes as BlobPart], { type: object.type }), error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  /** The direct children of `prefix` the caller may read, with the size Garage reports (objects not uploaded yet are left out). */
  async list(prefix = "", options: ListOptions = {}) {
    try {
      const folder = prefix.replace(/^\/+|\/+$/gu, "");
      const start = folder ? `${folder}/` : "";
      const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
      const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
      const column = ORDER_COLUMNS[options.sortBy?.column ?? "name"] ?? "name";
      const order = options.sortBy?.order === "desc" ? "desc" : "asc";
      const rows = await this.#catalog((client) => client.query<{ id: string; name: string; metadata: Record<string, unknown> | null; created_at: Date; updated_at: Date; last_accessed_at: Date }>(
        `select id, name, metadata, created_at, updated_at, last_accessed_at from storage.objects
         where bucket_id = $1 and left(name, length($2)) = $2 and strpos(substr(name, length($2) + 1), '/') = 0
           and ($3 = '' or substr(name, length($2) + 1) ilike replace(replace(replace($3, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
         order by ${column} ${order}, name limit $4 offset $5`,
        [this.bucket, start, options.search ?? "", limit, offset],
      ));
      const items = await Promise.all(rows.rows.map(async (row) => {
        const stored = await store().head(this.bucket, row.name);
        if (!stored) return null;
        const metadata = { ...(row.metadata ?? {}), size: stored.size, mimetype: stored.type };
        if (row.metadata?.size !== stored.size || row.metadata?.mimetype !== stored.type) {
          await sql("update storage.objects set metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb, updated_at = now() where bucket_id = $1 and name = $2", [this.bucket, row.name, { size: stored.size, mimetype: stored.type }]);
        }
        return { name: row.name.slice(start.length), id: row.id, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), last_accessed_at: row.last_accessed_at.toISOString(), metadata, bucket_id: this.bucket };
      }));
      return { data: items.filter((item) => item !== null), error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async upload(path: string, body: FileBody, options: { contentType?: string; upsert?: boolean; cacheControl?: string } = {}) {
    try {
      assertName(this.bucket, path);
      const bytes = await bytesOf(body);
      const contentType = options.contentType || (body instanceof Blob && body.type) || "application/octet-stream";
      await this.#catalog(async (client) => {
        await client.query(
          `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, jsonb_build_object('size', $3::bigint, 'mimetype', $4::text))
           ${options.upsert ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()" : ""}`,
          [this.bucket, path, bytes.byteLength, contentType],
        );
        // Inside the transaction: if Garage refuses, the catalog row rolls back with it.
        await store().put(this.bucket, path, bytes, contentType, options.cacheControl ? `max-age=${options.cacheControl}` : undefined);
      });
      return { data: { path, fullPath: `${this.bucket}/${path}` }, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async remove(paths: string[]) {
    try {
      const removed = await this.#catalog((client) => client.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name", [this.bucket, paths]));
      await Promise.all(removed.rows.map((row) => store().delete(this.bucket, row.name).catch(() => undefined)));
      return { data: removed.rows.map((row) => ({ name: row.name, bucket_id: this.bucket })), error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async move(from: string, to: string) {
    try {
      assertName(this.bucket, to);
      await this.#catalog(async (client) => {
        const moved = await client.query("update storage.objects set name = $3, updated_at = now() where bucket_id = $1 and name = $2", [this.bucket, from, to]);
        if (!moved.rowCount) throw Object.assign(new Error("Object not found"), { status: 404 });
        await store().copy(this.bucket, from, to);
      });
      await store().delete(this.bucket, from).catch(() => undefined);
      return { data: { message: "Successfully moved" }, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }

  async copy(from: string, to: string) {
    try {
      assertName(this.bucket, to);
      if (!(await this.#readable([from])).has(from)) return { data: null, error: notFound() };
      await this.#catalog(async (client) => {
        await client.query(
          `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
           select bucket_id, $3, auth.uid(), auth.uid()::text, metadata from storage.objects where bucket_id = $1 and name = $2`,
          [this.bucket, from, to],
        );
        await store().copy(this.bucket, from, to);
      });
      return { data: { path: to }, error: null };
    } catch (error) {
      return { data: null, error: catalogError(error) };
    }
  }
}

function catalogError(error: unknown): StorageErrorShape {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return storageError("The resource already exists", 409);
  if (code === "42501") return storageError("new row violates row-level security policy", 403);
  if (code === "23503") return storageError("Bucket not found", 404);
  if ((error as { status?: number } | null)?.status === 404) return notFound();
  return storageError(error instanceof Error ? error.message : "Storage request failed", 500);
}

export function ownStorage(scope: Scope) {
  return { from: (bucket: string) => new OwnBucket(bucket, scope) };
}
