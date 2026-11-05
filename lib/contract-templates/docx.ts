/**
 * Fills placeholders such as {{kunde_firma}} in Word files (.docx). Self-contained (only fflate), so the hub,
 * the template scripts and `node --test` share one implementation.
 *
 * Word splits text into runs at will: a placeholder typed in one go can end up as "{{kunde_", "firma", "}}" after
 * a spell check or an edit. Placeholders are therefore found in the joined text of each paragraph and written back
 * into the run where they start; the rest of the paragraph keeps its runs and formatting.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/** Placeholder keys: lower case letters, digits and underscores; spaces inside the braces are allowed. */
const placeholderPattern = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** The parts of a .docx that carry visible text: body, headers, footers, foot- and endnotes. */
export const isTextPart = (name: string) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name);

type TextNode = { start: number; end: number; text: string; paragraph: number };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

export function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

export function encodeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The text nodes (<w:t>) of a part in document order, each with the paragraph it belongs to. Paragraphs nest inside
 * text boxes, so a stack keeps every text node with its innermost paragraph.
 */
function scanTextNodes(xml: string): TextNode[] {
  const nodes: TextNode[] = [];
  const stack: number[] = [];
  let paragraphs = 0;
  const tokens = /<w:p(?=[\s>/])[^>]*>|<\/w:p>|<w:t(?=[\s>/])[^>]*\/>|<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>/g;
  for (let match = tokens.exec(xml); match; match = tokens.exec(xml)) {
    const token = match[0];
    if (token.startsWith("</w:p")) {
      stack.pop();
    } else if (token.startsWith("<w:p")) {
      if (!token.endsWith("/>")) stack.push(paragraphs++);
    } else {
      nodes.push({ start: match.index, end: match.index + token.length, text: token.endsWith("/>") ? "" : decodeXml(match[1] ?? ""), paragraph: stack.length ? stack[stack.length - 1] : -1 });
    }
  }
  return nodes;
}

function groupByParagraph(nodes: TextNode[]) {
  const groups = new Map<number, TextNode[]>();
  for (const node of nodes) groups.set(node.paragraph, [...(groups.get(node.paragraph) ?? []), node]);
  return [...groups.values()];
}

export type PlaceholderScan = {
  /** Every placeholder key in the order of its first appearance (lower case). */
  keys: string[];
  /** Text around an opening "{{" that never closes, or a closing "}}" without an opening one, per paragraph. */
  broken: string[];
};

/** All placeholders of an XML part, plus pieces that look like a placeholder but are not complete. */
export function scanPlaceholders(xml: string): PlaceholderScan {
  const keys: string[] = [];
  const broken: string[] = [];
  for (const group of groupByParagraph(scanTextNodes(xml))) {
    const text = group.map((node) => node.text).join("");
    for (const match of text.matchAll(placeholderPattern)) {
      const key = match[1].toLowerCase();
      if (!keys.includes(key)) keys.push(key);
    }
    const rest = text.replace(placeholderPattern, "");
    if (rest.includes("{{") || rest.includes("}}")) broken.push(rest.trim().slice(0, 120));
  }
  return { keys, broken };
}

/**
 * Replaces every placeholder whose key `valueOf` knows; unknown keys stay as they are, so a check can still find
 * them. Values are plain text (line breaks become spaces).
 */
export function fillXml(xml: string, valueOf: (key: string) => string | undefined): string {
  return replaceTextXml(xml, placeholderPattern, (match) => {
    const value = valueOf(match[1].toLowerCase());
    return value === undefined ? undefined : value.replace(/\s*[\r\n]+\s*/g, " ");
  });
}

/**
 * The text replacement under fillXml: `pattern` (global) runs over the joined text of every paragraph, and each
 * match becomes what `replace` returns (undefined keeps it). The replacement takes the formatting of the run where
 * the match starts.
 */
export function replaceTextXml(xml: string, pattern: RegExp, replace: (match: RegExpMatchArray) => string | undefined): string {
  const nodes = scanTextNodes(xml);
  const changed = new Map<TextNode, string>();
  for (const group of groupByParagraph(nodes)) {
    const texts = group.map((node) => node.text);
    const joined = texts.join("");
    const matches = [...joined.matchAll(pattern)].flatMap((match) => {
      const value = match[0] ? replace(match) : undefined;
      return value === undefined ? [] : [{ match, value }];
    });
    if (!matches.length) continue;
    // Offsets and lengths of every node in the joined text, before any change.
    const lengths = texts.map((text) => text.length);
    const offsets: number[] = [];
    lengths.reduce((offset, length) => (offsets.push(offset), offset + length), 0);
    const nodeAt = (position: number) => {
      for (let index = 0; index < group.length; index++) if (position >= offsets[index] && position < offsets[index] + lengths[index]) return index;
      return group.length - 1;
    };
    // From the back: a change only touches text at or after its own start, so earlier matches keep their offsets.
    for (const { match, value } of matches.reverse()) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const first = nodeAt(start);
      const last = nodeAt(end - 1);
      if (first === last) {
        const local = start - offsets[first];
        texts[first] = texts[first].slice(0, local) + value + texts[first].slice(local + match[0].length);
      } else {
        texts[first] = texts[first].slice(0, start - offsets[first]) + value;
        for (let index = first + 1; index < last; index++) texts[index] = "";
        texts[last] = texts[last].slice(end - offsets[last]);
      }
    }
    group.forEach((node, index) => { if (texts[index] !== node.text) changed.set(node, texts[index]); });
  }
  if (!changed.size) return xml;
  let out = "";
  let cursor = 0;
  for (const node of nodes) {
    const text = changed.get(node);
    if (text === undefined) continue;
    out += xml.slice(cursor, node.start) + `<w:t xml:space="preserve">${encodeXml(text)}</w:t>`;
    cursor = node.end;
  }
  return out + xml.slice(cursor);
}

/** The parts of a .docx in archive order. */
export function readDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

export function writeDocx(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync(parts, { level: 6 });
}

/** Every placeholder in the text parts of a .docx, in order of appearance. */
export function docxPlaceholders(bytes: Uint8Array): PlaceholderScan {
  const parts = readDocx(bytes);
  const keys: string[] = [];
  const broken: string[] = [];
  for (const [name, data] of Object.entries(parts)) {
    if (!isTextPart(name)) continue;
    const scan = scanPlaceholders(strFromU8(data));
    for (const key of scan.keys) if (!keys.includes(key)) keys.push(key);
    broken.push(...scan.broken);
  }
  return { keys, broken };
}

/** A copy of the .docx with its placeholders filled; parts without text stay byte for byte the same. */
export function fillDocx(bytes: Uint8Array, valueOf: (key: string) => string | undefined): Uint8Array {
  const parts = readDocx(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(parts)) {
    out[name] = isTextPart(name) ? strToU8(fillXml(strFromU8(data), valueOf)) : data;
  }
  return writeDocx(out);
}

/** A .docx starts like every ZIP file; anything else is refused before unpacking. */
export const looksLikeDocx = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
