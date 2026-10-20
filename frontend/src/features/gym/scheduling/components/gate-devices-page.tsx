"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { defaultBranchId, useGymBranches } from "@/features/gym/branches";
import { SELECT } from "@/features/gym/shared";
import { GYM_KEYS, schedulingApi, waktu, type GateDevice, type IssuedDeviceKey } from "../api";

/** Perangkat dianggap online bila heartbeat atau scan terakhir dalam 10 menit. */
const ONLINE_MS = 10 * 60 * 1000;

type Confirming = { device: GateDevice; action: "rotate" | "revoke" };

/**
 * Gym → Perangkat Gate: turnstile dan pembaca pintu per cabang. Perangkat
 * memakai kuncinya sendiri (bukan akun staf); kunci hanya tampil sekali saat
 * dibuat atau diganti. Protokol: backend/docs/GATE_DEVICES.md.
 */
export function GateDevicesPage() {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: GYM_KEYS.gateDevices, queryFn: schedulingApi.gateDevices, refetchInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [issued, setIssued] = useState<{ name: string; key: IssuedDeviceKey } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.gateDevices });

  const change = useMutation({
    mutationFn: async ({ device, action }: Confirming): Promise<IssuedDeviceKey | null> => {
      if (action === "rotate") return schedulingApi.rotateGateDevice(device.id);
      await schedulingApi.revokeGateDevice(device.id);
      return null;
    },
    onSuccess: (key, { device }) => {
      setConfirming(null);
      if (key) setIssued({ name: device.name, key });
      else toast.success("Perangkat dinonaktifkan", { description: device.name });
      refresh();
    },
    onError: (error) => toast.error("Perangkat gagal diubah", { description: error.message }),
  });
  const rows = devices.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Perangkat Gate"
        description="Turnstile dan pembaca pintu per cabang. Perangkat memindai QR member dengan kuncinya sendiri dan mengikuti aturan cabangnya. Kunci hanya tampil sekali."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Tambah perangkat
          </Button>
        }
      />

      <Card className="py-0">
        {devices.isLoading ? (
          <TableNote>Memuat perangkat…</TableNote>
        ) : devices.error ? (
          <TableNote tone="danger">{devices.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada perangkat gate.</TableNote>
        ) : (
          <Table aria-label="Perangkat gate">
            <TableHeader>
              <TableRow>
                <TableHead>Perangkat</TableHead>
                <TableHead className="hidden sm:table-cell">Kunci</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.branch_name ?? "Cabang tidak ditemukan"} · relay {d.relay_open_ms} ms
                    </p>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">{d.key_prefix}…</TableCell>
                  <TableCell className="whitespace-normal">
                    <DeviceStatus device={d} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={change.isPending} onClick={() => setConfirming({ device: d, action: "rotate" })}>
                        <KeyRound /> {d.active ? "Ganti kunci" : "Aktifkan dengan kunci baru"}
                      </Button>
                      {d.active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          disabled={change.isPending}
                          onClick={() => setConfirming({ device: d, action: "revoke" })}
                        >
                          Nonaktifkan
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {creating && (
        <CreateDeviceDialog
          onClose={() => setCreating(false)}
          onCreated={(name, key) => {
            setCreating(false);
            setIssued({ name, key });
            refresh();
          }}
        />
      )}
      <IssuedKeyDialog issued={issued} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.action === "revoke" ? `Nonaktifkan ${confirming.device.name}?` : `Ganti kunci ${confirming?.device.name ?? ""}?`}
        description={
          confirming?.action === "revoke"
            ? "Perangkat langsung ditolak di scan berikutnya. Aktifkan lagi dengan membuat kunci baru."
            : "Kunci lama langsung tidak berlaku. Pasang kunci baru di perangkat setelah ini."
        }
        confirmLabel={confirming?.action === "revoke" ? "Nonaktifkan" : "Buat kunci baru"}
        variant={confirming?.action === "revoke" ? "danger" : "default"}
        loading={change.isPending}
        onConfirm={() => confirming && change.mutate(confirming)}
      />
    </div>
  );
}

function DeviceStatus({ device }: { device: GateDevice }) {
  // Dibaca sekali per render tabel; tabel dimuat ulang tiap menit.
  const [now] = useState(() => Date.now());
  if (!device.active) return <Badge variant="muted">Nonaktif</Badge>;
  const online = device.last_seen_at !== null && now - Date.parse(device.last_seen_at) < ONLINE_MS;
  return (
    <>
      <Badge variant={online ? "success" : "warning"}>{online ? "Online" : "Tidak terhubung"}</Badge>
      <span className="block text-xs text-muted-foreground">
        {device.last_seen_at ? `Terakhir aktif ${waktu(device.last_seen_at)}` : "Belum pernah terhubung"}
      </span>
    </>
  );
}

function CreateDeviceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, key: IssuedDeviceKey) => void }) {
  const branches = useGymBranches();
  const [chosenBranch, setChosenBranch] = useState<string | null>(null);
  const branchId = chosenBranch ?? defaultBranchId(branches.data);
  const [name, setName] = useState("");
  const [relay, setRelay] = useState("3000");
  const create = useMutation({
    mutationFn: () => schedulingApi.createGateDevice({ branch_id: branchId, name: name.trim(), relay_open_ms: Number(relay) }),
    onSuccess: (key) => onCreated(name.trim(), key),
    onError: (error) => toast.error("Perangkat gagal ditambahkan", { description: error.message }),
  });
  const relayMs = Number(relay);
  const valid = branchId !== "" && name.trim().length >= 2 && relayMs >= 500 && relayMs <= 30000;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah perangkat gate</DialogPanelTitle>
            <DialogPanelDescription>Perangkat memakai aturan check-in dan open gym cabangnya.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <Field label="Cabang">
              <select className={SELECT} value={branchId} onChange={(e) => setChosenBranch(e.target.value)} required>
                <option value="" disabled>
                  Pilih cabang
                </option>
                {(branches.data?.branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nama perangkat">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Turnstile pintu utama" maxLength={80} required />
            </Field>
            <Field label="Lama relay terbuka (ms)" hint="500 sampai 30000. Bawaan 3000 (3 detik).">
              <Input type="number" min={500} max={30000} step={100} value={relay} onChange={(e) => setRelay(e.target.value)} required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Buat perangkat
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

/** Kunci perangkat tampil sekali: setelah dialog ditutup, kunci tidak bisa dilihat lagi. */
function IssuedKeyDialog({ issued, onClose }: { issued: { name: string; key: IssuedDeviceKey } | null; onClose: () => void }) {
  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key.key);
      toast.success("Kunci disalin");
    } catch {
      toast.error("Gagal menyalin, salin manual dari kotak");
    }
  };
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Kunci {issued?.name}</DialogPanelTitle>
          <DialogPanelDescription>
            Simpan sekarang. Kunci ini tidak bisa dilihat lagi setelah dialog ditutup; bila hilang, buat kunci baru.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <p className="rounded-2xl bg-surface-2 px-4 py-3 font-mono text-sm break-all select-all">{issued?.key.key}</p>
          <p className="text-xs text-muted-foreground">
            Pasang di perangkat sebagai header <span className="font-mono">X-Gate-Device-Key</span> untuk{" "}
            <span className="font-mono">POST /api/gym/gate/devices/scan</span> dan{" "}
            <span className="font-mono">/heartbeat</span>.
          </p>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <Copy /> Salin kunci
          </Button>
          <Button type="button" onClick={onClose}>
            Sudah disimpan
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
