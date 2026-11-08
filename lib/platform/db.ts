import "server-only";
import { readFileSync } from "node:fs";
import pg from "pg";
import type { RuntimeEnvironment } from "./config";

// The Hub's direct line to PostgreSQL on the own platform: login tables (`auth`) and the storage catalog. Table data
// goes through PostgREST instead. Connects as the app role like Service OALab (same DATABASE_URL, OALAB_DATABASE_HOST
// and CA); work for a person runs under `authenticated` with their claims, so the catalog's RLS decides.

export type Claims = Record<string, unknown>;
export type DbRole = "anon" | "authenticated" | "service_role";

type PoolGlobal = { oalabHubPool?: pg.Pool };
const poolGlobal = globalThis as typeof globalThis & PoolGlobal;

export function platformPool(): pg.Pool {
  poolGlobal.oalabHubPool ??= createPool(process.env);
  return poolGlobal.oalabHubPool;
}

function createPool(env: RuntimeEnvironment) {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error("OALAB_PLATFORM=own requires DATABASE_URL.");
  const url = new URL(raw);
  if (/\.supabase\.(co|com)$/u.test(url.hostname)) throw new Error("OALAB_PLATFORM=own cannot point at Supabase.");
  const expected = env.OALAB_DATABASE_HOST?.trim();
  if (!expected || url.hostname !== expected) throw new Error("DATABASE_URL does not match OALAB_DATABASE_HOST.");
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(parameter);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const caFile = env.OALAB_DATABASE_CA_CERT_FILE?.trim();
  const ca = (caFile ? readFileSync(caFile, "utf8") : env.OALAB_DATABASE_CA_CERT)?.trim();
  if (!local && !ca) throw new Error("OALAB_PLATFORM=own requires OALAB_DATABASE_CA_CERT for a non-local database.");
  const pool = new pg.Pool({
    application_name: "oalab-hub",
    connectionString: url.toString(),
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 4,
    options: "-c statement_timeout=8000",
  });
  pool.on("error", () => undefined);
  return pool;
}

/**
 * Runs `work` in one transaction as `role` with `claims` as `request.jwt.claims`, exactly what PostgREST sets for a
 * request: `auth.uid()`, `auth.jwt()` and every policy see the person.
 */
export async function asRole<T>(role: DbRole, claims: Claims | null, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await platformPool().connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)", [
      JSON.stringify(claims ?? { role }),
      typeof claims?.sub === "string" ? claims.sub : "",
      role,
    ]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** One statement as the app role (owner, bypasses RLS): only for the login tables and checked server work. */
export async function sql<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  return platformPool().query<Row>(text, values);
}
