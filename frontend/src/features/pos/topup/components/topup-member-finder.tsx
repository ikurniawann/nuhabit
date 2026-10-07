'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Nfc, Search, UserPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { useTopupCustomers } from '../queries';
import type { TopupCustomer } from '../types';

const MIN_SEARCH_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Pencari member untuk halaman top-up (redesign UX, permintaan owner
 * 2026-08-16): pencarian langsung di halaman — bukan tombol → modal —
 * plus zona tap NFC yang jelas.
 *
 * Kasir cukup: (1) tempel kartu di reader, atau (2) langsung ketik nama /
 * nomor HP / nomor kartu di kotak yang sudah ter-autofocus. Hasil muncul
 * live di bawahnya; Enter memilih hasil teratas. Pencarian nama/HP/kartu
 * ditangani satu query yang sama di server (ilike name+email+phone+nfc_uid).
 */
export function TopupMemberFinder({
  resolvingCard,
  arkRate,
  onSelect,
  onCreateNew,
}: {
  resolvingCard: boolean;
  arkRate: number;
  onSelect: (customer: TopupCustomer) => void;
  onCreateNew: (prefill: string) => void;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  const active = search.length >= MIN_SEARCH_CHARS;
  const { data: results = [], isFetching } = useTopupCustomers(
    { search },
    { enabled: active }
  );
  const customers = active ? results : [];

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && customers.length > 0) {
      event.preventDefault();
      onSelect(customers[0]);
    } else if (event.key === 'Escape') {
      setInput('');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:items-stretch">
      {/* Zona tap NFC — jalur tercepat, ditaruh menonjol di kiri */}
      <div className="lg:col-span-5">
        <div className="relative flex h-full min-h-64 flex-col justify-between overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/90 via-primary to-amber-600 p-6 text-primary-foreground shadow-sm">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-12 left-8 h-32 w-32 rounded-full bg-black/10" />

          <div className="relative flex items-center justify-between text-sm font-medium opacity-90">
            <span>Top-up ARK</span>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              Member
            </span>
          </div>

          <div className="relative flex flex-col items-center gap-3 py-4 text-center">
            <span className="relative grid h-20 w-20 place-items-center">
              {/* Denyut halus supaya kasir tahu reader siap tanpa harus membaca */}
              <span
                className={cn(
                  'absolute inset-0 rounded-full bg-white/15',
                  resolvingCard ? 'animate-ping' : 'animate-pulse'
                )}
              />
              <span className="relative grid h-16 w-16 place-items-center rounded-full border-2 border-white/40 bg-white/10">
                {resolvingCard ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : (
                  <Nfc className="h-8 w-8" />
                )}
              </span>
            </span>
            <div>
              <div className="text-lg font-bold">
                {resolvingCard ? 'Membaca kartu…' : 'Tap Kartu Member'}
              </div>
              <p className="mt-1 text-sm opacity-85">
                {resolvingCard
                  ? 'Tunggu sebentar — data member sedang dimuat'
                  : 'Tempelkan kartu di reader, member langsung terpilih'}
              </p>
            </div>
          </div>

          <div className="relative text-center text-xs opacity-75">
            Kartu belum terdaftar? Tap saja — sistem menawarkan pendaftaran.
          </div>
        </div>
      </div>

      {/* Pencarian manual — langsung ketik, hasil live */}
      <div className="flex flex-col gap-3 lg:col-span-7">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            autoFocus
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Cari nama, nomor HP, atau nomor kartu…"
            className="h-13 w-full rounded-2xl border border-gray-200/80 bg-white pl-12 pr-12 text-base text-foreground shadow-xs outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
          />
          {input ? (
            <button
              type="button"
              onClick={() => {
                setInput('');
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="Bersihkan pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="min-h-48 flex-1 rounded-2xl border border-gray-200/70 bg-card">
          {!active ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Ketik minimal {MIN_SEARCH_CHARS} huruf/angka — hasil muncul langsung.
                <br />
                Tekan <kbd className="rounded border border-gray-300/80 bg-muted/60 px-1.5 py-0.5 text-[11px] font-semibold">Enter</kbd> untuk memilih hasil teratas.
              </p>
            </div>
          ) : isFetching && customers.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Mencari…
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Tidak ada member yang cocok dengan{' '}
                <span className="font-semibold text-foreground">“{search}”</span>
              </p>
              <button
                type="button"
                onClick={() => onCreateNew(search)}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-brand-text transition hover:bg-primary/10"
              >
                <UserPlus className="h-4 w-4" />
                Daftarkan member baru
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200/70">
              {customers.slice(0, 8).map((item, index) => (
                <li key={item.id}>
                  <MemberRow
                    customer={item}
                    arkRate={arkRate}
                    isTopHit={index === 0}
                    onSelect={() => onSelect(item)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => onCreateNew(input.trim())}
          className="inline-flex items-center gap-2 self-start text-sm font-medium text-muted-foreground transition hover:text-brand-text"
        >
          <UserPlus className="h-4 w-4" />
          Member belum terdaftar? Daftarkan baru
        </button>
      </div>
    </div>
  );
}

function initialsOf(name?: string | null, phone?: string | null) {
  const source = (name || '').trim();
  if (!source) return (phone || '?').slice(-2);
  const parts = source.split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : source.slice(0, 2).toUpperCase();
}

function tierChipClass(tier?: string | null) {
  const value = String(tier || 'regular').toLowerCase();
  if (value === 'gold') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80';
  if (value === 'bronze') return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200/80';
  if (value === 'silver') return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80';
  if (value === 'platinum') return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/80';
  return 'bg-muted/60 text-muted-foreground ring-1 ring-gray-200/70';
}

function MemberRow({
  customer,
  arkRate,
  isTopHit,
  onSelect,
}: {
  customer: TopupCustomer;
  arkRate: number;
  isTopHit: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-primary/5"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-brand-text">
        {initialsOf(customer.name, customer.phone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {customer.name || 'Tanpa nama'}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize',
              tierChipClass(customer.membership_tier)
            )}
          >
            {customer.membership_tier || 'regular'}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{customer.phone}</span>
          {customer.nfc_uid ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <Nfc className="h-3 w-3" />
              {customer.nfc_uid}
            </span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-bold text-amber-600">
          {formatArkAmount(Number(customer.ark_coin_balance || 0), arkRate)}
        </span>
        {isTopHit ? (
          <kbd className="mt-0.5 inline-block rounded border border-gray-300/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Enter
          </kbd>
        ) : null}
      </span>
    </button>
  );
}
