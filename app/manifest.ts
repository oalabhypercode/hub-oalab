import type { MetadataRoute } from "next";
import { webAppManifest } from "@/lib/web-app/rules";

/**
 * The hub as an installable web app (plan of 16.11.2026, stage 1), served at /manifest.webmanifest. proxy.ts leaves
 * that address out: browsers fetch the manifest without cookies. The content lives in lib/web-app/rules.ts (tested).
 */
export default function manifest(): MetadataRoute.Manifest {
  return webAppManifest();
}
