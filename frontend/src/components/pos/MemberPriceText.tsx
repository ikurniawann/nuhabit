import { memberPrice } from "@/lib/pos/member-price";
import { cn } from "@/lib/utils";

/**
 * Harga dengan diskon member (owner 2026-10-01): bila member terpilih, harga
 * reguler dicoret + harga member. Tanpa member → harga biasa apa adanya.
 */
export function MemberPriceText({
  price,
  memberDiscountPercent = 0,
  format,
  className,
  strikeClassName,
}: {
  price: number;
  memberDiscountPercent?: number;
  format: (value: number) => string;
  /** Kelas utk harga yang berlaku (harga member atau harga biasa). */
  className?: string;
  /** Kelas utk harga reguler yang dicoret. */
  strikeClassName?: string;
}) {
  const discounted = memberPrice(price, memberDiscountPercent);
  if (discounted >= price) return <span className={className}>{format(price)}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className={cn("text-[0.85em] font-normal line-through opacity-60", strikeClassName)}>
        {format(price)}
      </span>
      <span className={className}>{format(discounted)}</span>
    </span>
  );
}
