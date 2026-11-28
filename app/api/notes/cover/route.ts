import { NextResponse } from "next/server";
import { notesContext } from "@/lib/hub-notes/server";
import { saveCoverUploadAs } from "@/lib/hub-notes/write";

// Uploading a cover (plan 1.6): JPG, PNG or WebP up to 5 MB from a person who may edit the page. The hub turns it into a
// WebP of 1500 × 500 pixels, stores it with the customer's notes and sets it on the page (lib/hub-notes/write.ts). A
// route rather than a Server Action, whose requests stop at 1 MB.

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const ctx = await notesContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Bitte melde dich an." }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) return NextResponse.json({ ok: false, error: "Ein Titelbild darf höchstens 5 MB groß sein." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const id = String(form?.get("pageId") ?? "");
  const version = Number(form?.get("version"));
  if (!(file instanceof File) || !TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "Als Titelbild gehen JPG, PNG oder WebP." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "Ein Titelbild darf höchstens 5 MB groß sein." }, { status: 413 });
  const result = await saveCoverUploadAs(ctx, { id, version, bytes: Buffer.from(await file.arrayBuffer()) });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
