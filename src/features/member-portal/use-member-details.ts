"use client";

import { useCallback, useState } from "react";

/** Detail order dari GET /api/member-portal/orders/:id. */
export interface MemberOrderDetail {
  order: {
    order_number: string;
    ordered_at: string;
    total_amount: number;
    discount_amount: number;
    discount_reason: string | null;
    payment_method: string | null;
    ark_coins_used: number;
    venue_name: string | null;
    subtotal: number;
  };
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    discount_amount: number;
    total_amount: number;
  }>;
  xp_earned: number;
  ark_rate: number;
}

/** Kunjungan per venue dari GET /api/member-portal/visits. */
export interface MemberVisits {
  visit_count: number;
  venues: Array<{
    venue_name: string;
    order_count: number;
    day_count: number;
    last_visit_at: string;
  }>;
}

async function getData<T>(url: string, fallbackError: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || fallbackError);
  return json.data as T;
}

/**
 * Data dialog detail portal member. Order di-fetch tiap dibuka; kunjungan
 * cukup sekali per sesi halaman.
 */
export function useMemberDetails() {
  const [order, setOrder] = useState<MemberOrderDetail | null>(null);
  const [visits, setVisits] = useState<MemberVisits | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<void>, fallbackError: string) => {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadOrder = useCallback(
    (id: string) => {
      setOrder(null);
      return run(async () => {
        setOrder(await getData<MemberOrderDetail>(`/api/member-portal/orders/${id}`, "Gagal memuat detail"));
      }, "Gagal memuat detail");
    },
    [run]
  );

  const loadVisits = useCallback(() => {
    setError(null);
    if (visits) return Promise.resolve();
    return run(async () => {
      setVisits(await getData<MemberVisits>("/api/member-portal/visits", "Gagal memuat kunjungan"));
    }, "Gagal memuat kunjungan");
  }, [run, visits]);

  return { order, visits, busy, error, loadOrder, loadVisits };
}
