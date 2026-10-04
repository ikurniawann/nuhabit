"use client";

import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { POS_SHIFT_MANAGEMENT_ENABLED } from "@/lib/pos/feature-flags";

/** Overlay muat katalog dan pesan gagal muat (posisi fixed, di atas workspace). */
export function CatalogStatus({ loading, error }: { loading: boolean; error: string | null }) {
  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white p-6 shadow-xs">
            <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
            <span className="font-medium text-gray-900">Loading products...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-red-200/80 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <X className="h-5 w-5" />
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}
    </>
  );
}

/** Status offline dan shift di atas katalog. */
export function CashierNotices(props: {
  isOnline: boolean;
  pendingCount: number;
  loadingShift: boolean;
  hasShift: boolean;
  onOpenShift: () => void;
}) {
  return (
    <>
      {!props.isOnline && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-2 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span className="font-medium">Offline mode — transactions saved locally</span>
          </div>
          <span className="text-xs opacity-75">{props.pendingCount} pending</span>
        </div>
      )}

      {POS_SHIFT_MANAGEMENT_ENABLED && !props.loadingShift && !props.hasShift ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium">No active shift — open a shift to start transactions</span>
            <HelpHint helpId="pos.shift" role="default" />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={props.onOpenShift}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Open Shift
          </Button>
        </div>
      ) : null}

      {POS_SHIFT_MANAGEMENT_ENABLED && props.loadingShift && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50 px-4 py-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking shift status...
        </div>
      )}
    </>
  );
}
