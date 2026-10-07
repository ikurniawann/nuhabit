"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { matchesNavQuery, type NavLeaf } from "@/lib/iam/nav-leaves";
import { cn } from "@/lib/utils";
import { useNavigate } from "./nav-link";

const HITS_PER_GROUP = 5;

/**
 * Pill page search over the user's IAM menu. ⌘K / Ctrl+K focuses it from
 * anywhere; arrows, Enter and Escape drive the results.
 */
export function GlobalSearch({
  leaves,
  className,
  autoFocus = false,
  onNavigate,
}: {
  leaves: NavLeaf[];
  className?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const groups = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const bySection = new Map<string, NavLeaf[]>();
    for (const leaf of leaves) {
      if (!matchesNavQuery(leaf, trimmed)) continue;
      const hits = bySection.get(leaf.section) ?? [];
      if (hits.length < HITS_PER_GROUP) hits.push(leaf);
      bySection.set(leaf.section, hits);
    }
    return [...bySection.entries()];
  }, [leaves, query]);
  const hits = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        // Only the visible search box claims the shortcut.
        if (!inputRef.current?.offsetParent) return;
        event.preventDefault();
        inputRef.current.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(leaf: NavLeaf) {
    setQuery("");
    (document.activeElement as HTMLElement | null)?.blur();
    onNavigate?.();
    navigate(leaf.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && hits.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp" && hits.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      go(hits[active]);
    } else if (event.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  }

  const open = query.trim().length > 0;
  let index = -1;

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-4 flex -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
        <Search />
      </span>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Cari halaman"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery("")}
        placeholder="Cari halaman…"
        className="h-11 w-full min-w-0 rounded-full !border-0 !bg-card pr-14 pl-10 text-base text-foreground shadow-card transition-colors outline-none placeholder:text-muted-foreground focus:!shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-primary)_20%,transparent)] md:text-sm"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline">
        ⌘K
      </kbd>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Hasil pencarian halaman"
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-[60dvh] overflow-y-auto rounded-2xl border border-border bg-card p-1 shadow-float"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada halaman untuk &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            groups.map(([section, items]) => (
              <div key={section} role="group" aria-label={section}>
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {section}
                </p>
                {items.map((leaf) => {
                  index += 1;
                  const i = index;
                  return (
                    <button
                      key={`${leaf.href}::${leaf.label}`}
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(leaf)}
                      className="flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface aria-selected:bg-surface"
                    >
                      <span className="w-full truncate text-sm font-medium text-foreground">
                        {leaf.label}
                      </span>
                      <span className="w-full truncate text-xs text-muted-foreground">
                        {leaf.href}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
