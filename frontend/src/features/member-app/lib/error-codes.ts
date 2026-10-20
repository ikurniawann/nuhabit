"use client";

import { useCallback } from "react";
import { ApiError, type ErrorParams } from "./api";
import { useT, type T } from "./i18n";
import { useLang, type Lang } from "./lang";

/**
 * Server error codes the member app knows, mapped to English dictionary keys
 * (the ID dictionary in i18n-errors.ts translates them). `{name}` placeholders
 * take the params the server sends with the code. An unknown code falls back
 * to the server text.
 */
/** The booking denial that links to the waiver screen. */
export const WAIVER_REQUIRED = "BOOKING_WAIVER_REQUIRED";

export const ERROR_MESSAGES: Record<string, string> = {
  // Booking (gymscheduling)
  BOOKING_MEMBER_NOT_ACTIVE: "Your membership can't book classes yet.",
  BOOKING_SESSION_NOT_BOOKABLE: "This class isn't open for booking.",
  BOOKING_BOOKING_NOT_OPEN_YET: "Booking for this class hasn't opened yet.",
  BOOKING_BOOKING_WINDOW_CLOSED: "Booking for this class has closed.",
  BOOKING_ALREADY_BOOKED: "You already have a spot in this class.",
  BOOKING_PASS_SUSPENDED:
    "Booking is paused until {until} because your pass reached its strike limit (late cancels or no-shows).",
  BOOKING_CONCURRENT_LIMIT: "Active booking limit reached: up to {max} upcoming classes.",
  BOOKING_DAILY_LIMIT: "Booking limit reached: up to {max} classes per day.",
  BOOKING_INSUFFICIENT_CREDITS: "Not enough credits for this class.",
  BOOKING_CLASS_NOT_COVERED: "Your credit package doesn't cover this class.",
  BOOKING_WAIVER_REQUIRED: "Accept the gym waiver before you book or check in.",
  BOOKING_NO_OFFER: "No spot has been offered to you in this class yet.",
  BOOKING_OFFER_EXPIRED: "This spot offer has expired.",
  BOOKING_SEAT_TAKEN: "Another member already took that spot.",
  BOOKING_NOT_CANCELLABLE: "This booking can no longer be cancelled.",
  BOOKING_NOT_FOUND: "Booking not found.",
  SESSION_NOT_FOUND: "Class not found.",
  MEMBER_NOT_FOUND: "Member not found.",
  // Check-in
  CHECKIN_NOT_CONFIRMED: "Only confirmed bookings can check in.",
  CHECKIN_CLASS_NOT_COVERED: "The credit package doesn't cover this class.",
  CHECKIN_INSUFFICIENT_CREDITS: "Not enough credits for this class: {needed} needed.",
  // Purchases (gymcredits)
  PACKAGE_NOT_FOUND: "Package not found.",
  PURCHASE_ARCHIVED: "This package is no longer on sale.",
  PURCHASE_LIMIT_REACHED: "You've reached the purchase limit for this package.",
  PURCHASE_BRANCH_MISMATCH: "This package isn't sold at this branch.",
  PURCHASE_MEMBER_INACTIVE: "Your membership is inactive, so you can't buy credits.",
  PURCHASE_BRANCH_REQUIRED: "This package belongs to one branch. Choose the branch.",
  ARK_INSUFFICIENT: "Not enough ARK Coin balance.",
  ARK_COIN_DISABLED: "ARK Coin is switched off right now.",
  PAYMENT_UNAVAILABLE: "Online payment isn't available right now.",
  // Vouchers (promo engine reasons)
  VOUCHER_UNAVAILABLE: "Voucher codes can't be used for class packages yet.",
  VOUCHER_REJECTED: "This voucher code can't be used.",
  VOUCHER_NONAKTIF: "Unknown or expired voucher code.",
  VOUCHER_BELUM_MULAI: "This voucher code isn't valid yet.",
  VOUCHER_KEDALUWARSA: "This voucher code has ended.",
  VOUCHER_SCOPE: "This voucher code doesn't apply to class packages.",
  VOUCHER_PRODUK_TIDAK_SESUAI: "This voucher code doesn't apply to class packages.",
  VOUCHER_PAKET_TIDAK_SESUAI: "This voucher code doesn't apply to this package.",
  VOUCHER_KHUSUS_MEMBER: "This code is for members only.",
  VOUCHER_BUKAN_MEMBER_BARU: "This code is for new members only.",
  VOUCHER_MIN_PEMBELIAN: "Your purchase is below this code's minimum.",
  VOUCHER_KUOTA_HABIS: "This voucher code has run out.",
  VOUCHER_LIMIT_NOMOR: "Your number has already used this code.",
  VOUCHER_CHANGED: "The voucher discount changed. Try again.",
  // Passes
  PASS_NOT_FOUND: "Pass not found.",
  PASS_ALREADY_FROZEN: "Your pass is already frozen.",
  PASS_NOT_ACTIVE: "Only an active pass can be frozen.",
  PASS_NOT_STARTED: "Your pass hasn't started yet.",
  PASS_FREEZE_UNAVAILABLE: "Pass freezing isn't available.",
  PASS_FREEZE_TOO_SHORT: "A freeze lasts at least {days} days.",
  PASS_FREEZE_ALLOWANCE: "You have {days} freeze days left this year.",
  PASS_NOT_FROZEN: "Your pass isn't frozen.",
  PASS_ENDED: "Your pass has ended.",
  // Referral
  REFERRAL_INVALID: "Referral code not found, or the program is paused.",
  REFERRAL_RATE_LIMITED: "Too many requests. Try again in a few minutes.",
};

/** The insufficient-credit denial names the numbers only when other bookings hold credits, as the server text does. */
export const CREDITS_HELD_MESSAGE =
  "Not enough credits for this class: {available} available, {needed} needed ({reserved} held by other bookings).";

function messageKey(code: string, params: ErrorParams | undefined): string | undefined {
  if (code === "BOOKING_INSUFFICIENT_CREDITS" && Number(params?.reserved) > 0) return CREDITS_HELD_MESSAGE;
  return ERROR_MESSAGES[code];
}

/** ISO timestamps in params read as a WIB date and time in the member's language. */
function formatParams(params: ErrorParams | undefined, lang: Lang): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    const isTime = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);
    out[name] = isTime
      ? new Date(value).toLocaleString(lang === "id" ? "id-ID" : "en-GB", {
          timeZone: "Asia/Jakarta",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : value;
  }
  return out;
}

/**
 * The text to show for a failed request: the translated copy of a known
 * code, else the server text of an ApiError, else the fallback.
 */
export function describeError(e: unknown, t: T, lang: Lang, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const key = e.code ? messageKey(e.code, e.params) : undefined;
  return key ? t(key, formatParams(e.params, lang)) : e.message;
}

/** describeError bound to the current language. */
export function useErrorText() {
  const t = useT();
  const lang = useLang();
  return useCallback((e: unknown, fallback: string) => describeError(e, t, lang, fallback), [t, lang]);
}
