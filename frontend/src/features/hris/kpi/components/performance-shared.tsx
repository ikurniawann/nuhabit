import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MONTH_SHORT_ID } from "@/lib/hris/month-label";
import {
  categoryClass,
  formatScore,
  scoreToneClass,
  toScore,
} from "@/lib/kpi/ui-performance";
import type { PgNumeric } from "../types";

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${categoryClass(category)}`}>
      {category}
    </span>
  );
}

/** Nilai KPI per bulan dalam kuartal (chip kecil). */
export function MonthScoreChip({ month, score }: { month: number; score: PgNumeric | undefined }) {
  const value = toScore(score);
  return (
    <span className="flex-1 rounded-md bg-muted/60 px-2 py-1 text-center text-xs">
      <span className="block text-[10px] text-gray-400">{MONTH_SHORT_ID[month]}</span>
      <span className={`font-semibold ${scoreToneClass(value)}`}>{formatScore(value, 0)}</span>
    </span>
  );
}

export function PerfLoadingCard({ error }: { error?: string | null }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </>
        )}
      </CardContent>
    </Card>
  );
}
