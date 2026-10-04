"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";

/**
 * EPIC-042: kelola Open API token (integrasi agent eksternal, mis. OpenClaw).
 * Token tampil SEKALI saat dibuat — setelah dialog ditutup tidak bisa dilihat
 * lagi (DB hanya menyimpan hash); yang hilang harus dibuat ulang.
 */

const SCOPE_MODULES = [
  "pos",
  "member",
  "hris",
  "inventory",
  "crm",
  "config",
  "reports",
  "other",
] as const;

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  user_name: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};


export function ApiTokensPage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [allAccess, setAllAccess] = useState(true);
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [expiresDays, setExpiresDays] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data: listData } = useQuery({
    queryKey: ["admin-api-tokens"],
    queryFn: async () => {
      const res = await fetch("/api/admin/api-tokens", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Gagal memuat token");
      return json as { data: TokenRow[]; migration_pending?: boolean };
    },
  });
  const rows = listData?.data ?? [];
  const migrationPending = Boolean(listData?.migration_pending);
  const load = () => queryClient.invalidateQueries({ queryKey: ["admin-api-tokens"] });

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const create = async () => {
    const chosen = allAccess ? ["*"] : [...scopes];
    if (!name.trim() || chosen.length === 0) {
      toast.error("Isi nama token dan pilih minimal satu scope");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: chosen,
          expires_in_days: Number(expiresDays) > 0 ? Number(expiresDays) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal membuat token");
      setNewToken(json.data.token);
      setName("");
      setScopes(new Set());
      setExpiresDays("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat token");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: TokenRow) => {
    if (!window.confirm(`Cabut token "${row.name}"? Integrasi yang memakainya langsung putus.`)) {
      return;
    }
    const res = await fetch(`/api/admin/api-tokens/${row.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || "Gagal mencabut token");
      return;
    }
    toast.success(`Token "${row.name}" dicabut`);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Open API Tokens</h2>
        <p className="text-sm text-muted-foreground">
          Akses API untuk sistem eksternal (agent, integrasi). Kirim header{" "}
          <code className="rounded bg-muted px-1">Authorization: Bearer nh_…</code>. Spesifikasi
          endpoint: <code className="rounded bg-muted px-1">/api/openapi.json</code>.
        </p>
      </div>

      {migrationPending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Tabel token belum ada di database ini — jalankan migrasi lebih dulu:{" "}
          <code>pnpm db:migrate:apply</code>.
        </div>
      )}

      {newToken && (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">
            Token dibuat. Salin SEKARANG — tidak akan tampil lagi setelah halaman ini ditinggalkan.
          </p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 overflow-x-auto rounded bg-white px-2 py-1 text-xs">
              {newToken}
            </code>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(newToken);
                toast.success("Token disalin");
              }}
            >
              Salin
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setNewToken(null)}>
              Tutup
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Buat token baru</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Nama token (mis. OpenClaw Agent)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Masa berlaku (hari, kosong = tanpa batas)"
            inputMode="numeric"
            value={expiresDays}
            onChange={(e) => setExpiresDays(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allAccess}
              onChange={(e) => setAllAccess(e.target.checked)}
            />
            <span className="font-medium">Semua akses (*)</span>
          </label>
          {!allAccess &&
            SCOPE_MODULES.map((moduleKey) => (
              <span key={moduleKey} className="flex items-center gap-2 rounded border px-2 py-1">
                <span className="font-medium">{moduleKey}</span>
                {(["read", "write"] as const).map((access) => {
                  const scope = `${moduleKey}:${access}`;
                  return (
                    <label key={scope} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={scopes.has(scope)}
                        onChange={() => toggleScope(scope)}
                      />
                      {access}
                    </label>
                  );
                })}
              </span>
            ))}
        </div>
        <Button type="button" onClick={() => void create()} disabled={busy}>
          {busy ? "Membuat…" : "Buat token"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Prefix</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Akun</th>
              <th className="px-3 py-2">Terakhir dipakai</th>
              <th className="px-3 py-2">Kedaluwarsa</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Belum ada token
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.token_prefix}…</td>
                <td className="px-3 py-2 font-mono text-xs">{row.scopes.join(", ")}</td>
                <td className="px-3 py-2">{row.user_name ?? "—"}</td>
                <td className="px-3 py-2">{formatDateTime(row.last_used_at, "—")}</td>
                <td className="px-3 py-2">{formatDateTime(row.expires_at, "—")}</td>
                <td className="px-3 py-2">
                  {row.revoked_at ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      Dicabut
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                      Aktif
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {!row.revoked_at && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => void revoke(row)}
                    >
                      Cabut
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
