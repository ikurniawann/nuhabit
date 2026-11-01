"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { lookupSeasonPass } from "../api";
import type { SeasonPassDiscount } from "../cashier-session";

/**
 * Scan pass musiman (QR, kode pass, atau UID gelang) di kasir. Pass aktif
 * dalam masa berlaku memberi diskon member untuk transaksi ini.
 */
export function SeasonPassDialog(props: {
  open: boolean;
  active: SeasonPassDiscount | null;
  onApply: (pass: SeasonPassDiscount) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const lookup = useMutation({ mutationFn: lookupSeasonPass });
  const result = lookup.data;

  const close = () => {
    setCode("");
    lookup.reset();
    props.onClose();
  };
  const check = () => {
    const trimmed = code.trim();
    if (trimmed && !lookup.isPending) lookup.mutate(trimmed);
  };

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && close()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Pass musiman</DialogPanelTitle>
          <DialogPanelDescription>Scan QR pass atau gelang, atau ketik kode pass.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {props.active ? (
            <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
              <Ticket className="h-4 w-4 shrink-0 text-violet-700" />
              <span className="min-w-0 flex-1 text-violet-900">
                Pass aktif: {props.active.holderName} ({props.active.discountPercent}%)
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  props.onClear();
                  close();
                }}
              >
                Lepas pass
              </Button>
            </div>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              check();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="pos-season-pass-code">Kode pass</Label>
              <Input
                id="pos-season-pass-code"
                autoFocus
                autoComplete="off"
                maxLength={120}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  lookup.reset();
                }}
              />
            </div>
            <Button type="submit" variant="outline" disabled={!code.trim() || lookup.isPending}>
              {lookup.isPending ? <Loader2 className="animate-spin" /> : null}
              Cek pass
            </Button>
          </form>
          {lookup.error ? <p className="text-sm text-red-600">{lookup.error.message}</p> : null}
          {result && !result.found ? <p className="text-sm text-red-600">{result.reason}</p> : null}
          {result?.found ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <dt className="text-muted-foreground">Pemegang</dt>
              <dd className="font-medium">{result.holder_name}</dd>
              <dt className="text-muted-foreground">Pass</dt>
              <dd>{result.product_name}</dd>
              <dt className="text-muted-foreground">Diskon</dt>
              <dd className="font-semibold">{result.discount_percent}%</dd>
              <dt className="text-muted-foreground">Berlaku s/d</dt>
              <dd>{formatDate(result.valid_until, "Tanpa batas")}</dd>
            </dl>
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Tutup
          </Button>
          <Button
            disabled={!result?.found || result.discount_percent <= 0}
            onClick={() => {
              if (!result?.found) return;
              props.onApply({ holderName: result.holder_name, discountPercent: result.discount_percent });
              close();
            }}
          >
            {result?.found ? `Pakai diskon ${result.discount_percent}%` : "Pakai diskon"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
