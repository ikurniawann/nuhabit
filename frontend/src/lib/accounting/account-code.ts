/** Compact CoA code helpers: Excel `1 1 01 001` → `1101001`. */

const SEGMENT_PATTERN = /^(\d)\s+(\d)\s+(\d{2})\s+(\d{3})$/;
const COMPACT_PATTERN = /^(\d)(\d)(\d{2})(\d{3})$/;

export type AccountCodeSegments = {
  classDigit: string;
  groupDigit: string;
  subGroup: string;
  detail: string;
};

export function normalizeAccountCode(raw: string): string | null {
  const trimmed = raw.trim().replace(/[-_.]/g, " ").replace(/\s+/g, " ");
  if (!trimmed) return null;

  const spaced = trimmed.match(SEGMENT_PATTERN);
  if (spaced) return `${spaced[1]}${spaced[2]}${spaced[3]}${spaced[4]}`;

  const digits = trimmed.replace(/\s+/g, "");
  const compact = digits.match(COMPACT_PATTERN);
  if (compact) return compact[0];

  return null;
}

export function parseAccountCode(code: string): AccountCodeSegments | null {
  const normalized = normalizeAccountCode(code);
  if (!normalized) return null;
  const m = normalized.match(COMPACT_PATTERN);
  if (!m) return null;
  return {
    classDigit: m[1],
    groupDigit: m[2],
    subGroup: m[3],
    detail: m[4],
  };
}

export function formatAccountCodeDisplay(code: string): string {
  const parts = parseAccountCode(code);
  if (!parts) return code;
  return `${parts.classDigit} ${parts.groupDigit} ${parts.subGroup} ${parts.detail}`;
}

/** Infer hierarchy level from compact code zeros. */
export function inferAccountLevel(code: string): 1 | 2 | 3 | 4 | null {
  const parts = parseAccountCode(code);
  if (!parts) return null;
  const { groupDigit, subGroup, detail } = parts;
  if (groupDigit === "0" && subGroup === "00" && detail === "000") return 1;
  if (subGroup === "00" && detail === "000") return 2;
  if (detail === "000") return 3;
  return 4;
}

export function idealParentCode(code: string): string | null {
  const parts = parseAccountCode(code);
  const level = inferAccountLevel(code);
  if (!parts || !level || level === 1) return null;

  const { classDigit, groupDigit, subGroup } = parts;
  if (level === 2) return `${classDigit}000000`;
  if (level === 3) return `${classDigit}${groupDigit}00000`;
  return `${classDigit}${groupDigit}${subGroup}000`;
}

/** Walk up ideal parents until one exists in `existingCodes`. */
export function resolveParentCode(
  code: string,
  existingCodes: Set<string>
): string | null {
  let parent = idealParentCode(code);
  while (parent) {
    if (existingCodes.has(parent)) return parent;
    parent = idealParentCode(parent);
  }
  return null;
}

export function buildCompactCode(parts: AccountCodeSegments): string {
  return `${parts.classDigit}${parts.groupDigit}${parts.subGroup}${parts.detail}`;
}
