"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Hourglass, Loader2, MinusCircle, Plus, Search, Ticket, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api-client";
import { computeValidUntil, PASS_STATUS_LABEL, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/studio/pass";
import type {
  ApiMessage,
  EffectivePassStatus,
  MemberOption,
  PassLedgerRow,
  PassListRow,
  PassProductRow,
  PassSummary,
} from "../types";
import { formatDate, rupiah, todayIso } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";
import { OpenMemberAppButton } from "./open-member-app";

const STATUS_TONE: Record<EffectivePassStatus, "positive" | "warning" | "danger" | "neutral" | "brand"> = {
  active: "positive",
  scheduled: "neutral",
  pending_payment: "warning",
  exhausted: "warning",
  expired: "danger",
  cancelled: "neutral",
};

/**
 * POST dengan batas waktu: kalau respons tidak datang dalam 15 detik (koneksi
 * putus/tertahan), spinner berhenti dan user diminta mencoba lagi — percobaan
 * ulang aman karena nomor yang sudah tersimpan langsung dipakai.
 */
async function postWithTimeout(url: string, body: unknown, ms = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Koneksi lambat — data mungkin sudah tersimpan. Klik Daftarkan lagi untuk melanjutkan.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function credits(left: number, total: number) {
  return total > 0 ? `${left}/${total}` : "—";
}

export function StudioPassesPage() {
  const [rows, setRows] = useState<PassListRow[] | null>(null);
  const [summary, setSummary] = useState<PassSummary | null>(null);
  const [view, setView] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [showSell, setShowSell] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [expiring, setExpiring] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ data: PassListRow[]; summary: PassSummary }>(
        `/api/studio/passes?view=${view}${query ? `&q=${encodeURIComponent(query)}` : ""}`
      );
      setRows(res.data);
      setSummary(res.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat pass");
      setRows([]);
    }
  }, [view, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runExpiry() {
    if (!confirm("Proses pass yang sudah lewat masa berlaku? Sisa kredit dan nilai facility akan diakui sebagai revenue.")) return;
    setExpiring(true);
    try {
      const res = await apiPost<ApiMessage>("/api/studio/passes/expire", {});
      toast.success(res.message ?? "Selesai");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses kedaluwarsa");
    } finally {
      setExpiring(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Member Pass"
        subtitle="Pass milik member, sisa kredit, masa berlaku, dan utang pass yang belum di-redeem."
        actions={
          <>
            {summary && summary.due_for_expiry > 0 && (
              <Button variant="outline" onClick={runExpiry} disabled={expiring}>
                {expiring ? <Loader2 className="size-4 animate-spin" /> : <Hourglass className="size-4" />}
                Proses kedaluwarsa ({summary.due_for_expiry})
              </Button>
            )}
            <Button onClick={() => setShowSell(true)}>
              <Plus className="size-4" /> Jual pass
            </Button>
          </>
        }
      />

      {summary && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Pass aktif" value={String(summary.active_passes)} />
          <Stat label="Utang pass (belum di-redeem)" value={rupiah(summary.liability)} highlight />
          <Stat label="Kredit kelas tersisa" value={summary.class_credits_left.toLocaleString("id-ID")} />
          <Stat label="Kredit Personal Training tersisa" value={summary.pt_credits_left.toLocaleString("id-ID")} />
          <Stat label="Berakhir ≤ 7 hari" value={String(summary.expiring_7d)} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari nama, HP, atau kode pass" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(["active", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${view === v ? "bg-nh-forest text-nh-lime" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "active" ? "Aktif" : "Semua"}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={query ? "Tidak ada pass yang cocok" : "Belum ada pass"}
          description={query ? "Coba kata kunci lain atau lihat tab Semua." : "Jual pass pertama dari front desk; member baru bisa didaftarkan langsung."}
          action={!query && <Button onClick={() => setShowSell(true)}>Jual pass</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Pass</th>
                <th className="px-4 py-3 text-right">Kelas</th>
                <th className="px-4 py-3 text-right">Personal Training</th>
                <th className="px-4 py-3">Berlaku s/d</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Utang</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => setDetailId(p.id)} className="cursor-pointer border-t border-border transition hover:bg-nh-lemon/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{p.member_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.member_phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{p.product_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {p.pass_code}
                      {p.facility_access ? " · facility" : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{credits(p.class_left, p.class_credits_total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{credits(p.pt_left, p.pt_credits_total)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatDate(p.valid_until)}
                    {p.frozen_days > 0 && <span className="ml-1 text-xs text-muted-foreground">(+{p.frozen_days}h)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={STATUS_TONE[p.effective_status]}>{PASS_STATUS_LABEL[p.effective_status]}</Pill>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.liability > 0 ? rupiah(p.liability) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSell && (
        <SellPassDialog
          onClose={() => setShowSell(false)}
          onSold={(id) => {
            setShowSell(false);
            void load();
            setDetailId(id);
          }}
        />
      )}
      {detailId && <PassDetailDialog id={detailId} onClose={() => setDetailId(null)} onChanged={() => void load()} />}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${highlight ? "border-nh-forest bg-nh-forest text-nh-beige" : "border-border bg-card"}`}>
      <p className={`text-xs ${highlight ? "text-nh-beige/70" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${highlight ? "text-nh-lime" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

// ── Jual pass ──────────────────────────────────────────────────────────────

function SellPassDialog({ onClose, onSold }: { onClose: () => void; onSold: (passId: string) => void }) {
  const [products, setProducts] = useState<PassProductRow[]>([]);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", phone: "", email: "" });
  const [productId, setProductId] = useState("");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>("qris");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [registering, setRegistering] = useState(false);
  const [selling, setSelling] = useState(false);
  const busy = registering || selling;

  useEffect(() => {
    apiGet<{ data: PassProductRow[] }>("/api/studio/pass-products?active=1")
      .then((res) => {
        setProducts(res.data);
        if (res.data[0]) setProductId(res.data[0].id);
      })
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    if (member || creating || search.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      apiGet<{ data: MemberOption[] }>(`/api/studio/members?q=${encodeURIComponent(search.trim())}`)
        .then((res) => setResults(res.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search, member, creating]);

  const product = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const price = method === "complimentary" ? 0 : customPrice ? Number(customPrice.replace(/\D/g, "")) : product?.price ?? 0;

  async function registerMember() {
    if (!newMember.name.trim() || !newMember.phone.trim()) {
      toast.error("Nama dan nomor HP wajib diisi");
      return;
    }
    setRegistering(true);
    try {
      const res = await postWithTimeout("/api/studio/members", newMember);
      if (res.status === 409 && res.json?.existing) {
        // Nomor sudah ada (mis. percobaan sebelumnya ternyata tersimpan) → pakai member itu.
        setMember(res.json.existing as MemberOption);
        setCreating(false);
        toast.info(`Nomor sudah terdaftar — memakai member ${res.json.existing.name ?? res.json.existing.phone}`);
        return;
      }
      if (!res.ok) throw new Error(res.json?.error ?? "Gagal mendaftarkan member");
      toast.success(res.json?.message ?? "Member terdaftar");
      setMember(res.json.data as MemberOption);
      setCreating(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mendaftarkan member");
    } finally {
      setRegistering(false);
    }
  }

  async function sell() {
    if (!member || !product) return;
    setSelling(true);
    try {
      const res = await apiPost<{ data: { id: string }; message?: string }>("/api/studio/passes", {
        customer_id: member.id,
        product_id: product.id,
        valid_from: validFrom,
        payment_method: method,
        payment_ref: ref.trim() || null,
        notes: notes.trim() || null,
        price_override: customPrice && method !== "complimentary" ? price : null,
      });
      toast.success(res.message ?? "Pass terjual");
      onSold(res.data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menjual pass");
    } finally {
      setSelling(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Jual pass</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <p className="text-[13px] font-semibold text-foreground">1. Member</p>
          {member ? (
            <div className="flex items-center justify-between rounded-xl border border-nh-forest bg-nh-lemon/50 px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{member.name ?? "Tanpa nama"}</p>
                <p className="text-xs text-muted-foreground">
                  {member.phone}
                  {member.active_passes ? ` · ${member.active_passes} pass aktif` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMember(null)}>Ganti</Button>
            </div>
          ) : creating ? (
            <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
              <Field label="Nama">
                <Input value={newMember.name} onChange={(e) => setNewMember((m) => ({ ...m, name: e.target.value }))} />
              </Field>
              <Field label="No. HP / WhatsApp" hint="Dipakai login Member App">
                <Input value={newMember.phone} inputMode="tel" onChange={(e) => setNewMember((m) => ({ ...m, phone: e.target.value }))} placeholder="0812…" />
              </Field>
              <Field label="Email (opsional)" className="sm:col-span-2">
                <Input value={newMember.email} type="email" onChange={(e) => setNewMember((m) => ({ ...m, email: e.target.value }))} />
              </Field>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="outline" size="sm" onClick={() => setCreating(false)} disabled={busy}>Batal</Button>
                <Button size="sm" onClick={registerMember} disabled={registering}>
                  {registering && <Loader2 className="size-3.5 animate-spin" />} Daftarkan
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Cari nama atau nomor HP member" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              </div>
              {searching && <p className="text-xs text-muted-foreground">Mencari…</p>}
              {results.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-xl border border-border">
                  {results.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setMember(m)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-nh-lemon/40">
                        <span>
                          <span className="font-medium text-foreground">{m.name ?? "Tanpa nama"}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{m.phone}</span>
                        </span>
                        {m.active_passes ? <Pill tone="positive">{m.active_passes} aktif</Pill> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {search.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="text-xs text-muted-foreground">Member tidak ditemukan.</p>
              )}
              <Button variant="outline" size="sm" onClick={() => { setCreating(true); setNewMember((m) => ({ ...m, phone: /\d/.test(search) ? search : m.phone, name: /\d/.test(search) ? m.name : search })); }}>
                <UserPlus className="size-3.5" /> Member baru
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-[13px] font-semibold text-foreground">2. Paket & pembayaran</p>
          {products.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Belum ada paket aktif. Buat dulu di menu Paket Member.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paket" className="sm:col-span-2">
                <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {rupiah(p.price)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Mulai berlaku">
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </Field>
              <Field label="Metode bayar">
                <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {(["qris", "cash", "card", "transfer", "complimentary"] as const).map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Harga khusus (opsional)" hint="Kosongkan untuk harga paket">
                <Input inputMode="numeric" value={customPrice} disabled={method === "complimentary"} onChange={(e) => setCustomPrice(e.target.value)} />
              </Field>
              <Field label="No. referensi">
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ID transaksi QRIS / EDC" />
              </Field>
              <Field label="Catatan" className="sm:col-span-2">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          )}
        </section>

        {product && (
          <div className="rounded-xl bg-nh-forest p-4 text-nh-beige">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-nh-beige/75">
                {product.class_credits ? `${product.class_credits}x kelas` : ""}
                {product.pt_credits ? ` + ${product.pt_credits}x Personal Training` : ""}
                {product.facility_access ? " + facility" : ""} · berlaku s/d {formatDate(computeValidUntil(validFrom, product.validity_days))}
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums text-nh-lime">{rupiah(price)}</p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={sell} disabled={busy || !member || !product}>
            {selling && <Loader2 className="size-4 animate-spin" />}
            <Ticket className="size-4" /> Terbitkan pass
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail pass ────────────────────────────────────────────────────────────

type DetailData = PassListRow & { ledger: PassLedgerRow[] };
type Action = "adjust" | "extend" | "cancel" | null;

const ENTRY_LABEL: Record<PassLedgerRow["entry_type"], string> = {
  issue: "Penerbitan",
  redeem: "Dipakai",
  unredeem: "Dikembalikan",
  adjust: "Penyesuaian",
  expire: "Kedaluwarsa",
  cancel: "Dibatalkan",
};

function PassDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState({ credit_type: "class" as "class" | "pt", qty: "1", note: "" });
  const [extend, setExtend] = useState({ days: "7", reason: "" });
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    try {
      setData((await apiGet<{ data: DetailData }>(`/api/studio/passes/${id}`)).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat pass");
      onClose();
    }
  }, [id, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(path: string, body: unknown) {
    setBusy(true);
    try {
      const res = await apiPost<ApiMessage>(`/api/studio/passes/${id}/${path}`, body);
      toast.success(res.message ?? "Tersimpan");
      setAction(null);
      onChanged();
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  const locked = !data || data.status === "cancelled" || data.effective_status === "expired";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {!data ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
                <DialogTitle>{data.member_name ?? data.member_phone}</DialogTitle>
                <OpenMemberAppButton customerId={data.customer_id} />
              </div>
            </DialogHeader>
            <div className="rounded-xl bg-nh-forest p-4 text-nh-beige">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-nh-beige/70">{data.pass_code}</p>
                  <p className="font-display text-lg font-semibold">{data.product_name}</p>
                  <p className="text-xs text-nh-beige/70">
                    {formatDate(data.valid_from)} – {formatDate(data.valid_until)}
                    {data.frozen_days > 0 ? ` · diperpanjang ${data.frozen_days} hari` : ""}
                  </p>
                </div>
                <Pill tone={STATUS_TONE[data.effective_status]} className="bg-nh-beige/15 text-nh-lime">
                  {PASS_STATUS_LABEL[data.effective_status]}
                </Pill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Meter label="Kelas" left={data.class_left} total={data.class_credits_total} />
                <Meter label="Personal Training" left={data.pt_left} total={data.pt_credits_total} />
                <div>
                  <p className="text-xs text-nh-beige/70">Utang tersisa</p>
                  <p className="font-display text-lg font-semibold tabular-nums text-nh-lime">{rupiah(data.liability)}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <Info label="Dibayar" value={rupiah(data.price_paid)} />
              <Info label="Metode" value={data.payment_method ? PAYMENT_METHOD_LABEL[data.payment_method as PaymentMethod] ?? data.payment_method : "—"} />
              <Info label="Jurnal" value={data.journal_entry_id ? "Terposting" : "Belum diposting"} />
            </div>
            {data.cancel_reason && <p className="text-sm text-destructive">Alasan batal: {data.cancel_reason}</p>}
            {data.notes && <p className="whitespace-pre-line text-xs text-muted-foreground">{data.notes}</p>}

            {!locked && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setAction(action === "adjust" ? null : "adjust")}>
                  <MinusCircle className="size-3.5" /> Sesuaikan kredit
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAction(action === "extend" ? null : "extend")}>
                  <CalendarClock className="size-3.5" /> Perpanjang / freeze
                </Button>
                {data.class_used === 0 && data.pt_used === 0 && (
                  <Button variant="destructive" size="sm" onClick={() => setAction(action === "cancel" ? null : "cancel")}>
                    <XCircle className="size-3.5" /> Batalkan
                  </Button>
                )}
              </div>
            )}

            {action === "adjust" && (
              <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
                <Field label="Jenis kredit">
                  <NativeSelect value={adjust.credit_type} onChange={(e) => setAdjust((a) => ({ ...a, credit_type: e.target.value as "class" | "pt" }))}>
                    <option value="class">Kelas</option>
                    <option value="pt" disabled={data.pt_credits_total === 0}>Personal Training</option>
                  </NativeSelect>
                </Field>
                <Field label="Jumlah" hint="+ kembalikan, − kurangi">
                  <Input type="number" value={adjust.qty} onChange={(e) => setAdjust((a) => ({ ...a, qty: e.target.value }))} />
                </Field>
                <Field label="Alasan" className="sm:col-span-3">
                  <Input value={adjust.note} onChange={(e) => setAdjust((a) => ({ ...a, note: e.target.value }))} placeholder="Mis. kompensasi kelas dibatalkan" />
                </Field>
                <div className="flex justify-end sm:col-span-3">
                  <Button size="sm" disabled={busy} onClick={() => submit("adjust", { credit_type: adjust.credit_type, qty: Number(adjust.qty), note: adjust.note })}>
                    Simpan penyesuaian
                  </Button>
                </div>
              </div>
            )}
            {action === "extend" && (
              <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
                <Field label="Tambah hari">
                  <Input type="number" min={1} max={180} value={extend.days} onChange={(e) => setExtend((x) => ({ ...x, days: e.target.value }))} />
                </Field>
                <Field label="Alasan" className="sm:col-span-2">
                  <Input value={extend.reason} onChange={(e) => setExtend((x) => ({ ...x, reason: e.target.value }))} placeholder="Mis. cuti sakit, perjalanan dinas" />
                </Field>
                <div className="flex justify-end sm:col-span-3">
                  <Button size="sm" disabled={busy} onClick={() => submit("extend", { days: Number(extend.days), reason: extend.reason })}>
                    Perpanjang
                  </Button>
                </div>
              </div>
            )}
            {action === "cancel" && (
              <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm text-foreground">Pass dibatalkan dan dianggap refund penuh ({rupiah(data.price_paid)}). Jurnal pembalik diposting otomatis bila mapping COA tersedia.</p>
                <Field label="Alasan pembatalan">
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <Button variant="destructive" size="sm" disabled={busy} onClick={() => submit("cancel", { reason: cancelReason })}>
                    Batalkan pass
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-[13px] font-semibold text-foreground">Riwayat kredit</p>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.ledger.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground">
                        {ENTRY_LABEL[l.entry_type]} · {l.credit_type === "class" ? "kelas" : l.credit_type === "pt" ? "Personal Training" : "facility"}
                        {l.program_name ? ` · ${l.program_name} ${l.session_date ? formatDate(l.session_date) : ""} ${l.session_time ?? ""}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                        {l.created_by_name ? ` · ${l.created_by_name}` : ""}
                        {l.note ? ` · ${l.note}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className={l.qty < 0 ? "text-destructive" : "text-foreground"}>{l.qty > 0 ? `+${l.qty}` : l.qty}</p>
                      {l.amount > 0 && <p className="text-xs text-muted-foreground">{rupiah(l.amount)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meter({ label, left, total }: { label: string; left: number; total: number }) {
  const pct = total > 0 ? Math.round((left / total) * 100) : 0;
  return (
    <div>
      <p className="text-xs text-nh-beige/70">{label}</p>
      <p className="font-display text-lg font-semibold tabular-nums">{total > 0 ? `${left} / ${total}` : "—"}</p>
      {total > 0 && (
        <div className="mt-1 h-1.5 rounded-full bg-nh-beige/15">
          <div className="h-full rounded-full bg-nh-lime" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-medium text-foreground">{value}</p>
    </div>
  );
}
