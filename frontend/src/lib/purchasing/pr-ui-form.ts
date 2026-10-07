/** Pesan galat pertama (depth-first) dari objek errors react-hook-form. */
export function firstFormErrorMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") return null;
  const node = errors as Record<string, unknown> & { message?: unknown };
  if (typeof node.message === "string" && node.message.length > 0) return node.message;
  for (const value of Object.values(node)) {
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (child && typeof child === "object") {
        const found = firstFormErrorMessage(child);
        if (found) return found;
      }
    }
  }
  return null;
}

interface PrLine {
  qty?: number | null;
  estimated_price?: number | null;
}

export function prLineSubtotal(line: PrLine | undefined): number {
  return (line?.qty || 0) * (line?.estimated_price || 0);
}

export function prLinesTotal(lines: PrLine[] | undefined): number {
  return (lines ?? []).reduce((sum, line) => sum + prLineSubtotal(line), 0);
}
