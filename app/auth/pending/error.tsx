"use client";

import { AuthLoadError } from "@/components/hub/load-error";

export default function PendingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AuthLoadError retry={retry} />;
}
