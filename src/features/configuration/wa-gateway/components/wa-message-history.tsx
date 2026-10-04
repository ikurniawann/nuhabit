"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  ArrowDownLeft,
  ArrowUpRight,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Smartphone,
} from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * EPIC-012 Fase A — riwayat pesan WhatsApp: siapa penerimanya, apa statusnya.
 * Pesan masuk (Fase B) ikut tampil lewat filter arah.
 */

interface WaMessage {
  id: string;
  direction: "in" | "out";
  message_type: "otp" | "notification" | "chat" | "broadcast" | "system";
  phone: string;
  body: string | null;
  media_type: string | null;
  status: "queued" | "sent" | "failed" | "received";
  provider: string | null;
  error_reason: string | null;
  wa_from_me: boolean;
  created_at: string;
  customer_name: string | null;
}

interface Summary {
  total_out: number;
  total_in: number;
  total_failed: number;
}

const TYPE_LABELS: Record<WaMessage["message_type"], string> = {
  otp: "OTP",
  notification: "Notifikasi",
  chat: "Chat",
  broadcast: "Broadcast",
  system: "Sistem",
};

const STATUS_STYLES: Record<WaMessage["status"], string> = {
  sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  received: "bg-sky-50 text-sky-700 border-sky-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
};

const STATUS_LABELS: Record<WaMessage["status"], string> = {
  sent: "Terkirim",
  received: "Diterima",
  failed: "Gagal",
  queued: "Antre",
};

type HistoryFilters = {
  direction: string;
  type: string;
  status: string;
  search: string;
};

function fetchMessageHistory(filters: HistoryFilters) {
  const params = Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [
      key,
      value === "all" ? undefined : value || undefined,
    ]),
  );
  return apiGet<{ data: { messages?: WaMessage[]; summary?: Summary } }>(
    buildListUrl("/api/settings/wa-gateway/messages", params),
  ).then((r) => r.data);
}

/** Teks cari yang baru ikut berubah setelah jeda ketik. */

export function WaMessageHistory() {
  const [direction, setDirection] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    error: string | null;
    message: string | null;
  }>({
    error: null,
    message: null,
  });

  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const filters = {
    direction,
    type: typeFilter,
    status: statusFilter,
    search: debouncedSearch,
  };
  const historyQuery = useQuery({
    queryKey: ["settings", "wa-gateway", "messages", filters],
    queryFn: () => fetchMessageHistory(filters),
  });
  const messages = historyQuery.data?.messages ?? [];
  const summary = historyQuery.data?.summary ?? null;
  const loading = historyQuery.isLoading;
  const loadError =
    historyQuery.error instanceof Error ? historyQuery.error.message : null;
  const shownError = feedback.error ?? loadError;
  const load = async () => {
    await historyQuery.refetch();
  };

  async function resend(message: WaMessage) {
    setResendingId(message.id);
    setFeedback({ error: null, message: null });

    try {
      await apiPost("/api/settings/wa-gateway/messages", { id: message.id });
      setFeedback({
        error: null,
        message: `Pesan ke ${message.phone} dikirim ulang.`,
      });
      await load();
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal mengirim ulang",
        message: null,
      });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={ArrowUpRight}
            label="Pesan keluar"
            value={formatNumber(summary.total_out)}
          />
          <SummaryCard
            icon={ArrowDownLeft}
            label="Pesan masuk"
            value={formatNumber(summary.total_in)}
          />
          <SummaryCard
            icon={Send}
            label="Gagal kirim"
            value={formatNumber(summary.total_failed)}
            tone={summary.total_failed > 0 ? "red" : "default"}
          />
        </div>
      )}

      {(shownError || feedback.message) && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            shownError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {shownError || feedback.message}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[1fr_repeat(3,150px)]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nomor atau nama member..."
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
          </label>
          <FilterSelect
            value={direction}
            onChange={setDirection}
            options={[
              ["all", "Semua arah"],
              ["out", "Keluar"],
              ["in", "Masuk"],
            ]}
          />
          <FilterSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              ["all", "Semua jenis"],
              ["otp", "OTP"],
              ["notification", "Notifikasi"],
              ["chat", "Chat"],
              ["broadcast", "Broadcast"],
            ]}
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              ["all", "Semua status"],
              ["sent", "Terkirim"],
              ["received", "Diterima"],
              ["failed", "Gagal"],
            ]}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="size-6 animate-spin text-slate-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-slate-500">
            Belum ada pesan pada filter ini.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {messages.map((message) => (
              <div
                key={message.id}
                className="grid gap-2 px-4 py-3 lg:grid-cols-[24px_220px_1fr_190px] lg:items-start"
              >
                <div
                  className="pt-0.5"
                  title={message.direction === "out" ? "Keluar" : "Masuk"}
                >
                  {message.direction === "out" ? (
                    <ArrowUpRight className="size-4 text-slate-400" />
                  ) : (
                    <ArrowDownLeft className="size-4 text-sky-500" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {message.customer_name || `+${message.phone}`}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {message.customer_name && <span>+{message.phone}</span>}
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5">
                      {message.message_type === "otp" && (
                        <KeyRound className="size-3" />
                      )}
                      {message.message_type === "chat" && (
                        <MessageCircle className="size-3" />
                      )}
                      {TYPE_LABELS[message.message_type]}
                    </span>
                    {message.wa_from_me && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700">
                        <Smartphone className="size-3" /> dari HP
                      </span>
                    )}
                  </div>
                </div>

                <div className="min-w-0 text-sm text-slate-600">
                  {message.message_type === "otp" ? (
                    <span className="italic text-slate-400">
                      Isi OTP tidak disimpan (kebijakan keamanan)
                    </span>
                  ) : message.body ? (
                    <span className="line-clamp-2">{message.body}</span>
                  ) : message.media_type ? (
                    <span className="italic text-slate-400">
                      [{message.media_type}]
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                  {message.error_reason && (
                    <div className="mt-1 text-xs text-red-600">
                      {message.error_reason}
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-between gap-2 lg:flex-col lg:items-end">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[message.status]}`}
                  >
                    {STATUS_LABELS[message.status]}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatDateTime(message.created_at)}
                  </span>
                  {message.status === "failed" &&
                    message.message_type !== "otp" &&
                    message.body && (
                      <button
                        type="button"
                        onClick={() => void resend(message)}
                        disabled={resendingId === message.id}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                      >
                        {resendingId === message.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3" />
                        )}
                        Kirim ulang
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Send;
  label: string;
  value: string;
  tone?: "default" | "red";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`mb-2 flex size-9 items-center justify-center rounded-md ${
          tone === "red"
            ? "bg-red-50 text-red-600"
            : "bg-slate-100 text-slate-700"
        }`}
      >
        <Icon className="size-4" />
      </div>
      <div className="text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}
