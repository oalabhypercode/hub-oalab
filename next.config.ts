import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pages visited in the last 30 s open from the browser's cache; Server Actions clear it (lib/refresh-workspace.ts).
  experimental: { staleTimes: { dynamic: 30 } },
  // Local demo credentials must never be copied into a deployment artifact.
  outputFileTracingExcludes: { "/*": ["./.demo-accounts.local.json"] },
};

export default nextConfig;
