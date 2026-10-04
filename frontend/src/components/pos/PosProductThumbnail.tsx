'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PosProductThumbnailProps {
  src?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
}

function hasProductImage(url?: string | null): url is string {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('/products/placeholder.png') || trimmed === '/products/placeholder.png') {
    return false;
  }
  return true;
}

export function PosProductThumbnail({
  src,
  alt,
  className,
  iconClassName,
}: PosProductThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const showImage = hasProductImage(src) && !failed;

  if (!showImage) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-gray-100 text-gray-400',
          className
        )}
        title="No photo"
      >
        <ImageOff className={cn('h-5 w-5', iconClassName)} aria-hidden />
        <span className="sr-only">{alt} — no photo</span>
      </div>
    );
  }

  return (
    // URL foto bisa dari host mana saja (belum ada images.remotePatterns) → tanpa optimasi.
    <Image
      src={src}
      alt={alt}
      width={96}
      height={96}
      unoptimized
      className={cn('h-full w-full object-cover', className)}
      onError={() => setFailed(true)}
    />
  );
}
