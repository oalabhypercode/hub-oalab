import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Local demo credentials must never be copied into a deployment artifact.
  outputFileTracingExcludes: { "/*": ["./.demo-accounts.local.json"] },
};

export default nextConfig;
