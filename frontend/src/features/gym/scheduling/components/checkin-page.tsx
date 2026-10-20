"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, QrCode, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { CheckinLog } from "@/features/gym/members/components/checkin-log";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SELECT } from "@/features/gym/shared";
import { defaultBranchId, useGymBranches } from "@/features/gym/branches";
import { formatNumber } from "@/lib/format";
import { GYM_KEYS, schedulingApi, type CheckInResult } from "../api";
import { DeskMemberSearch } from "./desk-member-search";
import { DropInPanel } from "./drop-in-panel";
import { QrCamera } from "./qr-camera";

const TOKEN_INPUT_ID = "gym-checkin-token";

/**
 * Gym → Check-in: pindai QR kartu member (scanner keyboard + Enter, kamera,
 * atau tempel token), cari member untuk check-in tanpa QR, atau drop-in untuk
 * walk-in. Keputusan tampil di kartu hasil dan log.
 */
export function CheckinPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [last, setLast] = useState<CheckInResult | null>(null);
  const branches = useGymBranches();
  // null = belum dipilih: pakai cabang staf.
  const [chosenBranch, setChosenBranch] = useState<string | null>(null);
  const branchId = chosenBranch ?? defaultBranchId(branches.data);
  const branchOptions = branches.data?.branches ?? [];
  const log = useQuery({ queryKey: GYM_KEYS.checkin, queryFn: schedulingApi.checkinLog, refetchInterval: 10_000 });

  const scan = useMutation({
    mutationFn: (value: string) => schedulingApi.scan(value, branchId || null),
    onSuccess: (result) => {
      setLast(result);
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.checkin });
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    },
    onError: (error) => toast.error("QR gagal diperiksa", { description: error.message }),
    onSettled: () => {
      setToken("");
      document.getElementById(TOKEN_INPUT_ID)?.focus();
    },
  });
  const today = log.data?.today ?? { checked_in: 0, open_gym: 0, denied: 0, credits: 0 };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Check-in"
        description="Member masuk dengan booking kelas terkonfirmasi dalam jendela check-in cabang, atau lewat open gym bila cabang membukanya. Waiver wajib disetujui. Kredit dipotong saat scan diterima."
        actions={
          branchOptions.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Cabang</span>
              <select
                className={`${SELECT} w-48`}
                value={branchId}
                onChange={(e) => setChosenBranch(e.target.value)}
                aria-label="Cabang check-in"
              >
                <option value="">Semua cabang</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <Tabs defaultValue="qr" className="w-full flex-col">
            <TabsList>
              <TabsTrigger value="qr">Scan QR</TabsTrigger>
              <TabsTrigger value="member">Cari member</TabsTrigger>
              <TabsTrigger value="drop-in">Drop-in</TabsTrigger>
            </TabsList>
            <TabsContent value="qr" className="space-y-3 pt-2">
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (token.trim().length >= 8) scan.mutate(token.trim());
                }}
              >
                <Input
                  id={TOKEN_INPUT_ID}
                  autoFocus
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Pindai QR atau tempel token nhqr_…"
                  aria-label="Token QR member"
                  className="font-mono"
                />
                <Button type="submit" disabled={scan.isPending || token.trim().length < 8}>
                  <QrCode /> Periksa
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">QR member hanya berlaku sebentar dan sekali pakai.</p>
              <QrCamera onToken={(value) => value.length >= 8 && scan.mutate(value)} disabled={scan.isPending} />
            </TabsContent>
            <TabsContent value="member" className="pt-2">
              <DeskMemberSearch onResult={setLast} />
            </TabsContent>
            <TabsContent value="drop-in" className="pt-2">
              <DropInPanel branchId={branchId} onResult={setLast} />
            </TabsContent>
          </Tabs>
        </Card>
        <ScanResult result={last} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Check-in kelas hari ini" value={formatNumber(today.checked_in)} hint={`Open gym: ${formatNumber(today.open_gym)}`} icon={<QrCode />} tone="ink" />
        <StatCard label="Kredit terpotong hari ini" value={formatNumber(today.credits)} icon={<Coins />} />
        <StatCard
          label="Scan ditolak hari ini"
          value={formatNumber(today.denied)}
          hint="Tanpa booking, belum waiver, QR kedaluwarsa, saldo kurang"
          icon={<ShieldX />}
          tone={today.denied ? "warning" : "default"}
        />
      </div>

      <CheckinLog />
    </div>
  );
}

function ScanResult({ result }: { result: CheckInResult | null }) {
  if (!result) {
    return (
      <Card variant="soft">
        <p className="text-sm text-muted-foreground">Hasil scan terakhir tampil di sini.</p>
      </Card>
    );
  }
  const allowed = result.decision === "allowed";
  return (
    <Card variant={allowed ? "ink" : "default"} role="status">
      <p className={allowed ? "text-sm text-on-ink-muted" : "text-sm text-muted-foreground"}>
        {result.memberName ?? "Member"}
      </p>
      <p className={allowed ? "text-2xl font-bold text-on-ink" : "text-2xl font-bold text-danger"}>
        {allowed ? "Masuk" : "Ditolak"}
      </p>
      <p className={allowed ? "text-sm text-on-ink" : "text-sm text-foreground"}>{result.message}</p>
    </Card>
  );
}
