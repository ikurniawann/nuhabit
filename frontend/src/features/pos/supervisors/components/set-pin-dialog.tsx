'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
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
import { POS_PIN_PATTERN } from '@/lib/pos/supervisor-pin';
import type { SupervisorRow } from '../api';

type SetPinDialogProps = {
  target: SupervisorRow | null;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
};

/** Dirender ulang per supervisor (key) → isian PIN selalu kosong saat dibuka. */
export function SetPinDialog(props: SetPinDialogProps) {
  return props.target ? <SetPinForm key={props.target.id} {...props} /> : null;
}

function SetPinForm({ target, onClose, onSubmit }: SetPinDialogProps) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = POS_PIN_PATTERN.test(pin);
  const match = pin === confirm;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {target?.has_pin ? 'Reset PIN' : 'Set PIN'} — {target?.full_name || target?.email}
          </DialogPanelTitle>
          <DialogPanelDescription>
            PIN 4-6 digit angka, dipakai supervisor saat otorisasi void di kasir.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">PIN baru</label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="border-gray-200/80 text-center text-lg tracking-[0.5em]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Ulangi PIN</label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="border-gray-200/80 text-center text-lg tracking-[0.5em]"
            />
          </div>
          {pin && !valid ? (
            <p className="text-xs font-medium text-red-600">PIN harus 4-6 digit angka.</p>
          ) : confirm && !match ? (
            <p className="text-xs font-medium text-red-600">PIN tidak sama.</p>
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-border" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/90"
            disabled={!valid || !match || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(pin);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Gagal menyimpan PIN');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Simpan PIN
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
