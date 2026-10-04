"use client";

// Hook React Query halaman publik booking & season pass. QueryProvider
// terpasang di root layout, jadi rute (public) ikut terlayani. Tanpa
// retry: perilaku lama sekali coba, dan POST checkout tidak boleh diulang
// diam-diam (bisa membuat booking ganda).

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BookingCreatePayload } from "@/lib/ticketing/booking-wizard-cart";
import {
  checkPromoCode,
  createBooking,
  createPass,
  fetchBookingAvailability,
  fetchBookingCatalog,
  fetchBookingSlots,
  fetchBookingStatus,
  fetchPassCatalog,
  fetchPassStatus,
  PublicApiError,
} from "./api";
import type { CheckoutRedirect, PassPurchaseInput, PromoCheckInput } from "./types";

const BOOKING_STATUS_POLL_MS = 10_000;
const PASS_STATUS_POLL_MS = 8_000;

export const publicBookingKeys = {
  venue: (slug: string) => ["public-booking", slug] as const,
  catalog: (slug: string, date: string) => ["public-booking", slug, "catalog", date] as const,
  availability: (slug: string, from: string, to: string) =>
    ["public-booking", slug, "availability", from, to] as const,
  slots: (slug: string, date: string) => ["public-booking", slug, "slots", date] as const,
  passes: (slug: string) => ["public-booking", slug, "passes"] as const,
  bookingStatus: (token: string) => ["public-booking", "status", token] as const,
  passStatus: (token: string) => ["public-booking", "pass-status", token] as const,
};

/** Tanggal berganti: tampilkan katalog lama (nama venue, hero) selagi memuat. */
export const useBookingCatalog = (slug: string, date: string) =>
  useQuery({
    queryKey: publicBookingKeys.catalog(slug, date),
    queryFn: () => fetchBookingCatalog(slug, date),
    placeholderData: keepPreviousData,
    retry: false,
  });

/** EPIC-031 B4: tanggal penuh/tutup, indikatif (kebenaran final = 409 create). */
export const useBookingAvailability = (slug: string, from: string, to: string) =>
  useQuery({
    queryKey: publicBookingKeys.availability(slug, from, to),
    queryFn: () => fetchBookingAvailability(slug, from, to),
    retry: false,
  });

export const useBookingSlots = (slug: string, date: string) =>
  useQuery({
    queryKey: publicBookingKeys.slots(slug, date),
    queryFn: () => fetchBookingSlots(slug, date),
    retry: false,
  });

export const usePromoCheck = (slug: string) =>
  useMutation<Awaited<ReturnType<typeof checkPromoCode>>, PublicApiError, PromoCheckInput>({
    mutationFn: (input) => checkPromoCode(slug, input),
    retry: false,
  });

const redirectToPayment = (result: CheckoutRedirect) => {
  window.location.href = result.invoice_url ?? result.status_url;
};

/**
 * Create booking lalu arahkan ke invoice. 409 (keburu penuh) menyegarkan
 * peta tanggal & slot supaya yang penuh langsung tercoret.
 */
export const useCreateBooking = (slug: string) => {
  const queryClient = useQueryClient();
  return useMutation<CheckoutRedirect, PublicApiError, BookingCreatePayload>({
    mutationFn: (payload) => createBooking(slug, payload),
    retry: false,
    onSuccess: redirectToPayment,
    onError: (error) => {
      if (error.status !== 409) return;
      queryClient.invalidateQueries({ queryKey: [...publicBookingKeys.venue(slug), "availability"] });
      queryClient.invalidateQueries({ queryKey: [...publicBookingKeys.venue(slug), "slots"] });
    },
  });
};

/** Poll selama menunggu bayar supaya redirect Xendit berpindah ke "terbayar". */
export const useBookingStatus = (token: string) =>
  useQuery({
    queryKey: publicBookingKeys.bookingStatus(token),
    queryFn: () => fetchBookingStatus(token),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "menunggu-bayar" ? BOOKING_STATUS_POLL_MS : false,
    refetchIntervalInBackground: true,
  });

export const usePassCatalog = (slug: string) =>
  useQuery({
    queryKey: publicBookingKeys.passes(slug),
    queryFn: () => fetchPassCatalog(slug),
    retry: false,
  });

export const useCreatePass = (slug: string) =>
  useMutation<CheckoutRedirect, PublicApiError, PassPurchaseInput>({
    mutationFn: (input) => createPass(slug, input),
    retry: false,
    onSuccess: redirectToPayment,
  });

/** Poll selama pending supaya QR muncul otomatis setelah PAID. */
export const usePassStatus = (token: string) =>
  useQuery({
    queryKey: publicBookingKeys.passStatus(token),
    queryFn: () => fetchPassStatus(token),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? PASS_STATUS_POLL_MS : false,
    refetchIntervalInBackground: true,
  });
