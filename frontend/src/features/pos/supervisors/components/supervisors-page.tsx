'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { fetchSupervisors, postSupervisorAction, type SupervisorAction, type SupervisorRow } from '../api';
import { supervisorsQueryKeys, useSupervisors } from '../queries';
import { AddSupervisorDialog } from './add-supervisor-dialog';
import { SetPinDialog } from './set-pin-dialog';

/**
 * Kelola supervisor POS + PIN void/merge (permintaan owner 2026-08-16).
 * Sebelumnya PIN hanya bisa diisi manual ke database — halaman ini pintunya:
 * tunjuk supervisor, set/reset PIN (tersimpan ter-hash), cabut akses.
 */

export function SupervisorsPage() {
  const queryClient = useQueryClient();
  const list = useSupervisors();
  const supervisors = list.data ?? [];
  const [pinTarget, setPinTarget] = useState<SupervisorRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [demoteTarget, setDemoteTarget] = useState<SupervisorRow | null>(null);

  async function post(body: SupervisorAction, successMessage?: string) {
    const message = await postSupervisorAction(body);
    toast.success(successMessage ?? message ?? 'Tersimpan');
    await queryClient.invalidateQueries({ queryKey: supervisorsQueryKeys.all });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <ShieldCheck className="h-5 w-5 text-brand-text" />
            Supervisor POS
          </h1>
          <p className="text-sm text-muted-foreground">
            PIN supervisor dipakai untuk otorisasi void &amp; gabung order di kasir.
          </p>
        </div>
        <Button type="button" onClick={() => setShowAdd(true)} className="bg-primary hover:bg-primary/90">
          <UserPlus className="mr-2 h-4 w-4" />
          Tambah Supervisor
        </Button>
      </div>

      {list.error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {list.error instanceof Error ? list.error.message : 'Gagal memuat supervisor'}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200/70 bg-card">
        {list.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat…
          </div>
        ) : supervisors.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada supervisor POS. Tambahkan dulu, lalu set PIN-nya — tanpa ini
            tombol void di halaman Orders tidak bisa dipakai.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200/70">
            {supervisors.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-brand-text">
                  {(row.full_name || row.email || '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {row.full_name || 'Tanpa nama'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                    row.has_pin
                      ? row.legacy_pin
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
                      : 'bg-red-50 text-red-700 ring-1 ring-red-200/80'
                  )}
                >
                  {row.has_pin ? (row.legacy_pin ? 'PIN lama — reset dianjurkan' : 'PIN aktif') : 'Belum ada PIN'}
                </span>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border"
                    onClick={() => setPinTarget(row)}
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    {row.has_pin ? 'Reset PIN' : 'Set PIN'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-200/80 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setDemoteTarget(row)}
                  >
                    <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                    Cabut
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        PIN tersimpan ter-enkripsi (hash) dan tidak bisa dilihat kembali — kalau lupa,
        reset saja. Mencabut supervisor mengembalikan role user menjadi kasir POS dan
        menghapus PIN-nya.
      </p>

      <SetPinDialog
        target={pinTarget}
        onClose={() => setPinTarget(null)}
        onSubmit={async (pin) => {
          if (!pinTarget) return;
          await post({ action: 'set_pin', user_id: pinTarget.id, pin }, 'PIN tersimpan');
          setPinTarget(null);
        }}
      />

      <AddSupervisorDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onPromote={async (candidate) => {
          await post({ action: 'promote', user_id: candidate.id });
          setShowAdd(false);
          // Langsung tawarkan set PIN untuk supervisor baru
          const fresh = await fetchSupervisors().catch(() => []);
          const created = fresh.find((row) => row.id === candidate.id);
          if (created) setPinTarget(created);
        }}
      />

      <Dialog open={Boolean(demoteTarget)} onOpenChange={(open) => !open && setDemoteTarget(null)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Cabut akses supervisor?</DialogPanelTitle>
            <DialogPanelDescription>
              {demoteTarget?.full_name || demoteTarget?.email} akan kembali menjadi kasir
              POS dan PIN-nya dihapus.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-border" onClick={() => setDemoteTarget(null)}>
              Batal
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async () => {
                if (!demoteTarget) return;
                try {
                  await post({ action: 'demote', user_id: demoteTarget.id });
                  setDemoteTarget(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Gagal mencabut');
                }
              }}
            >
              Cabut
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
