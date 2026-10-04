"use client";

import { useMemo, useState } from "react";
import { CreditCard, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { TableRow } from "@/components/ui/table";
import type { ManualPaymentHandler, PosPaymentMethod } from "@/lib/pos/payment-methods";
import {
  PROTECTED_PAYMENT_METHOD_CODES,
  canRenamePaymentMethodCode,
  slugifyPaymentMethodCode,
} from "@/lib/pos/payment-methods";
import {
  useCreatePaymentMethod,
  useDeletePaymentMethod,
  usePaymentMethods,
  useUpdatePaymentMethod,
} from "../queries";

const NO_METHODS: PosPaymentMethod[] = [];

export function PaymentMethodsPage() {
  const listQuery = usePaymentMethods(false);
  const updateMutation = useUpdatePaymentMethod();
  const createMutation = useCreatePaymentMethod();
  const deleteMutation = useDeletePaymentMethod();
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    code: "",
    description: "",
    handler: "cash" as ManualPaymentHandler,
  });
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; description: string; sort_order: string; code: string }>
  >({});

  const methods = listQuery.data ?? NO_METHODS;

  const rows = useMemo(() => {
    return methods.map((method) => {
      const draft = drafts[method.code];
      return {
        ...method,
        name: draft?.name ?? method.name,
        description: draft?.description ?? method.description,
        code_text: draft?.code ?? method.code,
        sort_order_text:
          draft?.sort_order ?? String(method.sort_order),
      };
    });
  }, [methods, drafts]);

  function setDraft(
    code: string,
    patch: Partial<{ name: string; description: string; sort_order: string; code: string }>
  ) {
    setDrafts((current) => {
      const base = current[code] ?? {
        name: methods.find((m) => m.code === code)?.name ?? "",
        description: methods.find((m) => m.code === code)?.description ?? "",
        sort_order: String(methods.find((m) => m.code === code)?.sort_order ?? 0),
        code,
      };
      return { ...current, [code]: { ...base, ...patch } };
    });
  }

  function isDirty(method: PosPaymentMethod) {
    const draft = drafts[method.code];
    if (!draft) return false;
    return (
      draft.name !== method.name ||
      draft.description !== method.description ||
      draft.code !== method.code ||
      Number(draft.sort_order) !== method.sort_order
    );
  }

  function resetAddForm() {
    setAddForm({ name: "", code: "", description: "", handler: "cash" });
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Metode Bayar"
        description="Aktifkan, urutkan, atau tambah metode manual (Tunai/Kartu). QRIS tetap Xendit — tidak ditambah dari sini."
        actions={
          <Button
            type="button"
            className="gap-2"
            onClick={() => {
              resetAddForm();
              setAddOpen(true);
            }}
          >
            <Plus className="size-4" />
            Tambah metode
          </Button>
        }
      />

      <PurchasingListSection
        icon={CreditCard}
        title="Master metode pembayaran"
        description="Metode baru memakai alur Tunai atau Kartu. QRIS/Xendit, ARK, NFC, dan Gift Card tidak dibuat ulang di sini."
      >
        {listQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat metode…</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Belum ada data metode bayar.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground hover:bg-muted/40">
                  <th className="px-4 py-3 text-left font-semibold">Aktif</th>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Deskripsi</th>
                  <th className="px-4 py-3 text-left font-semibold">Handler</th>
                  <th className="px-4 py-3 text-right font-semibold">Urutan</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {rows.map((row) => {
                  const original = methods.find((m) => m.code === row.code)!;
                  const dirty = isDirty(original);
                  const busy =
                    updateMutation.isPending &&
                    updateMutation.variables?.code === row.code;
                  return (
                    <TableRow key={row.code} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Switch
                          checked={original.is_active}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({
                              code: row.code,
                              is_active: checked,
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        {canRenamePaymentMethodCode(original.code) ? (
                          <Input
                            value={row.code_text}
                            disabled={busy}
                            onChange={(e) =>
                              setDraft(original.code, {
                                code: slugifyPaymentMethodCode(e.target.value),
                              })
                            }
                            className="h-9 border-gray-200/80 font-mono text-xs"
                          />
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.code}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          value={row.name}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, { name: e.target.value })
                          }
                          className="h-9 border-gray-200/80"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          value={row.description}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, { description: e.target.value })
                          }
                          className="h-9 border-gray-200/80"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {row.handler}
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min={0}
                          value={row.sort_order_text}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, {
                              sort_order: e.target.value.replace(/\D/g, ""),
                            })
                          }
                          className="ml-auto h-9 w-20 border-gray-200/80 text-right"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {!PROTECTED_PAYMENT_METHOD_CODES.has(row.code) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-red-200/80 text-red-700 hover:bg-red-50"
                              title="Hapus metode kustom"
                              disabled={busy || deleteMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Hapus metode "${row.name}"?`)) {
                                  deleteMutation.mutate(row.code);
                                }
                              }}
                            >
                              {deleteMutation.isPending &&
                              deleteMutation.variables === row.code ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={
                              !dirty ||
                              busy ||
                              row.name.trim().length < 2 ||
                              (canRenamePaymentMethodCode(original.code) &&
                                row.code_text.trim().length < 2)
                            }
                            onClick={() =>
                              updateMutation.mutate(
                                {
                                  code: original.code,
                                  name: row.name.trim(),
                                  description: row.description.trim(),
                                  sort_order: Number(row.sort_order_text) || 0,
                                  ...(canRenamePaymentMethodCode(original.code) &&
                                  row.code_text !== original.code
                                    ? { new_code: row.code_text }
                                    : {}),
                                },
                                {
                                  onSuccess: () =>
                                    setDrafts((current) => {
                                      const next = { ...current };
                                      delete next[row.code];
                                      return next;
                                    }),
                                }
                              )
                            }
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Simpan"
                            )}
                          </Button>
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (createMutation.isPending) return;
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
      >
        <DialogPanel size="sm">
          <DialogPanelForm
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate(
                {
                  name: addForm.name.trim(),
                  code: slugifyPaymentMethodCode(addForm.code || addForm.name),
                  description: addForm.description.trim(),
                  handler: addForm.handler,
                },
                {
                  onSuccess: () => {
                    setAddOpen(false);
                    resetAddForm();
                  },
                }
              );
            }}
          >
            <DialogPanelHeader>
              <DialogPanelTitle>Tambah metode bayar</DialogPanelTitle>
              <DialogPanelDescription>
                Metode manual tanpa Xendit. Pilih alur Tunai atau Kartu.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pm-name">Nama</Label>
                <Input
                  id="pm-name"
                  value={addForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setAddForm((current) => ({
                      ...current,
                      name,
                      code: current.code || slugifyPaymentMethodCode(name),
                    }));
                  }}
                  placeholder="Transfer BCA"
                  className="border-border"
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-code">Kode</Label>
                <Input
                  id="pm-code"
                  value={addForm.code}
                  onChange={(e) =>
                    setAddForm((current) => ({
                      ...current,
                      code: slugifyPaymentMethodCode(e.target.value),
                    }))
                  }
                  placeholder="transfer_bca"
                  className="border-border font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-desc">Deskripsi</Label>
                <Input
                  id="pm-desc"
                  value={addForm.description}
                  onChange={(e) =>
                    setAddForm((current) => ({
                      ...current,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Transfer rekening toko"
                  className="border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-handler">Alur kasir</Label>
                <select
                  id="pm-handler"
                  value={addForm.handler}
                  onChange={(e) =>
                    setAddForm((current) => ({
                      ...current,
                      handler: e.target.value as ManualPaymentHandler,
                    }))
                  }
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                >
                  <option value="cash">Tunai — input nominal & kembalian</option>
                  <option value="credit">Kartu — EDC / debit / credit</option>
                </select>
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="border-border"
                disabled={createMutation.isPending}
                onClick={() => setAddOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending || addForm.name.trim().length < 2
                }
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Simpan"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
