'use client';

import { useEffect, useState } from 'react';
import type { CollectionGroup } from '@/lib/shop/storefront-cart';

/**
 * Navigasi koleksi yang menempel di bawah header: chip per koleksi,
 * menggulir ke seksinya; chip aktif mengikuti seksi yang sedang terlihat.
 */
export function CollectionNav({ groups }: { groups: CollectionGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? '');

  useEffect(() => {
    const sections = groups
      .map((group) => document.getElementById(`koleksi-${group.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace('koleksi-', ''));
      },
      { rootMargin: '-40% 0px -50% 0px' }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(`koleksi-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav aria-label="Koleksi" className="border-t border-gray-100">
      <div className="no-scrollbar mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2">
        {groups.map((group) => {
          const current = group.id === active;
          return (
            <button
              key={group.id}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => jump(group.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                current ? 'bg-ink text-on-ink' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
