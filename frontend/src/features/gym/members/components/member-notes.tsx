"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TEXTAREA, TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateTime } from "@/lib/format";
import { MEMBER_KEYS, membersApi, type MemberNote } from "../api";

const NOTE_MAX = 2000;

/** Catatan staf untuk member: siapa pun bisa menambah, hanya penulis yang bisa menghapus. */
export function MemberNotes({ customerId, notes }: { customerId: string; notes: MemberNote[] }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.detail(customerId) });
  const add = useMutation({
    mutationFn: () => membersApi.addNote(customerId, body.trim()),
    onSuccess: () => {
      setBody("");
      void refresh();
    },
    onError: (error) => toast.error("Catatan gagal disimpan", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => membersApi.deleteNote(customerId, noteId),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error("Catatan gagal dihapus", { description: error.message }),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <label htmlFor="member-note" className="text-sm font-semibold">
            Catatan baru
          </label>
          <textarea
            id="member-note"
            className={TEXTAREA}
            value={body}
            maxLength={NOTE_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Contoh: cedera lutut kiri, hindari lunge berat sampai akhir bulan."
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {body.length}/{NOTE_MAX}
            </span>
            <Button type="submit" disabled={!body.trim() || add.isPending}>
              Simpan catatan
            </Button>
          </div>
        </form>
      </Card>

      {notes.length === 0 ? (
        <Card>
          <TableNote>Belum ada catatan staf.</TableNote>
        </Card>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{n.author_name || "Staf"}</span> · {formatDateTime(n.created_at)}
                  </p>
                  {n.mine && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Hapus catatan"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(n.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <p className="text-sm whitespace-pre-line">{n.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
