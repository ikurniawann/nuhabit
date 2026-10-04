import { z } from "zod";
import { memberError, withMemberSession } from "@/lib/member-portal/route";
import { SchedulingError } from "./booking-server";

export const uuid = z.string().uuid();

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
