'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { shouldAnimateVerticalMarquee } from '../vertical-marquee';

type VerticalMarqueeListProps = {
  children: ReactNode;
  className?: string;
};

export function VerticalMarqueeList({ children, className = '' }: VerticalMarqueeListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      setOverflowing(shouldAnimateVerticalMarquee(content.scrollHeight, viewport.clientHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [children]);

  const animate = overflowing && !reducedMotion;

  return (
    <div
      ref={viewportRef}
      className={`flex-1 min-h-0 ${animate ? 'overflow-hidden' : 'overflow-y-auto'} ${className}`}
    >
      <div className={animate ? 'stock-alerts-marquee-y' : undefined}>
        <div ref={contentRef} className="space-y-3 p-4 min-h-full">
          {children}
        </div>
        {animate ? (
          <div className="space-y-3 p-4" aria-hidden="true">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
