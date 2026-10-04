"use client";

// Gate Mapping — SCAFFOLD (disiapkan dulu). Me-list ticket ber-gate (has_gate=
// true) yang nantinya dipetakan ke controller gate fisik (gateway koneksi).
// Koneksi controller riil menyusul; halaman ini menyiapkan daftar & slot map.

import { useMemo, useState } from "react";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Cable, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useProducts } from "../queries";

export function GateMappingPage() {
  const [q, setQ] = useState("");
  const productsQuery = useProducts("");
  const gated = useMemo(
    () => (productsQuery.data ?? []).filter((p) => p.has_gate),
    [productsQuery.data]
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return gated;
    return gated.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.code.toLowerCase().includes(term)
    );
  }, [gated, q]);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Gate Mapping</h1>
        <p className="mt-1 text-sm text-gray-500">
          Petakan ticket ber-gate ke controller gate fisik. Hanya ticket dengan
          <span className="font-medium text-gray-700"> “Punya gate” aktif</span>{" "}
          yang muncul di sini — ticket tanpa gate divalidasi penjaga keliling
          dengan reader NFC.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Cable className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Koneksi ke controller gate akan diaktifkan pada tahap berikutnya.
          Halaman ini menyiapkan daftar & slot pemetaan.
        </span>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title="Ticket Ber-gate"
        description="Ticket yang divalidasi lewat gate/turnstile fisik."
        toolbar={
          <Input
            placeholder="Cari nama / kode…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-52"
          />
        }
      >
        {productsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat ticket…</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">
            Belum ada ticket ber-gate. Aktifkan “Punya gate” pada ticket di
            Master Ticket.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Ticket</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">
                    Controller Gate
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Koneksi</th>
                </TableRow>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <TableRow
                    key={p.id}
                    className="border-b border-gray-100 hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      <p className="font-mono text-xs text-gray-500">{p.code}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${
                          p.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {/* Slot pemetaan — non-fungsional dulu (disiapkan) */}
                      <Input
                        placeholder="ID / endpoint controller…"
                        disabled
                        className="h-8 w-56 text-xs"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="border-0 bg-gray-100 font-normal text-gray-500">
                        Belum terhubung
                      </Badge>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
