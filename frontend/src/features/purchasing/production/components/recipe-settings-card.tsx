"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import {
  buildRecipeSettingsPayload,
  initRecipeSettingsForm,
  recipeSettingsErrors,
  type RecipeOwner,
  type RecipeSettings,
} from "@/lib/purchasing/production-recipe-settings";
import { useSaveRecipeSettings } from "../mutations";
import { useRecipeSettings } from "../queries";

/** Pengaturan resep di editor BOM: toleransi scrap normal per order dan ukuran batch untuk sub-order. */
export function RecipeSettingsCard({ owner }: { owner: RecipeOwner }) {
  const settingsQuery = useRecipeSettings(owner);
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base">Pengaturan Resep</CardTitle>
        <p className="mt-1 text-xs text-gray-500">
          Scrap sampai batas toleransi menaikkan HPP hasil baik. Scrap di atasnya dibebankan sebagai kerugian produksi.
          Ukuran batch membulatkan qty sub-order ke atas.
        </p>
      </CardHeader>
      <CardContent className="p-4">
        {settingsQuery.isLoading ? (
          <p className="flex items-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Memuat pengaturan resep...
          </p>
        ) : (
          // key: isian dibangun ulang setiap data server berubah.
          <RecipeSettingsForm key={settingsQuery.dataUpdatedAt} owner={owner} settings={settingsQuery.data} />
        )}
      </CardContent>
    </Card>
  );
}

function RecipeSettingsForm({ owner, settings }: { owner: RecipeOwner; settings: RecipeSettings | undefined }) {
  const [form, setForm] = useState(() => initRecipeSettingsForm(settings));
  const save = useSaveRecipeSettings();
  const errors = recipeSettingsErrors(form);
  const fallback = settings?.default_scrap_tolerance_pct ?? 5;

  const submit = async () => {
    try {
      toast.success((await save.mutateAsync(buildRecipeSettingsPayload(owner, form))) || "Pengaturan resep disimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengaturan resep");
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="space-y-1.5 sm:w-64">
        <Label htmlFor="recipe-scrap-tolerance" className="text-xs text-gray-500">
          Toleransi scrap (% dari qty rencana)
        </Label>
        <Input
          id="recipe-scrap-tolerance"
          value={form.tolerance}
          onChange={(event) => setForm({ ...form, tolerance: event.target.value })}
          type="number"
          min="0"
          max="100"
          step="any"
          placeholder={`${formatNumber(fallback, 2)} (default)`}
          aria-invalid={errors.tolerance ? true : undefined}
          aria-describedby="recipe-scrap-tolerance-help"
          className="h-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
        />
        <p id="recipe-scrap-tolerance-help" className={`text-xs ${errors.tolerance ? "text-red-600" : "text-gray-500"}`}>
          {errors.tolerance || `Kosongkan untuk memakai default ${formatNumber(fallback, 2)}%.`}
        </p>
      </div>
      <div className="space-y-1.5 sm:w-64">
        <Label htmlFor="recipe-batch-size" className="text-xs text-gray-500">
          Ukuran batch (satuan hasil)
        </Label>
        <Input
          id="recipe-batch-size"
          value={form.batchSize}
          onChange={(event) => setForm({ ...form, batchSize: event.target.value })}
          type="number"
          min="0"
          step="any"
          placeholder="Tanpa pembulatan"
          aria-invalid={errors.batchSize ? true : undefined}
          aria-describedby="recipe-batch-size-help"
          className="h-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
        />
        <p id="recipe-batch-size-help" className={`text-xs ${errors.batchSize ? "text-red-600" : "text-gray-500"}`}>
          {errors.batchSize || "Kosongkan bila sub-order tidak perlu dibulatkan."}
        </p>
      </div>
      <Button
        type="button"
        onClick={submit}
        disabled={save.isPending || !!errors.tolerance || !!errors.batchSize}
        className="purchasing-main-button w-full gap-2 sm:mb-6 sm:w-auto"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Simpan Pengaturan
      </Button>
    </div>
  );
}
