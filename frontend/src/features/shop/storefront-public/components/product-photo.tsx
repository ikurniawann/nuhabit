"use client";

import { useState } from "react";
import { Package } from "lucide-react";

/** Keep product cards useful when an uploaded image is missing or its URL expires. */
export function ProductPhoto({ src, alt, compact = false }: { src: string | null | undefined; alt: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />;
  }

  return (
    <div role="img" aria-label={`Image unavailable for ${alt}`} className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#f5f7f3] text-everglade/45">
      <Package className={compact ? "h-5 w-5" : "h-10 w-10"} />
      {!compact ? <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">NüHabit Gear</span> : null}
    </div>
  );
}
