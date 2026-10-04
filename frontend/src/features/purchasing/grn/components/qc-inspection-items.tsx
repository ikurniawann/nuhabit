import { ClipboardCheck, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import {
  QC_PARAMETER_LABELS,
  QC_PARAMETERS,
  type QcLine,
  type QcLineChange,
  type QcParameterResult,
} from "@/lib/purchasing/grn-ui-qc";

const QTY_FIELDS: { key: keyof QcLineChange; field: "qty_inspected" | "qty_accepted" | "qty_rejected"; className: string }[] = [
  { key: "inspected", field: "qty_inspected", className: "h-9 text-right" },
  { key: "accepted", field: "qty_accepted", className: "h-9 text-right border-emerald-200/80 focus-visible:ring-emerald-200" },
  { key: "rejected", field: "qty_rejected", className: "h-9 text-right border-red-200/80 focus-visible:ring-red-200" },
];

export function QcItemsCard({
  lines,
  disabled,
  onChange,
}: {
  lines: QcLine[];
  disabled: boolean;
  onChange: (grnItemId: string, change: QcLineChange) => void;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-pink-600" />
          Inspeksi Per Item
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 bg-gray-50/80 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Diterima</th>
                <th className="px-4 py-3 text-right font-medium">Diinspeksi</th>
                <th className="px-4 py-3 text-right font-medium">Lolos</th>
                <th className="px-4 py-3 text-right font-medium">Gagal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.grn_item_id} className="border-b border-gray-200/60 align-top hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{line.materialName}</p>
                    <p className="text-xs text-gray-500">
                      {line.materialCode} · {line.unitLabel}
                    </p>
                    {line.variantLabel && <p className="text-xs text-gray-500">Varian: {line.variantLabel}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatNumber(line.qtyReceived, 4)}
                  </td>
                  {QTY_FIELDS.map(({ key, field, className }) => (
                    <td key={key} className="px-4 py-3">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line[field]}
                        disabled={disabled}
                        onChange={(e) => onChange(line.grn_item_id, { [key]: e.target.value })}
                        className={className}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function QcParametersCard({
  results,
  disabled,
  onChange,
}: {
  results: Record<string, QcParameterResult>;
  disabled: boolean;
  onChange: (param: string, value: QcParameterResult) => void;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-pink-600" />
          Parameter Inspeksi
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
        {QC_PARAMETERS.map((param) => (
          <div
            key={param}
            className="flex items-center justify-between rounded-xl border border-gray-200/70 bg-gray-50/50 px-3 py-2.5"
          >
            <span className="text-sm font-medium text-gray-800">{QC_PARAMETER_LABELS[param]}</span>
            <Select value={results[param] || "OK"} onValueChange={(value) => onChange(param, value as QcParameterResult)}>
              <SelectTrigger
                className={`h-8 w-[120px] border-gray-200/80 ${disabled ? "pointer-events-none opacity-50" : ""}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="NG">NG</SelectItem>
                <SelectItem value="NA">N/A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
