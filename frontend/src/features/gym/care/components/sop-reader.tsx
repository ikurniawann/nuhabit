"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate, formatDateTime } from "@/lib/format";
import { SOP_KEYS, sopApi, type MySop } from "../api";
import { parseMarkdown, type Inline } from "../markdown";

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** Isi SOP (markdown sederhana) sebagai elemen biasa, tanpa HTML mentah. */
export function SopBody({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {parseMarkdown(body).map((b, i) => {
        if (b.kind === "heading") {
          const size = b.level === 1 ? "text-lg" : b.level === 2 ? "text-base" : "text-sm";
          return (
            <p key={i} className={`${size} font-semibold`}>
              <InlineText parts={b.text} />
            </p>
          );
        }
        if (b.kind === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List key={i} className={`${b.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <InlineText parts={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <InlineText parts={b.text} />
          </p>
        );
      })}
    </div>
  );
}

/** SOP yang wajib dibaca akun ini; yang belum dikonfirmasi lebih dulu. */
export function useMySops() {
  return useQuery({ queryKey: SOP_KEYS.mine, queryFn: sopApi.mine, staleTime: 60_000 });
}

/** Satu SOP untuk dibaca dan dikonfirmasi. */
export function SopReadCard({ sop }: { sop: MySop }) {
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const ack = useMutation({
    mutationFn: () => sopApi.ack(sop.version_id),
    onSuccess: () => {
      toast.success("Terima kasih, konfirmasi tersimpan");
      void queryClient.invalidateQueries({ queryKey: SOP_KEYS.all });
    },
    onError: (error) => {
      toast.error("Konfirmasi gagal", { description: error.message });
      void queryClient.invalidateQueries({ queryKey: SOP_KEYS.mine });
    },
  });
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{sop.title}</h3>
        <span className="flex items-center gap-2">
          <Badge variant="muted">Versi {sop.version}</Badge>
          {sop.acknowledged_at ? <Badge variant="success">Sudah dikonfirmasi</Badge> : <Badge variant="warning">Belum dibaca</Badge>}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Terbit {formatDate(sop.published_at)}
        {sop.change_note && ` · Perubahan: ${sop.change_note}`}
      </p>
      {sop.body && <SopBody body={sop.body} />}
      {sop.attachment_name && (
        <a
          href={sopApi.fileUrl(sop.version_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
        >
          <FileText className="size-4" aria-hidden /> {sop.attachment_name}
        </a>
      )}
      {sop.acknowledged_at ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden /> Dikonfirmasi {formatDateTime(sop.acknowledged_at)}
        </p>
      ) : (
        <div className="space-y-3 border-t border-border pt-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-forest)]"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            Saya sudah membaca dan memahami SOP ini, dan akan menjalankannya.
          </label>
          <Button disabled={!agreed || ack.isPending} onClick={() => ack.mutate()}>
            Saya sudah membaca dan setuju
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Daftar SOP akun ini (halaman SOP untuk coach). */
export function MySopList() {
  const mine = useMySops();
  if (mine.isLoading) return <p className="text-sm text-muted-foreground">Memuat SOP…</p>;
  if (mine.error) return <p className="text-sm text-danger">{mine.error.message}</p>;
  const list = mine.data ?? [];
  if (list.length === 0) return <Card className="p-5 text-sm text-muted-foreground">Belum ada SOP yang perlu kamu baca.</Card>;
  return (
    <div className="space-y-3">
      {list.map((s) => (
        <SopReadCard key={s.version_id} sop={s} />
      ))}
    </div>
  );
}

/**
 * Banner Kelas Saya: SOP baru yang belum dikonfirmasi, dengan lembar baca.
 * Tautan pengingat (?sop=1) langsung membuka lembarnya. Bungkus dengan
 * Suspense: komponen ini membaca query string.
 */
export function SopBanner() {
  const mine = useMySops();
  const unread = (mine.data ?? []).filter((s) => !s.acknowledged_at);
  const [open, setOpen] = useState(useSearchParams().get("sop") === "1");
  if (unread.length === 0) return null;
  return (
    <>
      <Card className="flex-row flex-wrap items-center justify-between gap-3 bg-warning-soft p-4">
        <p className="text-sm">
          <span className="font-semibold">{unread.length === 1 ? "1 SOP" : `${unread.length} SOP`} perlu kamu baca.</span> Baca lalu
          konfirmasi sebelum mengajar.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Baca SOP
        </Button>
      </Card>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="data-[side=right]:overflow-y-auto data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>SOP Coach</SheetTitle>
            <SheetDescription>Setiap versi baru perlu dikonfirmasi ulang.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            {unread.map((s) => (
              <SopReadCard key={s.version_id} sop={s} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
