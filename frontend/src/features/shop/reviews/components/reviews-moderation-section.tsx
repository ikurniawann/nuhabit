'use client';

// Moderasi ulasan produk toko online: antrean pending dulu, publikasikan
// atau tolak; ulasan yang sudah diputuskan bisa dibalik.

import { useState } from 'react';
import { Loader2, MessageSquare, RefreshCw, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { formatDateTime } from '@/lib/format';
import { sortReviewsForModeration } from '../moderation';
import { useModerateReview, useShopReviews, type ReviewStatus, type ShopReview } from '../queries';

const STATUS_TABS: Array<{ value: ReviewStatus | ''; label: string }> = [
  { value: 'pending', label: 'Menunggu' },
  { value: 'published', label: 'Dipublikasikan' },
  { value: 'rejected', label: 'Ditolak' },
  { value: '', label: 'Semua' },
];

const STATUS_TONE: Record<ReviewStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  published: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-600',
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'menunggu',
  published: 'dipublikasikan',
  rejected: 'ditolak',
};

export function ReviewsModerationSection() {
  const [status, setStatus] = useState<ReviewStatus | ''>('pending');
  const reviewsQuery = useShopReviews(status);
  const moderate = useModerateReview();
  const reviews = sortReviewsForModeration(reviewsQuery.data ?? []);

  return (
    <PurchasingListSection
      icon={MessageSquare}
      title="Ulasan Produk"
      description={`${reviews.length} ulasan`}
      toolbar={
        <Button type="button" variant="outline" size="sm" onClick={() => reviewsQuery.refetch()} className="h-9">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Muat Ulang
        </Button>
      }
    >
      <div className="border-b border-gray-100 px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} type="button" size="sm" variant={status === tab.value ? 'default' : 'outline'} className="h-8" onClick={() => setStatus(tab.value)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {reviewsQuery.isPending ? (
        <div className="flex flex-col items-center gap-3 px-4 py-16 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
          <p className="text-sm">Memuat ulasan...</p>
        </div>
      ) : reviewsQuery.isError ? (
        <p className="px-4 py-16 text-center text-sm text-red-500">{reviewsQuery.error.message || 'Gagal memuat ulasan'}</p>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-16 text-gray-400">
          <MessageSquare className="h-12 w-12 opacity-40" />
          <p className="text-sm">Belum ada ulasan</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {reviews.map((review) => (
            <ReviewRow key={review.id} review={review} busy={moderate.isPending} onModerate={(next) => moderate.mutate({ id: review.id, status: next })} />
          ))}
        </ul>
      )}
    </PurchasingListSection>
  );
}

function ReviewRow({ review, busy, onModerate }: { review: ShopReview; busy: boolean; onModerate: (status: ReviewStatus) => void }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-gray-900">{review.productName}</p>
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[review.status]}`}>{STATUS_LABEL[review.status]}</span>
        </div>
        <p className="mt-1 flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex" aria-label={`${review.rating} dari 5`}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} className={`h-3.5 w-3.5 ${star <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
            ))}
          </span>
          <span>{review.customerName || 'Member'}</span>
          {review.orderNumber ? <span>· {review.orderNumber}</span> : null}
          <span>· {formatDateTime(review.createdAt)}</span>
        </p>
        {review.comment ? <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{review.comment}</p> : <p className="mt-2 text-sm italic text-gray-400">Tanpa komentar</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {review.status !== 'published' ? (
          <Button type="button" size="sm" className="h-8" disabled={busy} onClick={() => onModerate('published')}>
            Publikasikan
          </Button>
        ) : null}
        {review.status !== 'rejected' ? (
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => onModerate('rejected')}>
            Tolak
          </Button>
        ) : null}
      </div>
    </li>
  );
}
