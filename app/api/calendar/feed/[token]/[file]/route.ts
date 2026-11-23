import { siteOrigin } from "@/lib/site-origin";
import { feedResponse, type FeedSources } from "@/lib/hub-calendar/feed";
import { feedReady, takeFeedFetch } from "@/lib/hub-calendar/feed-store";
import { loadFeedBody } from "@/lib/hub-calendar/feed-server";

// The calendar subscription („Kalender-Abo“, 22.11.2026): Apple Kalender, Google and Outlook fetch this address on
// their own. Works without a session: the key in the address stands for one login's feed (lib/hub-calendar/feed-store.ts
// keeps only its SHA-256). Every fetch reads the appointments again with that person's rights, so new, moved and
// cancelled appointments arrive with the next fetch. The answer itself (404, 429, 503, 304, the calendar) is
// lib/hub-calendar/feed.ts feedResponse. The static segment `feed` goes before the mail links' [id].

type Params = { params: Promise<{ token: string; file: string }> };

function sources(request: Request): FeedSources {
  const origin = siteOrigin(request.headers) ?? "https://hub.oalab.de";
  return {
    ready: feedReady(),
    take: takeFeedFetch,
    body: (fetched) => loadFeedBody({ userId: fetched.userId, role: fetched.role, options: fetched.options, origin, now: Date.now() }),
  };
}

export async function GET(request: Request, { params }: Params) {
  const { token, file } = await params;
  return feedResponse(request, token, file, false, sources(request));
}

export async function HEAD(request: Request, { params }: Params) {
  const { token, file } = await params;
  return feedResponse(request, token, file, true, sources(request));
}
