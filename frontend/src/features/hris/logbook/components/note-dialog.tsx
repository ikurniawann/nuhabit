"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/hris/RichTextEditor";
import type { LogbookEntryItem } from "../types";

interface NoteDialogProps {
  item: LogbookEntryItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (itemId: string, notes: string) => void;
}

/**
 * Dialog catatan per item checklist, pengganti overlay Quill fullscreen.
 * HTML dirender di tempat lain lewat <SafeHtml> (sanitasi DOMPurify).
 */
export function LogbookNoteDialog({ item, saving, onClose, onSave }: NoteDialogProps) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Catatan — {item?.title}</DialogTitle>
        </DialogHeader>
        {/* key per item: draft mulai dari catatan item ini, tidak terbawa ke item lain. */}
        {item && (
          <NoteEditor key={item.id} item={item} saving={saving} onClose={onClose} onSave={onSave} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteEditor({ item, saving, onClose, onSave }: NoteDialogProps & { item: LogbookEntryItem }) {
  const [draft, setDraft] = useState(item.notes || "");
  return (
    <>
      <RichTextEditor
        value={item.notes || ""}
        onChange={setDraft}
        placeholder="Tulis catatan checklist di sini..."
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button onClick={() => onSave(item.id, draft)} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Catatan"}
        </Button>
      </DialogFooter>
    </>
  );
}
