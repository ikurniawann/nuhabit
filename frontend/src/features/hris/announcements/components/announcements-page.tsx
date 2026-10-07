"use client";

import { useState } from "react";
import { MegaphoneIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDeleteAnnouncement } from "../mutations";
import { useAnnouncements } from "../queries";
import type { Announcement } from "../types";
import { AnnouncementEditor } from "./announcement-editor";
import { AnnouncementsTable } from "./announcements-table";

/** null = daftar; "new" = buat baru; Announcement = edit. */
type EditorTarget = Announcement | "new" | null;

export function AnnouncementsPage() {
  const { data: list = [], isLoading } = useAnnouncements();
  const remove = useDeleteAnnouncement();
  const [editing, setEditing] = useState<EditorTarget>(null);

  function handleDelete(a: Announcement) {
    if (!window.confirm(`Hapus pengumuman "${a.title}"?`)) return;
    remove.mutate(a.id, {
      onSuccess: () => toast.success("Pengumuman dihapus"),
      onError: (error) => toast.error(error.message || "Gagal menghapus"),
    });
  }

  if (editing !== null) {
    const announcement = editing === "new" ? null : editing;
    return (
      <AnnouncementEditor
        key={announcement?.id ?? "new"}
        announcement={announcement}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <MegaphoneIcon className="h-6 w-6 text-pink-600" /> Pengumuman
          </h1>
          <p className="text-sm text-gray-500">Kelola pengumuman & informasi perusahaan untuk karyawan</p>
        </div>
        <Button className="bg-pink-600 hover:bg-pink-700" onClick={() => setEditing("new")}>
          <PlusIcon className="mr-2 h-4 w-4" /> Pengumuman Baru
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
          Belum ada pengumuman. Klik &quot;Pengumuman Baru&quot; untuk membuat.
        </div>
      ) : (
        <AnnouncementsTable announcements={list} onEdit={setEditing} onDelete={handleDelete} />
      )}
    </div>
  );
}
