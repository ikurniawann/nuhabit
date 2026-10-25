import type { UploadEntry } from "@/lib/dataroom/drive";

/**
 * Membaca file dan folder dari drag & drop (webkitGetAsEntry) atau dari
 * input `webkitdirectory`, menjadi daftar {file, path} dengan path folder
 * relatif terhadap tujuan.
 */

interface FSEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FSFileEntry extends FSEntry {
  file(ok: (f: File) => void, err: (e: unknown) => void): void;
}
interface FSDirectoryEntry extends FSEntry {
  createReader(): { readEntries(ok: (entries: FSEntry[]) => void, err: (e: unknown) => void): void };
}

const MAX_ENTRIES = 2000;

function readAll(dir: FSDirectoryEntry): Promise<FSEntry[]> {
  const reader = dir.createReader();
  const out: FSEntry[] = [];
  return new Promise((resolve, reject) => {
    const step = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else { out.push(...batch); step(); }
      }, reject);
    step();
  });
}

async function walk(entry: FSEntry, path: string, out: UploadEntry[]) {
  if (out.length >= MAX_ENTRIES) return;
  if (entry.isFile) {
    const file = await new Promise<File>((ok, err) => (entry as FSFileEntry).file(ok, err));
    out.push({ file, path });
    return;
  }
  if (entry.isDirectory) {
    const children = await readAll(entry as FSDirectoryEntry);
    const next = path ? `${path}/${entry.name}` : entry.name;
    for (const child of children) await walk(child, next, out);
  }
}

/** Entri dari DataTransfer: folder dijelajahi rekursif; file biasa dapat path "". */
export async function readDroppedEntries(dt: DataTransfer): Promise<UploadEntry[]> {
  const out: UploadEntry[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (entries.length === 0) {
    return Array.from(dt.files).map((file) => ({ file, path: "" }));
  }
  for (const entry of entries) await walk(entry as unknown as FSEntry, "", out);
  return out;
}

/** Entri dari input file: `webkitRelativePath` membawa folder yang dipilih. */
export function readPickedEntries(files: FileList | File[]): UploadEntry[] {
  return Array.from(files).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const i = rel.lastIndexOf("/");
    return { file, path: i < 0 ? "" : rel.slice(0, i) };
  });
}
