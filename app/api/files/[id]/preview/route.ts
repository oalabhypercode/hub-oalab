import { isPreviewSize } from "@/lib/hub-files/preview";
import { filePreview } from "@/lib/hub-files/preview-server";

// The preview of one stored image as a small WebP (lib/hub-files/preview.ts), for whoever may read the file: the
// details in the Asset Management show it instead of the original. The browser keeps it for a day, only for this
// person (`private`); the address changes with the file's bytes.

const plain = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const size = new URL(request.url).searchParams.get("size");
  const result = await filePreview(id, isPreviewSize(size) ? size : "s");
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { ...plain, "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(result.data), {
    headers: { ...plain, "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400", "X-Image-Size": `${result.width}x${result.height}` },
  });
}
