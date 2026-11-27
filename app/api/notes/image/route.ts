import { NextResponse } from "next/server";
import { notesContext } from "@/lib/hub-notes/server";
import { NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_TYPES } from "@/lib/hub-notes/rules";
import { saveNoteImageAs } from "@/lib/hub-notes/write";

// A picture for the text of a page (27.11.2026): `?page=<id>`, the file as form data; PNG, JPG, WebP or GIF up to 9 MB
// from a person who may edit the page. The hub stores it as WebP at the customer's notes (lib/hub-notes/write.ts) and
// reads the upload only once it is its turn in the hub's line for image work. A route rather than a Server Action,
// whose requests stop at 1 MB, and below 10 MB, because the hub's proxy keeps no more of a request: the browser shrinks
// larger pictures before they go up (components/hub/screens/notes-image.tsx).

const TOO_BIG = "Ein Bild darf höchstens 9 MB groß sein.";

export async function POST(request: Request) {
  const ctx = await notesContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Bitte melde dich an." }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > NOTE_IMAGE_MAX_BYTES + 64 * 1024) return NextResponse.json({ ok: false, error: TOO_BIG }, { status: 413 });
  const pageId = new URL(request.url).searchParams.get("page") ?? "";
  const result = await saveNoteImageAs(ctx, {
    pageId,
    read: async () => {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File) || !NOTE_IMAGE_TYPES.includes(file.type)) return "Als Bild gehen PNG, JPG, WebP oder GIF.";
      if (file.size > NOTE_IMAGE_MAX_BYTES) return TOO_BIG;
      return new Uint8Array(await file.arrayBuffer());
    },
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
