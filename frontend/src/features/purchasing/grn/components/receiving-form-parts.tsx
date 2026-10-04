import type { ReactNode } from "react";
import { Info, Package } from "lucide-react";

/** Kotak "Panduan" di kolom ringkasan form penerimaan dan pengiriman. */
export function GuidelinesBox({ lines }: { lines: readonly string[] }) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
        <Info className="h-4 w-4 text-pink-600" />
        Panduan
      </div>
      <ul className="space-y-2 text-xs leading-5 text-gray-600">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Empat item pertama beserta qty diterima. */
export function ItemPreviewBox({ items }: { items: { key: string; name: string; qty: ReactNode }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
        <Package className="h-4 w-4 text-pink-600" />
        Pratinjau Item
      </div>
      <ul className="space-y-2 text-xs text-gray-600">
        {items.slice(0, 4).map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3">
            <span className="truncate">{item.name}</span>
            <span className="shrink-0 font-medium text-gray-900">{item.qty}</span>
          </li>
        ))}
        {items.length > 4 && <li className="text-gray-500">+{items.length - 4} item lainnya</li>}
      </ul>
    </div>
  );
}

/** Baris label/nilai di kartu ringkasan. */
export function SummaryRow({
  label,
  children,
  strong = false,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <dt className={strong ? "font-medium text-gray-900" : "text-gray-500"}>{label}</dt>
      <dd className={`text-right text-gray-900 ${strong ? "font-semibold" : "font-medium"}`}>{children}</dd>
    </div>
  );
}

/** Label kecil + nilai di panel info abu-abu. */
export function InfoField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-gray-500">{label}</p>
      <div className="font-medium text-gray-900">{children}</div>
    </div>
  );
}
