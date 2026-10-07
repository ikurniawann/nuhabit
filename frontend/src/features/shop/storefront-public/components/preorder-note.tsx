import { formatDateEn } from '@/lib/shop/format-en';

/** "Pre-order" label with the expected ship date. */
export function PreorderBadge({ until, className = '' }: { until: string | null; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-semibold text-accent-foreground ${className}`}
    >
      Pre-order{until ? ` · ships ${formatDateEn(until)}` : ''}
    </span>
  );
}
