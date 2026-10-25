/**
 * Markdown sederhana untuk isi SOP: judul (#, ##, ###), daftar berbutir
 * (- atau *), daftar bernomor (1.), paragraf, dan **tebal**. Hasilnya blok
 * data yang dirender sebagai elemen React biasa, jadi tidak ada HTML mentah.
 */

export type Inline = { text: string; bold: boolean };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

/** Pisahkan **tebal** dari teks biasa; ** tanpa pasangan tetap teks. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const parts = line.split("**");
  const closed = parts.length % 2 === 1;
  parts.forEach((part, i) => {
    const bold = closed && i % 2 === 1;
    const text = !closed && i > 0 ? `**${part}` : part;
    if (text) out.push({ text, bold });
  });
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: parseInline(heading[2]) });
    } else if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const item = parseInline((bullet ?? numbered)![1]);
      const last = blocks.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
