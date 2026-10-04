"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Percent, Plus, Save, Utensils } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profileScopeLabel, type BillingCharge, type BillingProfile } from "@/lib/pos/billing-settings";
import { cn } from "@/lib/utils";
import {
  chargesForSave,
  defaultCharge,
  editingScopeLabel,
  editorStateFromProfile,
  ensureCoreCharges,
  nextFeeCharge,
} from "../billing-charges";
import { useSaveBillingProfile } from "../mutations";
import { AdvancedChargeRow } from "./advanced-charge-row";
import { CoreChargeCard } from "./core-charge-card";

/**
 * Editor profil billing untuk satu scope. Di-mount ulang (key) saat scope
 * atau profil yang berlaku berganti, jadi draf selalu mulai dari data server.
 */
export function BillingProfileEditor({
  branchId,
  warehouseId,
  profile,
  loading,
  scopeControls,
}: {
  branchId: string;
  warehouseId: string;
  /** Profil yang berlaku untuk scope (bisa warisan cabang/sistem). */
  profile: BillingProfile | null;
  loading: boolean;
  scopeControls: ReactNode;
}) {
  const [state, setState] = useState(() => editorStateFromProfile(profile, { branchId, warehouseId }));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const saveMutation = useSaveBillingProfile();
  const { charges } = state;

  const setCharges = (fn: (current: BillingCharge[]) => BillingCharge[]) =>
    setState((prev) => ({ ...prev, charges: fn(prev.charges) }));
  const patchCharge = (index: number, patch: Partial<BillingCharge>) =>
    setCharges((current) => current.map((charge, i) => (i === index ? { ...charge, ...patch } : charge)));
  const patchByKind = (kind: "tax" | "service", patch: Partial<BillingCharge>) =>
    setCharges((current) =>
      ensureCoreCharges(current).map((charge) => (charge.charge_kind === kind ? { ...charge, ...patch } : charge))
    );

  async function save() {
    const checked = chargesForSave(charges);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    // Profil warisan (cabang/sistem) tidak ditimpa: scope ini dapat profil baru.
    const editingExactScope =
      profile &&
      (profile.branch_id || null) === (branchId || null) &&
      (profile.warehouse_id || null) === (warehouseId || null);
    try {
      const saved = await saveMutation.mutateAsync({
        id: editingExactScope ? state.profileId : null,
        branch_id: branchId || null,
        warehouse_id: warehouseId || null,
        name: state.profileName.trim() || "Profil Billing",
        charges: checked.charges,
      });
      setState(editorStateFromProfile(saved, { branchId, warehouseId }));
      toast.success("Tax & Service berhasil disimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    }
  }

  const taxCharge = charges.find((c) => c.charge_kind === "tax") ?? defaultCharge("tax");
  const serviceCharge = charges.find((c) => c.charge_kind === "service") ?? defaultCharge("service");
  const advancedCharges = charges
    .map((charge, index) => ({ charge, index }))
    .filter(({ charge }) => charge.charge_kind !== "tax" && charge.charge_kind !== "service");

  return (
    <>
      <div className="rounded-2xl border border-gray-200/70 bg-card p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {scopeControls}
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Nama profil</span>
            <Input
              value={state.profileName}
              onChange={(e) => setState((prev) => ({ ...prev, profileName: e.target.value }))}
              className="h-10 border-gray-200/80"
            />
          </label>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Scope yang diedit:{" "}
          <span className="font-medium text-foreground">{editingScopeLabel(branchId, warehouseId)}</span>
          {profile ? (
            <>
              {" "}
              · dimuat dari <span className="font-medium text-foreground">{profileScopeLabel(profile.scope)}</span>
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <CoreChargeCard
              title="Tax"
              description="Pajak atas subtotal setelah diskon"
              icon={Percent}
              charge={taxCharge}
              onChange={(patch) => patchByKind("tax", patch)}
            />
            <CoreChargeCard
              title="Service Charge"
              description="Biaya layanan atas subtotal setelah diskon"
              icon={Utensils}
              charge={serviceCharge}
              onChange={(patch) => patchByKind("service", patch)}
            />
          </div>

          <div className="rounded-2xl border border-gray-200/70 bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
            >
              <div>
                <div className="text-sm font-semibold text-foreground">Pengaturan lanjutan</div>
                <div className="text-xs text-muted-foreground">
                  Fee unik, rounding, dan baris biaya tambahan
                  {advancedCharges.length > 0 ? ` · ${advancedCharges.length} baris` : ""}
                </div>
              </div>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
              />
            </button>

            {advancedOpen ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Biaya dengan uniqcode ditagihkan ke customer di setiap transaksi.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCharges((current) => [...current, nextFeeCharge(current)])}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Tambah kode biaya
                  </Button>
                </div>

                <div className="divide-y divide-gray-200/60 border-t border-gray-200/70">
                  {advancedCharges.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Belum ada fee/rounding. Tambah bila perlu.
                    </div>
                  ) : (
                    advancedCharges.map(({ charge, index }) => (
                      <AdvancedChargeRow
                        key={`${charge.code}-${index}`}
                        charge={charge}
                        onChange={(patch) => patchCharge(index, patch)}
                        onRemove={() => setCharges((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saveMutation.isPending || loading}
          className="bg-primary hover:bg-primary/90"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menyimpan…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Simpan Tax & Service
            </>
          )}
        </Button>
      </div>
    </>
  );
}
