import type { ReactNode } from "react";

/**
 * A small markdown renderer for staff-written copy (articles, legal pages,
 * the brand story). It builds React elements, never HTML, so nothing in the
 * source reaches the DOM unescaped. Supported: # to ### headings, paragraphs,
 * "-" and "1." lists, "> " quotes, **bold**, *italic*, `code` and
 * [links](https://...) with http(s), mailto or site-relative targets.
 */

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      if (!href) return <span key={key}>{link[1]}</span>;
      const external = /^https?:\/\//i.test(href);
      return (
        <a key={key} href={href} rel={external ? "noopener noreferrer" : undefined} target={external ? "_blank" : undefined}>
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      i += 1;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/;
    const number = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const pattern = ordered ? number : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(pattern.exec(lines[i])![1].trim());
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ").trim() });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source ?? "");
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${block.level + 1}` as "h2" | "h3" | "h4";
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case "quote":
            return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
          case "list": {
            const items = block.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>);
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
