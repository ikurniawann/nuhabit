import { formatRupiah } from '@/lib/format';

/** The effective price with the regular price struck through while a sale runs. */
export function PriceTag({
  price,
  compareAtPrice,
  prefix = '',
  size = 'sm',
}: {
  price: number;
  compareAtPrice: number | null;
  prefix?: string;
  size?: 'sm' | 'lg';
}) {
  const onSale = compareAtPrice !== null && compareAtPrice > price;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${size === 'lg' ? 'text-xl' : 'text-sm'}`}>
      <span className={`font-bold ${onSale ? 'text-forest' : 'text-gray-900'}`}>{prefix}{formatRupiah(price)}</span>
      {onSale ? <s className={`font-normal text-gray-400 ${size === 'lg' ? 'text-base' : 'text-xs'}`}>{formatRupiah(compareAtPrice)}</s> : null}
    </span>
  );
}

export function SaleBadge({ percent, className = '' }: { percent: number; className?: string }) {
  return (
    <span className={`inline-flex rounded-full bg-forest px-2 py-0.5 text-[11px] font-bold text-white ${className}`}>
      -{percent}%
    </span>
  );
}
