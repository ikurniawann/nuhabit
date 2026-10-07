"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
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
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatNumber } from "@/lib/format";
import { useCreateCashMovement } from "../mutations";
import { useCashMovements, usePostableAccountOptions } from "../queries";
import type { CashMovementKind } from "../types";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";

const NO_ACCOUNTS: never[] = [];

type Props = {
  kind: CashMovementKind;
};

export function CashMovementPage({ kind }: Props) {
  const isIn = kind === "cash_in";
  const title = isIn ? "Cash In" : "Cash Out";
  const subtitle = isIn
    ? "Pencatatan penerimaan kas/bank (Debit kas, Credit akun lawan)"
    : "Pencatatan pengeluaran kas/bank (Debit akun lawan, Credit kas)";
  const Icon = isIn ? ArrowDownTrayIcon : ArrowUpTrayIcon;

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    search,
  } = useDebouncedSearch();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading } = useCashMovements(kind, {
    search: search || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: 50,
  });
  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          type="button"
          onClick={() => setFormOpen(true)}
          className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isIn ? "Catat Cash In" : "Catat Cash Out"}
        </Button>
      </div>

      <PurchasingListSection
        icon={Icon}
        title={`Riwayat ${title}`}
        description="Jurnal MANUAL langsung POSTED ke Cash & Bank ledger."
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari no jurnal / deskripsi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 w-full bg-card sm:w-40 focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Dari tanggal"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 w-full bg-card sm:w-40 focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Sampai tanggal"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada transaksi {title}.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="px-2 py-3 font-medium">No Jurnal</th>
                  <th className="px-2 py-3 font-medium">Tanggal</th>
                  <th className="px-2 py-3 font-medium">Kas/Bank</th>
                  <th className="px-2 py-3 font-medium">Akun Lawan</th>
                  <th className="px-2 py-3 font-medium">Keterangan</th>
                  <th className="px-2 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 hover:bg-muted/40"
                  >
                    <td className="px-2 py-3 font-medium">{row.entry_no}</td>
                    <td className="px-2 py-3">{row.entry_date}</td>
                    <td className="px-2 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.cash_account_code}
                      </span>{" "}
                      {row.cash_account_name}
                    </td>
                    <td className="px-2 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.offset_account_code}
                      </span>{" "}
                      {row.offset_account_name}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {row.description || "—"}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {formatNumber(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <CashMovementDialog
        kind={kind}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </div>
  );
}

function CashMovementDialog({
  open,
  onOpenChange,
  ...formProps
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: CashMovementKind;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        {/* Form dipasang ulang tiap dialog dibuka supaya isiannya mulai bersih. */}
        {open ? (
          <CashMovementForm
            onClose={() => onOpenChange(false)}
            {...formProps}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function CashMovementForm({
  kind,
  onClose,
}: {
  kind: CashMovementKind;
  onClose: () => void;
}) {
  const isIn = kind === "cash_in";
  const mutation = useCreateCashMovement(kind);
  const optionsQuery = usePostableAccountOptions();
  const accounts = optionsQuery.data ?? NO_ACCOUNTS;

  const cashOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.is_cash_bank)
        .map((a) => ({
          value: a.id,
          label: `${a.code_display || a.code} — ${a.name}`,
        })),
    [accounts],
  );

  const [entryDate, setEntryDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState<number | undefined>();
  const [pickedCashId, setCashAccountId] = useState("");
  // Default ke akun kas/bank pertama sampai user memilih.
  const cashAccountId = pickedCashId || cashOptions[0]?.value || "";
  const [offsetAccountId, setOffsetAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");

  const offsetOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.id !== cashAccountId)
        .map((a) => ({
          value: a.id,
          label: `${a.code_display || a.code} — ${a.name}${
            a.is_cash_bank ? " (Kas/Bank)" : ""
          }`,
        })),
    [accounts, cashAccountId],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !cashAccountId ||
      !offsetAccountId ||
      !amount ||
      amount <= 0 ||
      mutation.isPending
    ) {
      return;
    }
    try {
      const res = await mutation.mutateAsync({
        entry_date: entryDate,
        amount,
        cash_account_id: cashAccountId,
        offset_account_id: offsetAccountId,
        description: description || null,
        memo: memo || null,
      });
      toast.success(
        res.message ||
          (isIn ? "Cash In berhasil dicatat" : "Cash Out berhasil dicatat"),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isIn
            ? "Gagal mencatat Cash In"
            : "Gagal mencatat Cash Out",
      );
    }
  }

  return (
    <DialogPanelForm onSubmit={onSubmit}>
      <DialogPanelHeader>
        <DialogPanelTitle>
          {isIn ? "Catat Cash In" : "Catat Cash Out"}
        </DialogPanelTitle>
        <DialogPanelDescription>
          {isIn
            ? "Debit akun kas/bank, Credit akun lawan. Jurnal langsung POSTED."
            : "Debit akun lawan, Credit akun kas/bank. Jurnal langsung POSTED."}
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-4">
        <div className="space-y-2">
          <Label>Tanggal</Label>
          <Input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
            className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label>Akun Kas/Bank</Label>
          <Combobox
            options={cashOptions}
            value={cashAccountId}
            onChange={(v) => {
              setCashAccountId(v);
              if (v === offsetAccountId) setOffsetAccountId("");
            }}
            placeholder="Pilih akun kas/bank"
            searchPlaceholder="Cari akun..."
            className="h-10 w-full bg-card"
          />
        </div>
        <div className="space-y-2">
          <Label>Akun Lawan</Label>
          <Combobox
            options={offsetOptions}
            value={offsetAccountId}
            onChange={setOffsetAccountId}
            placeholder="Pilih akun lawan"
            searchPlaceholder="Cari akun..."
            className="h-10 w-full bg-card"
          />
        </div>
        <div className="space-y-2">
          <Label>Amount</Label>
          <NumericInput
            value={amount}
            onValueChange={setAmount}
            className="h-10 bg-card"
          />
        </div>
        <div className="space-y-2">
          <Label>Keterangan</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Opsional"
            className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div className="space-y-2">
          <Label>Memo baris</Label>
          <Input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Opsional"
            className="h-10 bg-card focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </DialogPanelBody>
      <DialogFooter className="gap-3 px-6 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Batal
        </Button>
        <Button
          type="submit"
          disabled={
            mutation.isPending || !cashAccountId || !offsetAccountId || !amount
          }
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menyimpan...
            </>
          ) : (
            "Simpan & Posting"
          )}
        </Button>
      </DialogFooter>
    </DialogPanelForm>
  );
}
