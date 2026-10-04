import { formatNumber } from "@/lib/format";

type ProductHppCompareProps = {
  hppTersimpan: number;
  hppResep: number;
  hppSelisih: number;
};

export function ProductHppCompare({
  hppTersimpan,
  hppResep,
  hppSelisih,
}: ProductHppCompareProps) {
  const naik = hppSelisih > 0;

  return (
    <div className="space-y-2 rounded-lg border border-gray-200/70 bg-muted/40 p-3 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">HPP saat ini</span>
        <span className="font-medium text-foreground">{formatNumber(hppTersimpan)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">HPP seharusnya</span>
        <span className="font-medium text-foreground">{formatNumber(hppResep)}</span>
      </div>
      <div className="flex justify-between gap-3 border-t border-gray-200/70 pt-2">
        <span className="text-muted-foreground">Selisih</span>
        <span className={`font-medium ${naik ? "text-amber-700" : "text-emerald-700"}`}>
          {naik ? "+" : ""}
          {formatNumber(hppSelisih)}
        </span>
      </div>
    </div>
  );
}
