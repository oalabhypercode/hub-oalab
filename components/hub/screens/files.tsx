"use client";

import { AssetManagement } from "./asset-management";
import type { ScreenProps } from "./types";

/**
 * Everyone works in the Asset Management: admins with every customer, freelancers with their own files and their
 * customers (read only), and customers since 27.11.2026 with their own files, in the same four views (Minimal, Liste,
 * Kacheln, Detail) instead of a table of their own.
 */
export function FilesScreen(props: ScreenProps) {
  return <AssetManagement {...props} />;
}
