'use client';

import { useState } from 'react';
import { Check, Copy, Tag } from 'lucide-react';
import type { StorefrontBanner } from '@/lib/shop/types';

/** Campaign banner from storefront settings; "Copy code" pre-fills checkout. */
export function PromoBanner({ banner, onCopyCode }: { banner: StorefrontBanner; onCopyCode: (code: string) => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* the code is still applied to the cart */
    }
    onCopyCode(code);
    setCopied(true);
  };

  return (
    <section aria-label="Promotion" className="notch mb-10 flex flex-col gap-4 bg-lime px-5 py-6 text-forest sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-start gap-3">
        <Tag className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-display text-xl font-extrabold uppercase tracking-tight sm:text-2xl">{banner.headline}</p>
          {banner.text ? <p className="mt-1 text-sm text-forest/80">{banner.text}</p> : null}
        </div>
      </div>
      {banner.code ? (
        <button
          type="button"
          onClick={() => void copy(banner.code as string)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-everglade"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied, applied at checkout' : 'Copy code'}
          <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-xs">{banner.code}</span>
        </button>
      ) : null}
    </section>
  );
}
