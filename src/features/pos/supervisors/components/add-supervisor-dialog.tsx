'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import type { CandidateRow } from '../api';
import { useSupervisorCandidates } from '../queries';

export function AddSupervisorDialog({
  open,
  onClose,
  onPromote,
}: {
  open: boolean;
  onClose: () => void;
  onPromote: (candidate: CandidateRow) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  // Debounce 250 ms sebelum mencari ke server.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const candidatesQuery = useSupervisorCandidates(debounced, open);
  const candidates = candidatesQuery.data ?? [];
  const loading = candidatesQuery.isFetching;
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Tambah Supervisor POS</DialogPanelTitle>
          <DialogPanelDescription>
            Role user terpilih akan berubah menjadi supervisor POS. Akun admin tidak
            bisa dipilih.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau email…"
              className="border-gray-200/80 pl-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200/70">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Mencari…
              </div>
            ) : candidates.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Tidak ada user yang cocok.
              </div>
            ) : (
              <ul className="divide-y divide-gray-200/70">
                {candidates.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {row.full_name || 'Tanpa nama'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.email} · {row.role}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-primary/30 text-brand-text hover:bg-primary/5"
                      disabled={busyId !== null}
                      onClick={async () => {
                        setBusyId(row.id);
                        try {
                          await onPromote(row);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Gagal menambah supervisor');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Jadikan'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-border" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
