import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu } from "@/lib/api/auth";
import { memberError, withMemberSession } from "@/lib/member-portal/route";
import { SchedulingError } from "./booking-server";

export const ok = (data: unknown) => NextResponse.json({ success: true, data });
export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export const uuid = z.string().uuid();

/**
 * Bungkus handler API staf jadwal gym: gerbang menu IAM, 400 untuk zod,
 * SchedulingError → pesannya + status 4xx, galat lain → 500 dengan pesan aman.
 */
export function schedulingRoute<A extends unknown[]>(
  prefixes: readonly string[],
  failMessage: string,
  handler: (userId: string, ...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    const guard = await requirePosMenu(prefixes);
    if (guard.error) return guard.error;
    try {
      return await handler(guard.userId, ...args);
    } catch (error) {
      if (error instanceof SchedulingError) return fail(error.message, error.status);
      if (error instanceof z.ZodError) return fail("Data tidak valid");
      console.error(`[gym-scheduling] ${failMessage}:`, error);
      return fail(failMessage, 500);
    }
  };
}

/** Versi portal member: sesi member wajib, SchedulingError → pesan untuk member. */
export function memberSchedulingRoute<A extends unknown[]>(
  failMessage: string,
  handler: (customerId: string, ...args: A) => Promise<Response>
) {
  return withMemberSession(failMessage, async (customerId: string, ...args: A) => {
    try {
      return await handler(customerId, ...args);
    } catch (error) {
      if (error instanceof SchedulingError) return memberError(error.message, error.status);
      if (error instanceof z.ZodError) return memberError("Data tidak valid");
      throw error;
    }
  });
}

/** Rentang [from, to) dari query string; default hari ini s.d. 14 hari ke depan. */
export function rangeParams(url: URL, defaultDays = 14): { from: Date; to: Date } {
  const parse = (key: string) => {
    const raw = url.searchParams.get(key);
    if (!raw) return null;
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+07:00` : raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const from = parse("from") ?? new Date();
  const to = parse("to") ?? new Date(from.getTime() + defaultDays * 86_400_000);
  return { from, to };
}

export const optionalUuid = (url: URL, key: string) => {
  const raw = url.searchParams.get(key);
  return raw && uuid.safeParse(raw).success ? raw : undefined;
};
