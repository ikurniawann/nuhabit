/**
 * Dataroom drive helpers (pure): sorting, folder upload plans, chunk
 * ranges, keyboard navigation, preview kinds and activity labels.
 */

export type SortKey = "name" | "updated" | "size" | "owner";
export type SortDir = "asc" | "desc";

interface Sortable {
  kind: "folder" | "file";
  name: string;
  updated_at: string;
  size_bytes: number;
  created_by_name?: string | null;
}

/** Folders first, then by the column; ties fall back to the name. */
export function sortItems<T extends Sortable>(items: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "id", { sensitivity: "base", numeric: true });
  const compare = (a: T, b: T): number => {
    switch (key) {
      case "updated":
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      case "size":
        return a.size_bytes - b.size_bytes;
      case "owner":
        return (a.created_by_name ?? "").localeCompare(b.created_by_name ?? "", "id", { sensitivity: "base" });
      default:
        return byName(a, b);
    }
  };
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compare(a, b) * sign || byName(a, b);
  });
}

/** One picked or dropped file with the folder path it sits in ("" = the target folder). */
export interface UploadEntry {
  file: File;
  path: string;
}

/** The folders a batch needs, parents before children, with each file's folder. */
export interface FolderPlan {
  folders: string[];
  byFolder: Map<string, File[]>;
}

/** Normalises "a/b/" or "./a\b" to "a/b" and drops hidden segments. */
export function normalizeFolderPath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

/** Groups entries by folder; `folders` lists every path in creation order. */
export function planFolderUpload(entries: UploadEntry[]): FolderPlan {
  const byFolder = new Map<string, File[]>();
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const entry of entries) {
    const path = normalizeFolderPath(entry.path);
    const parts = path ? path.split("/") : [];
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join("/");
      if (!seen.has(prefix)) {
        seen.add(prefix);
        folders.push(prefix);
      }
    }
    const list = byFolder.get(path) ?? [];
    list.push(entry.file);
    byFolder.set(path, list);
  }
  return { folders, byFolder };
}

/** The parent path of "a/b/c" is "a/b"; "" for a top-level folder. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** [start, end) byte ranges of a file split into chunks. */
export function chunkRanges(size: number, chunkBytes: number): [number, number][] {
  if (size <= 0 || chunkBytes <= 0) return [];
  const out: [number, number][] = [];
  for (let start = 0; start < size; start += chunkBytes) out.push([start, Math.min(size, start + chunkBytes)]);
  return out;
}

/** Files above the multipart cap go through the chunked session. */
export function usesChunkedUpload(size: number, maxFileBytes: number): boolean {
  return size > maxFileBytes;
}

/**
 * The item index an arrow key moves focus to in a grid of `columns` (1 for
 * the list). Home and End jump; anything else keeps the index.
 */
export function moveFocus(index: number, key: string, count: number, columns: number): number {
  if (count === 0) return -1;
  const cur = index < 0 ? -1 : index;
  let next = cur;
  switch (key) {
    case "ArrowRight": next = cur + 1; break;
    case "ArrowLeft": next = cur - 1; break;
    case "ArrowDown": next = cur < 0 ? 0 : cur + columns; break;
    case "ArrowUp": next = cur - columns; break;
    case "Home": next = 0; break;
    case "End": next = count - 1; break;
    default: return cur;
  }
  return Math.max(0, Math.min(count - 1, next));
}

export type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "office" | "none";

const IMAGE_RE = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/;
const VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"]);
const TEXT = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const OFFICE = new Set([
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** How the preview dialog renders a MIME type. */
export function previewKind(mime: string | null | undefined): PreviewKind {
  const m = String(mime ?? "").toLowerCase();
  if (IMAGE_RE.test(m)) return "image";
  if (m === "application/pdf") return "pdf";
  if (VIDEO.has(m)) return "video";
  if (AUDIO.has(m)) return "audio";
  if (TEXT.has(m)) return "text";
  if (OFFICE.has(m)) return "office";
  return "none";
}

/** Whether the dialog has something to show (office falls back to extracted text). */
export function canPreview(mime: string | null | undefined): boolean {
  return previewKind(mime) !== "none";
}

export const ACTIVITY_LABEL: Record<string, string> = {
  create_folder: "membuat folder",
  upload: "mengunggah",
  new_version: "mengunggah versi baru",
  restore_version: "memulihkan versi",
  rename: "mengganti nama",
  move: "memindahkan",
  copy: "menyalin",
  update_meta: "mengubah deskripsi/tag",
  trash: "memindahkan ke sampah",
  restore: "memulihkan dari sampah",
  purge: "menghapus permanen",
  view: "melihat",
  download: "mengunduh",
  share_created: "membuat link berbagi",
  permissions: "mengubah hak akses",
  comment: "berkomentar",
  lock: "mengunci untuk diedit",
  unlock: "membuka kunci",
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABEL[action] ?? action;
}

export const ROLE_LABEL: Record<string, string> = {
  viewer: "Dapat melihat",
  commenter: "Dapat berkomentar",
  editor: "Dapat mengedit",
  owner: "Pemilik",
};

/** Level order for comparisons in the UI. */
const LEVEL_RANK: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export function atLeast(level: string | undefined, need: keyof typeof LEVEL_RANK): boolean {
  return (LEVEL_RANK[level ?? ""] ?? 0) >= LEVEL_RANK[need];
}

/** Days left before a trashed item is purged (30 days after trashing). */
export function purgeDaysLeft(trashedAt: string | null | undefined, now = Date.now()): number {
  if (!trashedAt) return 0;
  const end = new Date(trashedAt).getTime() + 30 * 86_400_000;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}
