'use client';

import { useEffect, useState } from 'react';
import type { CollectionGroup } from '@/lib/shop/storefront-cart';

/**
 * Collection chips pinned under the header: each chip scrolls to its
 * section; the active chip follows the section in view.
 */
export function CollectionNav({ groups }: { groups: CollectionGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? '');

  useEffect(() => {
    const sections = groups
      .map((group) => document.getElementById(`collection-${group.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace('collection-', ''));
      },
      { rootMargin: '-40% 0px -50% 0px' }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(`collection-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav aria-label="Collections" className="mx-auto mt-2 ">
      <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-2xl bg-card/95 p-2 shadow-card backdrop-blur">
        {groups.map((group) => {
          const current = group.id === active;
          return (
            <button
              key={group.id}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => jump(group.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                current ? 'bg-ink text-on-ink' : 'bg-surface-2 text-body hover:bg-gray-200'
              }`}
            >
              {group.name}
              <span className="ml-1 text-xs opacity-60">{group.products.length}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
