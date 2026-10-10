import { Star } from 'lucide-react';
import type { ProductRating } from '@/lib/shop/types';

const STARS = [1, 2, 3, 4, 5];

/** Average rating as five stars with the review count. */
export function RatingStars({ rating, compact = false }: { rating: ProductRating; compact?: boolean }) {
  const rounded = Math.round(rating.average * 10) / 10;
  return (
    <span className={`inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-sm'} text-gray-600`} aria-label={`Rated ${rounded} out of 5 from ${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`}>
      <span className="inline-flex" aria-hidden="true">
        {STARS.map((star) => (
          <Star key={star} className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} ${star <= Math.round(rating.average) ? 'fill-forest text-forest' : 'text-gray-300'}`} />
        ))}
      </span>
      <span>{rounded}</span>
      <span className="text-gray-400">({rating.count})</span>
    </span>
  );
}

/** Five tappable stars for a review form. */
export function RatingInput({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          onClick={() => onChange(star)}
          className="rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-forest"
        >
          <Star className={`h-6 w-6 ${star <= value ? 'fill-forest text-forest' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  );
}
