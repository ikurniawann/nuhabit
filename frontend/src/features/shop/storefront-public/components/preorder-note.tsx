import { formatDate } from '@/lib/format';

/** Label "Pre-order" dengan perkiraan tanggal kirim. */
export function PreorderBadge({ until, className = '' }: { until: string | null; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-semibold text-accent-foreground ${className}`}
    >
      Pre-order{until ? ` · kirim ${formatDate(until)}` : ''}
    </span>
  );
}
