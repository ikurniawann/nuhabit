"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiDelete, apiPost } from "@/lib/api-client";
import { baseName, chunkRanges, parentPath, planFolderUpload, usesChunkedUpload, type UploadEntry } from "@/lib/dataroom/drive";
import type { DataroomItem, UploadSession } from "@/features/dataroom/types";

/**
 * Antrean unggah: maksimal 2 file paralel dengan progres per file. File di
 * bawah batas multipart dikirim sekali (XHR); yang lebih besar lewat sesi
 * berpotongan yang bisa dilanjutkan setelah koneksi putus. Folder yang
 * dijatuhkan dibuat dulu (induk sebelum anak), baru filenya diantrekan.
 * `onUploaded(parentId, node)` dipanggil setiap file selesai.
 */
export interface UploadTask {
  id: string;
  name: string;
  size: number;
  parentId: string | null;
  progress: number; // 0..100
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  chunked?: boolean;
}

const CONCURRENCY = 2;

type Uploaded = (parentId: string | null, node: DataroomItem) => void;

interface Pending {
  task: UploadTask;
  file: File;
  replaceNodeId?: string;
}

export interface UploadOptions {
  /** Batas satu permintaan multipart; di atasnya dipakai sesi berpotongan. */
  maxFileBytes: number;
}

function sendMultipart(url: string, file: File, fields: Record<string, string>, onProgress: (pct: number) => void) {
  return new Promise<DataroomItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let json: { data?: DataroomItem; error?: string } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.data) resolve(json.data);
      else reject(new Error(json.error || `Gagal (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus"));
    xhr.open("POST", url);
    xhr.send(form);
  });
}

/** Mengirim satu potongan; 409 berarti server menunggu offset lain. */
async function putChunk(sessionId: string, offset: number, blob: Blob): Promise<number> {
  const res = await fetch(`/api/dataroom/uploads/${sessionId}/chunk`, {
    method: "PUT", headers: { "X-Upload-Offset": String(offset), "Content-Type": "application/octet-stream" }, body: blob,
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { received_bytes: number }; error?: string };
  if (res.status === 409 && json.data) return json.data.received_bytes;
  if (!res.ok || !json.data) throw new Error(json.error || `Gagal (${res.status})`);
  return json.data.received_bytes;
}

async function sendChunked(file: File, parentId: string | null, replaceNodeId: string | undefined, onProgress: (pct: number) => void) {
  const started = await apiPost<{ data: UploadSession }>("/api/dataroom/uploads", {
    name: file.name, size: file.size, mime: file.type || null, parent_id: parentId, replace_node_id: replaceNodeId ?? null,
  });
  const session = started.data;
  const chunkBytes = session.chunk_bytes ?? 8 * 1024 * 1024;
  let received = session.received_bytes;
  const ranges = chunkRanges(file.size, chunkBytes);
  let attempts = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    if (end <= received) continue;
    try {
      received = await putChunk(session.id, start, file.slice(start, end));
      attempts = 0;
    } catch (err) {
      // Koneksi putus: tanya server sudah sampai mana, lalu lanjutkan.
      attempts += 1;
      if (attempts > 3) {
        await apiDelete(`/api/dataroom/uploads/${session.id}`).catch(() => undefined);
        throw err;
      }
      const status = await fetch(`/api/dataroom/uploads/${session.id}`).then((r) => r.json()).catch(() => null) as { data?: UploadSession } | null;
      received = status?.data?.received_bytes ?? received;
      i = ranges.findIndex(([s]) => s >= received) - 1;
      if (i < -1) i = ranges.length;
      continue;
    }
    onProgress(Math.round((received / file.size) * 100));
  }
  const done = await apiPost<{ data: DataroomItem }>(`/api/dataroom/uploads/${session.id}/complete`, {});
  return done.data;
}

/** Pengendali antrean di luar siklus render (closure, bukan state). */
function createController(setTasks: Dispatch<SetStateAction<UploadTask[]>>, onUploaded: () => Uploaded, options: () => UploadOptions) {
  const pending: Pending[] = [];
  let active = 0;

  const update = (id: string, patch: Partial<UploadTask>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const pump = () => {
    while (active < CONCURRENCY && pending.length > 0) {
      const next = pending.shift();
      if (!next) break;
      active += 1;
      const { task, file, replaceNodeId } = next;
      update(task.id, { status: "uploading", progress: 0 });
      const onProgress = (progress: number) => update(task.id, { progress });
      const chunked = usesChunkedUpload(file.size, options().maxFileBytes);
      const run = chunked
        ? sendChunked(file, task.parentId, replaceNodeId, onProgress)
        : replaceNodeId
          ? sendMultipart(`/api/dataroom/nodes/${replaceNodeId}/versions`, file, {}, onProgress)
          : sendMultipart("/api/dataroom/upload", file, task.parentId ? { parent_id: task.parentId } : {}, onProgress);
      run
        .then((node) => {
          update(task.id, { status: "done", progress: 100 });
          onUploaded()(task.parentId, node);
        })
        .catch((err: unknown) => {
          update(task.id, { status: "error", error: err instanceof Error ? err.message : "Gagal mengunggah" });
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const push = (file: File, parentId: string | null, replaceNodeId?: string) => {
    const task: UploadTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name, size: file.size, parentId, progress: 0, status: "queued",
      chunked: usesChunkedUpload(file.size, options().maxFileBytes),
    };
    setTasks((prev) => [...prev, task]);
    pending.push({ task, file, replaceNodeId });
  };

  return {
    enqueue(files: File[], parentId: string | null) {
      for (const file of files) push(file, parentId);
      pump();
    },
    enqueueVersion(file: File, node: DataroomItem) {
      push(file, node.parent_id, node.id);
      pump();
    },
    /** Membuat rantai folder lewat API, lalu mengantrekan file ke folder masing-masing. */
    async enqueueEntries(entries: UploadEntry[], parentId: string | null) {
      const plan = planFolderUpload(entries);
      const ids = new Map<string, string | null>([["", parentId]]);
      for (const path of plan.folders) {
        const created = await apiPost<{ data: DataroomItem }>("/api/dataroom/nodes", { name: baseName(path), parent_id: ids.get(parentPath(path)) ?? null });
        ids.set(path, created.data.id);
      }
      for (const [path, files] of plan.byFolder) {
        for (const file of files) push(file, ids.get(path) ?? parentId);
      }
      pump();
      return plan.folders.length;
    },
  };
}

export function useUploadQueue(onUploaded: Uploaded, options: UploadOptions) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const latest = useRef(onUploaded);
  const latestOptions = useRef(options);
  useEffect(() => { latest.current = onUploaded; latestOptions.current = options; }, [onUploaded, options]);
  // Pengendali dibuat malas di event handler (bukan saat render) agar bisa
  // memegang ref callback terbaru tanpa melanggar aturan React Compiler.
  const ctrl = useRef<ReturnType<typeof createController> | null>(null);
  const controller = () => {
    if (!ctrl.current) ctrl.current = createController(setTasks, () => latest.current, () => latestOptions.current);
    return ctrl.current;
  };

  const enqueue = useCallback((files: File[], parentId: string | null) => controller().enqueue(files, parentId), []);
  const enqueueEntries = useCallback((entries: UploadEntry[], parentId: string | null) => controller().enqueueEntries(entries, parentId), []);
  const enqueueVersion = useCallback((file: File, node: DataroomItem) => controller().enqueueVersion(file, node), []);
  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "queued" || t.status === "uploading"));
  }, []);

  return { tasks, enqueue, enqueueEntries, enqueueVersion, clearFinished };
}
