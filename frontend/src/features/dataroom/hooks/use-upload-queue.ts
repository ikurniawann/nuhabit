"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DataroomItem } from "@/features/dataroom/types";

/**
 * Antrean unggah: satu XHR per file (progres per file), maksimal 2 paralel.
 * `onUploaded(parentId, node)` dipanggil setiap file selesai agar folder yang
 * sedang dibuka bisa dimuat ulang.
 */
export interface UploadTask {
  id: string;
  name: string;
  size: number;
  parentId: string | null;
  progress: number; // 0..100
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

const CONCURRENCY = 2;

type Uploaded = (parentId: string | null, node: DataroomItem) => void;

/** Pengendali antrean di luar siklus render (closure, bukan state). */
function createController(setTasks: Dispatch<SetStateAction<UploadTask[]>>, onUploaded: () => Uploaded) {
  const pending: { task: UploadTask; file: File }[] = [];
  let active = 0;

  const update = (id: string, patch: Partial<UploadTask>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const pump = () => {
    while (active < CONCURRENCY && pending.length > 0) {
      const next = pending.shift();
      if (!next) break;
      active += 1;
      const { task, file } = next;
      update(task.id, { status: "uploading", progress: 0 });
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file, file.name);
      if (task.parentId) form.append("parent_id", task.parentId);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) update(task.id, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        active -= 1;
        let json: { success?: boolean; data?: DataroomItem; error?: string } = {};
        try { json = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && json.data) {
          update(task.id, { status: "done", progress: 100 });
          onUploaded()(task.parentId, json.data);
        } else {
          update(task.id, { status: "error", error: json.error || `Gagal (${xhr.status})` });
        }
        pump();
      };
      xhr.onerror = () => {
        active -= 1;
        update(task.id, { status: "error", error: "Koneksi terputus" });
        pump();
      };
      xhr.open("POST", "/api/dataroom/upload");
      xhr.send(form);
    }
  };

  return {
    enqueue(files: File[], parentId: string | null) {
      const fresh = files.map((file) => ({
        task: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name, size: file.size, parentId, progress: 0, status: "queued" as const,
        },
        file,
      }));
      setTasks((prev) => [...prev, ...fresh.map((f) => f.task)]);
      pending.push(...fresh);
      pump();
    },
  };
}

export function useUploadQueue(onUploaded: Uploaded) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const latest = useRef(onUploaded);
  useEffect(() => { latest.current = onUploaded; }, [onUploaded]);
  // Pengendali dibuat malas di event handler (bukan saat render) agar bisa
  // memegang ref callback terbaru tanpa melanggar aturan React Compiler.
  const ctrl = useRef<ReturnType<typeof createController> | null>(null);

  const enqueue = useCallback((files: File[], parentId: string | null) => {
    if (!ctrl.current) ctrl.current = createController(setTasks, () => latest.current);
    ctrl.current.enqueue(files, parentId);
  }, []);
  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "queued" || t.status === "uploading"));
  }, []);

  return { tasks, enqueue, clearFinished };
}
