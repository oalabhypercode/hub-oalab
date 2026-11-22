/**
 * The images the notes store in the hub's own storage (bucket hub-files): uploaded covers as
 * `notes/<customer>/<id>.webp` and the previews of link cards as `notes/<customer>/links/<id>.webp`
 * (lib/hub-notes/write.ts). An image may go once nothing names it any more: no page of its customer, also in the
 * trash, and no version in a page's history, so „Verlauf → Diese Fassung wiederherstellen“ always finds its image.
 * Covers never are in the history (it keeps title, symbol, audience and document), so for them only the pages count.
 *
 * Only the customer's own pages count: a card copied to another customer's page keeps the path, but the hub signs
 * pictures only from the page's own customer (lib/hub-notes/refs.ts), so it shows none there anyway.
 *
 * The documents never leave the database: the statements below look into them there and hand back names only. The
 * sweep itself is lib/hub-notes/sweep.ts. Self-contained so tests load it directly.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FOLDER = new RegExp(`^${UUID}$`);

/**
 * How long an image may lie in storage without a page or version naming it. A link card's preview is stored the
 * moment the card goes in, and the page saves it a second later; a day leaves room for a browser that could not save
 * for a while, or the undo of a card just removed.
 */
export const NOTE_IMAGE_GRACE_HOURS = 24;

/** How often the hub's schedule (every five minutes, app/api/notifications/sweep) also looks for unused images. */
export const NOTE_IMAGE_SWEEP_HOURS = 6;

/** A folder `notes/<customer>/` as the hub names it: the customer's id in small letters. */
export const isNoteImageFolder = (value: unknown): value is string => typeof value === "string" && FOLDER.test(value);

/** The customers whose folder holds an image older than the grace period. Parameters: bucket, hours. */
export const NOTE_IMAGE_FOLDERS_SQL = `select distinct split_part(o.name, '/', 2) as customer
  from storage.objects o
 where o.bucket_id = $1 and starts_with(o.name, 'notes/') and o.created_at < now() - make_interval(hours => $2::int)`;

/**
 * Every object in one customer's folder, with whether something names it: the cover of a page of that customer (also
 * in the trash), a link card anywhere in such a page's document (in callouts, lists, tables and toggles too), or a
 * link card in a version of such a page. The names in use are gathered once and joined, never once per object.
 * Parameters: bucket, customer id, `notes/<customer>/`.
 */
export const NOTE_IMAGES_SQL = `with used as (
  select p.cover_value as name
    from public.hub_note_pages p
   where p.customer_id = $2::uuid and p.cover_kind = 'upload'
  union
  select card -> 'attrs' ->> 'image'
    from public.hub_note_pages p
   cross join lateral jsonb_path_query(p.content, 'lax $.** ? (@.type == "noteLinkCard")') as found (card)
   where p.customer_id = $2::uuid and jsonb_typeof(card) = 'object'
  union
  select card -> 'attrs' ->> 'image'
    from public.hub_note_revisions r
    join public.hub_note_pages p on p.id = r.page_id
   cross join lateral jsonb_path_query(r.content, 'lax $.** ? (@.type == "noteLinkCard")') as found (card)
   where p.customer_id = $2::uuid and jsonb_typeof(card) = 'object'
)
select o.name, o.created_at, u.name is not null as used
  from storage.objects o
  left join used u on u.name = o.name
 where o.bucket_id = $1 and starts_with(o.name, $3::text)
 order by o.created_at`;

export type StoredNoteImage = { name: string; created_at: Date | string; used: boolean | null };

/**
 * The images of one customer's folder that may go: a cover or link preview the hub stored there, older than the grace
 * period, that nothing names. Anything else in the folder, or a row without a clear answer, stays.
 */
export function removableNoteImages(rows: readonly StoredNoteImage[], customerId: string, now = Date.now()): string[] {
  if (!isNoteImageFolder(customerId)) return [];
  const stored = new RegExp(`^notes/${customerId}/(links/)?${UUID}\\.webp$`);
  const latest = now - NOTE_IMAGE_GRACE_HOURS * 3_600_000;
  return rows.filter((row) => row.used === false && stored.test(row.name) && new Date(row.created_at).getTime() < latest).map((row) => row.name);
}
