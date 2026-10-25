"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NotebookPen, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TEXTAREA } from "@/features/crm/engagement/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { CARE_KEYS, careApi, memberIds, type MemberNotes, type SessionNote } from "../api";
import { SESSION_NOTE_MAX } from "../display";
import { useRefreshCare } from "./flag-dialogs";

/**
 * Catatan coach untuk member roster: yang dibawa ke sesi berikutnya dan
 * riwayat 60 hari. Hanya coach member itu dan manajer gym yang menerimanya;
 * bagi staf lain server menolak, jadi hook ini diam saja.
 */
export function useRosterNotes(ids: readonly string[]) {
  const key = memberIds(ids);
  const query = useQuery({
    queryKey: CARE_KEYS.notes(key),
    queryFn: () => careApi.notes(key),
    enabled: key.length > 0,
    retry: false,
  });
  return new Map((query.data ?? []).map((m: MemberNotes) => [m.customer_id, m.notes]));
}

/** Sesi tempat catatan baru ditulis: kelas atau PT. */
export type NoteTarget = { session_id: string } | { pt_appointment_id: string };

/**
 * Catatan satu member di roster coach. Dengan target (sesi sudah mulai,
 * paling lama 7 hari lalu) coach bisa menulis catatan baru untuk sesi itu.
 */
export function CoachNotes({
  customerId,
  memberName,
  notes,
  target,
}: {
  customerId: string;
  memberName: string | null;
  notes: SessionNote[] | undefined;
  target?: NoteTarget;
}) {
  const refresh = useRefreshCare();
  const [writing, setWriting] = useState(false);
  const act = useMutation({
    mutationFn: ({ note, action }: { note: SessionNote; action: "release" | "delete" }) =>
      action === "release" ? careApi.releaseNote(note.id) : careApi.deleteNote(note.id),
    onSuccess: (_, { action }) => {
      toast.success(action === "release" ? "Catatan tidak dibawa lagi" : "Catatan dihapus");
      refresh();
    },
    onError: (error) => toast.error("Catatan gagal diubah", { description: error.message }),
  });
  const list = notes ?? [];
  if (list.length === 0 && !target) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {list.map((n) => (
        <div key={n.id} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          {n.pinned ? <Pin className="mt-0.5 size-3.5 shrink-0 text-forest" aria-label="Dibawa ke sesi berikutnya" /> : null}
          <span className="min-w-0 flex-1">
            <span className="block whitespace-pre-line">{n.body}</span>
            <span className="block text-xs text-muted-foreground">
              {n.coach_name} · {formatDate(n.created_at)}
              {n.session_label && ` · ${n.session_label}`}
              {n.released_at && ` · dilepas ${n.released_by_name || ""}`.trimEnd()}
            </span>
          </span>
          {n.pinned && (
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ note: n, action: "release" })}>
              Lepas
            </Button>
          )}
          {n.mine && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Hapus catatan"
              disabled={act.isPending}
              onClick={() => act.mutate({ note: n, action: "delete" })}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
      {target && (
        <Button size="sm" variant="ghost" onClick={() => setWriting(true)}>
          <NotebookPen /> Catatan coach
        </Button>
      )}
      {writing && target && (
        <NoteDialog customerId={customerId} memberName={memberName} target={target} onClose={() => setWriting(false)} />
      )}
    </div>
  );
}

function NoteDialog({
  customerId,
  memberName,
  target,
  onClose,
}: {
  customerId: string;
  memberName: string | null;
  target: NoteTarget;
  onClose: () => void;
}) {
  const refresh = useRefreshCare();
  const [body, setBody] = useState("");
  const [carry, setCarry] = useState(false);
  const save = useMutation({
    mutationFn: () => careApi.addNote({ customer_id: customerId, ...target, body: body.trim(), carry_forward: carry }),
    onSuccess: () => {
      toast.success("Catatan disimpan");
      refresh();
      onClose();
    },
    onError: (error) => toast.error("Catatan gagal disimpan", { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Catatan coach</DialogPanelTitle>
            <DialogPanelDescription>
              {memberName ?? "Member"}. Hanya coach dan manajer gym yang bisa membaca catatan ini.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <textarea
              className={TEXTAREA}
              value={body}
              maxLength={SESSION_NOTE_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Contoh: hindari lunge, lutut kiri masih nyeri."
              aria-label="Isi catatan"
              autoFocus
            />
            <p className="text-right text-xs text-muted-foreground">
              {body.length}/{SESSION_NOTE_MAX}
            </p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-forest)]"
                checked={carry}
                onChange={(e) => setCarry(e.target.checked)}
              />
              <span>
                <span className="block font-medium">Bawa ke sesi berikutnya</span>
                <span className="block text-xs text-muted-foreground">
                  Tampil di roster coach mana pun yang melatih member ini sampai ada coach yang melepasnya.
                </span>
              </span>
            </label>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!body.trim() || save.isPending}>
              Simpan catatan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

/** Riwayat catatan coach 60 hari di profil 360, untuk manajer gym. */
export function CoachNoteHistory({ customerId }: { customerId: string }) {
  const history = useQuery({ queryKey: CARE_KEYS.noteHistory(customerId), queryFn: () => careApi.noteHistory(customerId) });
  const notes = history.data ?? [];
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Catatan coach</h2>
      {history.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat catatan coach…</p>
      ) : history.error ? (
        <p className="text-sm text-danger">{history.error.message}</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada catatan coach dalam 60 hari terakhir.</p>
      ) : (
        <CoachNotes customerId={customerId} memberName={null} notes={notes} />
      )}
    </section>
  );
}
