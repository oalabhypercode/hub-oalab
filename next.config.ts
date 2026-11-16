import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pages visited in the last 30 s open from the browser's cache; Server Actions clear it (lib/refresh-workspace.ts).
  experimental: { staleTimes: { dynamic: 30 } },
  // The contract generator reads its Word templates from disk (lib/contract-templates/server.ts).
  outputFileTracingIncludes: { "/dashboard/**": ["./lib/contract-templates/templates/*.docx"] },
  // The dev terminal would print every Server Action call with its arguments: passwords and sign-in codes included.
  logging: { serverFunctions: false },
  // The web app's service worker (public/sw.js) is never cached on the way, so a new version reaches every phone.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
};

export default nextConfig;
