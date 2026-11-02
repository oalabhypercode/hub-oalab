import { Fragment } from "react";

// Text from the assistant and from conversations: never HTML, only this small format.
const LINK = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

/** Web addresses become links that open in a new tab; everything else stays plain text. */
function linked(text: string) {
  return text.split(LINK).map((part, index) => index % 2
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : <Fragment key={index}>{part}</Fragment>);
}

/** **bold** inside a line. */
function inline(text: string, links: boolean) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.length > 4 && part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{links ? linked(part.slice(2, -2)) : part.slice(2, -2)}</strong>
    : <Fragment key={index}>{links ? linked(part) : part}</Fragment>);
}

/**
 * Paragraphs, "- " lists, "1. " steps and bold: the format the assistant is asked to use and the service platform's
 * safe Markdown for messages. With `links`, web addresses become links.
 */
export function RichText({ text, links = false }: { text: string; links?: boolean }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "), links)}</p>);
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item, links)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    paragraph = [];
    list = null;
  };
  for (const line of text.split("\n")) {
    // Markdown headings read as a bold line of their own.
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<p key={blocks.length}><strong>{inline(heading[1], links)}</strong></p>);
      continue;
    }
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const step = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? step;
    if (item) {
      const ordered = Boolean(step);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
    } else if (!line.trim()) {
      flush();
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <>{blocks}</>;
}

/** Plain text keeps its line breaks (the bubble's white-space does that); addresses become links. */
export function PlainText({ text }: { text: string }) {
  return <>{linked(text)}</>;
}
