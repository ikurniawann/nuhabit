'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { submitProductReview } from '../queries';
import { RatingInput } from './rating-stars';

/**
 * "Rate this item" on the order status page: stars and a comment, then a
 * pending notice. Reviews post to the main store ("default"); the order page
 * is not tied to a store slug.
 */
export function ReviewForm({ orderToken, productId, productName }: { orderToken: string; productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const submit = useMutation({
    retry: false,
    mutationFn: () => submitProductReview('default', { orderToken, productId, rating, comment: comment.trim() || null }),
  });

  if (submit.isSuccess) {
    return <p className="mt-1 text-xs font-medium text-forest">Thanks for your review. It will show after a quick check by our team.</p>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-forest underline">
        Rate this item
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded-xl bg-gray-50 p-3"
      aria-label={`Review ${productName}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (rating > 0) submit.mutate();
      }}
    >
      <RatingInput value={rating} onChange={setRating} />
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="What did you think? (optional)"
        rows={2}
        maxLength={1000}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-forest"
      />
      {submit.isError ? <p className="text-xs text-red-600">{submit.error instanceof Error ? submit.error.message : 'Could not send the review'}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={rating === 0 || submit.isPending}
          className="inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2 text-xs font-semibold text-white hover:bg-everglade disabled:opacity-50"
        >
          {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Send review
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-gray-500">Cancel</button>
      </div>
    </form>
  );
}
