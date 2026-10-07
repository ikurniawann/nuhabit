import { PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import type { Announcement } from "../types";

interface AnnouncementsTableProps {
  announcements: Announcement[];
  onEdit: (announcement: Announcement) => void;
  onDelete: (announcement: Announcement) => void;
}

export function AnnouncementsTable({ announcements, onEdit, onDelete }: AnnouncementsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3">Judul</th>
            <th className="px-4 py-3">Target</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Dibaca</th>
            <th className="px-4 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {announcements.map((a) => (
            <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50/60">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 font-medium text-gray-900">
                  {a.is_pinned && <span title="Disematkan">📌</span>}
                  {a.title}
                </div>
                {a.tags.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {a.tags.map((t) => (
                      <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {a.target_scope === "global" ? "Semua divisi" : `${a.department_ids.length} departemen`}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    a.status === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {a.status === "published" ? "Terbit" : "Draft"}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">{a.read_count}×</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onEdit(a)} title="Edit">
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(a)}
                    title="Hapus"
                    className="text-red-500 hover:text-red-700"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
