"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, MessageSquareReply, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { crmFetch } from "../crm-fetch";
import { REVIEW_REPLY_MAX, type ReviewSummary } from "@/lib/crm/member-reviews";

interface MemberReview {
  id: string;
  order_number: string;
  order_total: number;
  rating: number;
  comment: string | null;
  status: "new" | "replied" | "hidden";
  reply: string | null;
  replied_at: string | null;
  replied_by_name: string | null;
  created_at: string;
  member_name: string | null;
  member_phone: string;
  outlet_name: string | null;
}

interface ReviewsResponse {
  reviews: MemberReview[];
  summary: ReviewSummary;
  outlets: Array<{ id: string; name: string }>;
}

interface Filters {
  status: string;
  rating: string;
  branch_id: string;
  q: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { status: "", rating: "", branch_id: "", q: "", from: "", to: "" };

const STATUS_BADGE: Record<MemberReview["status"], { label: string; variant: "accent" | "success" | "muted" }> = {
  new: { label: "Baru", variant: "accent" },
  replied: { label: "Dibalas", variant: "success" },
  hidden: { label: "Disembunyikan", variant: "muted" },
};

const SELECT =
  "h-10 rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest";

const waktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

const call = <T,>(url: string, init?: RequestInit) => crmFetch<T>(url, init).then((r) => r.data);

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-3.5 ${n <= value ? "fill-warning text-warning" : "text-silver"}`} />
      ))}
    </span>
  );
}

/** CRM → Customer Care → Ulasan Member: rating order dari portal, balasan, ringkasan. */
export function MemberReviewsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [replying, setReplying] = useState<MemberReview | null>(null);
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== ""));
  const queryKey = ["crm", "member-reviews", params.toString()];
  const reviews = useQuery({
    queryKey,
    queryFn: () => call<ReviewsResponse>(`/api/crm/member-reviews?${params}`),
  });
  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: "hidden" | "visible" }) =>
      call(`/api/crm/member-reviews/${input.id}`, { method: "PATCH", body: JSON.stringify({ status: input.status }) }),
    onSuccess: (_d, input) => {
      toast.success(input.status === "hidden" ? "Ulasan disembunyikan" : "Ulasan ditampilkan lagi");
      void queryClient.invalidateQueries({ queryKey: ["crm", "member-reviews"] });
    },
    onError: (error) => toast.error("Status ulasan gagal diubah", { description: error.message }),
  });
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((cur) => ({ ...cur, [k]: e.target.value }));

  const summary = reviews.data?.summary;
  const rows = reviews.data?.reviews ?? [];
  const newCount = rows.filter((r) => r.status === "new").length;
  const maxBucket = Math.max(1, ...(summary?.distribution ?? [0]));

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Customer Care"
        title="Ulasan Member"
        description="Rating 1–5 yang diberikan member untuk order lunas dari portal (maksimal 14 hari setelah order). Balasan Anda tampil ke member."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Rata-rata rating"
          value={summary?.average != null ? summary.average.toLocaleString("id-ID") : "-"}
          unit="/ 5"
          icon={<Star />}
          tone="ink"
        />
        <StatCard label="Total ulasan" value={(summary?.count ?? 0).toLocaleString("id-ID")} hint="Tanpa yang disembunyikan" />
        <StatCard
          label="Belum dibalas"
          value={newCount.toLocaleString("id-ID")}
          hint="Di filter saat ini"
          icon={<MessageSquareReply />}
          tone={newCount > 0 ? "accent" : "default"}
        />
      </div>

      {summary && summary.count > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
          <Card className="gap-2 px-5">
            <p className="text-sm font-semibold">Sebaran bintang</p>
            {[5, 4, 3, 2, 1].map((star) => {
              const n = summary.distribution[star - 1];
              return (
                <div key={star} className="flex items-center gap-3 text-sm">
                  <span className="w-6 tabular-nums">{star}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${star <= 2 ? "bg-danger" : "bg-ink"}`}
                      style={{ width: `${(n / maxBucket) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums text-muted-foreground">{n}</span>
                </div>
              );
            })}
          </Card>
          <Card className="gap-2 px-5">
            <p className="text-sm font-semibold">Per outlet</p>
            {summary.outlets.map((o) => (
              <div key={o.branch_id ?? "none"} className="flex items-center justify-between text-sm">
                <span className="min-w-0 truncate">{o.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {o.average.toLocaleString("id-ID")}★ · {o.count} ulasan
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-56" placeholder="Cari member/komentar" value={filters.q} onChange={set("q")} />
        <select className={SELECT} value={filters.status} onChange={set("status")} aria-label="Status">
          <option value="">Semua status</option>
          <option value="new">Baru</option>
          <option value="replied">Dibalas</option>
          <option value="hidden">Disembunyikan</option>
        </select>
        <select className={SELECT} value={filters.rating} onChange={set("rating")} aria-label="Bintang">
          <option value="">Semua bintang</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} bintang
            </option>
          ))}
        </select>
        <select className={SELECT} value={filters.branch_id} onChange={set("branch_id")} aria-label="Outlet">
          <option value="">Semua outlet</option>
          {(reviews.data?.outlets ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Input type="date" className="w-auto" value={filters.from} onChange={set("from")} aria-label="Dari tanggal" />
        <Input type="date" className="w-auto" value={filters.to} onChange={set("to")} aria-label="Sampai tanggal" />
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset
          </Button>
        )}
      </div>

      <Card className="py-0">
        {reviews.isLoading ? (
          <TableNote>Memuat ulasan…</TableNote>
        ) : reviews.error ? (
          <TableNote tone="danger">{reviews.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada ulasan yang cocok dengan filter.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ulasan</TableHead>
                <TableHead className="hidden md:table-cell">Member & order</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((review) => (
                <TableRow key={review.id} className={review.status === "hidden" ? "opacity-60" : undefined}>
                  <TableCell className="max-w-md whitespace-normal">
                    <Stars value={review.rating} />
                    <p className="mt-1">{review.comment ?? <span className="text-muted-foreground">Tanpa komentar</span>}</p>
                    {review.reply && (
                      <p className="mt-2 rounded-2xl bg-surface-2 px-3 py-2 text-xs">
                        <span className="font-semibold">Balasan{review.replied_by_name ? ` ${review.replied_by_name}` : ""}:</span>{" "}
                        {review.reply}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      {review.member_name ?? review.member_phone} · {review.order_number}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="font-medium">{review.member_name ?? "Member"}</p>
                    <p className="text-xs text-muted-foreground">
                      {review.order_number} · {review.outlet_name ?? "-"} · {waktu(review.created_at)}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant={STATUS_BADGE[review.status].variant}>{STATUS_BADGE[review.status].label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setReplying(review)}>
                        <MessageSquareReply /> {review.reply ? "Ubah balasan" : "Balas"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate({ id: review.id, status: review.status === "hidden" ? "visible" : "hidden" })
                        }
                      >
                        <EyeOff /> {review.status === "hidden" ? "Tampilkan" : "Sembunyikan"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {replying && (
        <ReplyDialog
          review={replying}
          onClose={() => setReplying(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["crm", "member-reviews"] })}
        />
      )}
    </div>
  );
}

function ReplyDialog({ review, onClose, onSaved }: { review: MemberReview; onClose: () => void; onSaved: () => void }) {
  const [reply, setReply] = useState(review.reply ?? "");
  const save = useMutation({
    mutationFn: () =>
      call(`/api/crm/member-reviews/${review.id}`, { method: "PATCH", body: JSON.stringify({ reply: reply.trim() }) }),
    onSuccess: () => {
      toast.success("Balasan terkirim", { description: "Member mendapat notifikasi di portal." });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Balasan gagal disimpan", { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Balas ulasan {review.member_name ?? "member"}</DialogPanelTitle>
            <DialogPanelDescription>
              {review.rating}★ · {review.comment ?? "Tanpa komentar"}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <Field label="Balasan" hint="Tampil ke member di menu Ulasan portal.">
              <textarea
                className={TEXTAREA}
                value={reply}
                maxLength={REVIEW_REPLY_MAX}
                onChange={(e) => setReply(e.target.value)}
                required
              />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={reply.trim().length < 2 || save.isPending}>
              Kirim balasan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
