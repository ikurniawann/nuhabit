/** Klien API Gym → Kelas Saya (portal coach). */
import type { PayoutRow } from "@/features/gym/incentives/api";
import type { RosterEntry, Session } from "@/features/gym/scheduling/api";
import type { CoachStatementView } from "@/lib/gym/incentive-server";
import { call } from "../shared";

/** Profil coach yang tertaut ke akun yang login. */
export interface MyCoach {
  id: string;
  name: string;
  bio: string;
  specialization: string;
  photo_url: string | null;
}

export interface MyClasses {
  /** null bila akun belum tertaut ke profil coach. */
  coach: MyCoach | null;
  sessions: Session[];
}

export interface MyIncentives {
  coach: { id: string; name: string } | null;
  /** Statement berjalan bulan itu (kelas selesai saja). */
  statement: CoachStatementView | null;
  payouts: PayoutRow[];
}

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const myClassesApi = {
  classes: (from: string, to: string) => call<MyClasses>(`/api/gym/my-classes?${qs({ from, to })}`),
  session: (id: string) => call<{ session: Session; roster: RosterEntry[] }>(`/api/gym/my-classes/sessions/${id}`),
  incentives: (month: string) => call<MyIncentives>(`/api/gym/my-classes/incentives?${qs({ month })}`),
};

export const MY_CLASSES_KEYS = {
  all: ["gym", "my-classes"] as const,
  classes: (from: string, to: string) => ["gym", "my-classes", "list", from, to] as const,
  session: (id: string) => ["gym", "my-classes", "session", id] as const,
  incentives: (month: string) => ["gym", "my-classes", "incentives", month] as const,
};
