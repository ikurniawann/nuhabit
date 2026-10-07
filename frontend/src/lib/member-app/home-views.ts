/**
 * Bentuk data API /api/member-portal/app/home/* (kontrak referensi
 * @nuhabit/contracts yang dipakai layar beranda & akun), dipakai bersama
 * route handler dan hook klien.
 */

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface MemberAccountView {
  member: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    avatarUrl: string | null;
    status: "ACTIVE" | "INACTIVE";
    createdAt: string;
    emergencyContact: EmergencyContact | null;
    waiverVersion: string | null;
    waiverAcceptedAt: string | null;
  };
  balance: number;
  lowBalance: boolean;
  expiringCredits: number;
}

export interface BookingView {
  booking: { id: string; status: "CONFIRMED" | "WAITLIST" | "CHECKED_IN"; waitlistPosition: number | null };
  session: { id: string; classTypeId: string; startsAt: string; endsAt: string; creditCost: number };
  classTypeName: string;
  branchName: string;
}

export interface AnnouncementView {
  id: string;
  title: string;
  message: string;
  /** URL aplikasi member (sudah dipetakan dari link portal), null bila tanpa tautan. */
  deepLink: string | null;
  imageUrl: string | null;
  createdAt: string;
}

export interface HomeSessionView {
  session: { id: string; classTypeId: string; startsAt: string };
  classTypeName: string;
  branchName: string;
  coachName: string;
  spotsLeft: number;
  myBooking: boolean;
}

export interface HomeSpotlightRace {
  raceEventId: string;
  name: string;
  city: string;
  imageUrl: string | null;
  startsAt: string;
  daysToRace: number;
  joined: boolean;
  goalSec: number | null;
}

export interface HomeFeedView {
  announcements: AnnouncementView[];
  railDay: "TODAY" | "TOMORROW";
  todaySessions: HomeSessionView[];
  spotlightRace: HomeSpotlightRace | null;
}

export interface VisitView {
  log: {
    id: string;
    result: "ALLOWED" | "DENIED";
    reasonCode: string | null;
    creditDelta: number;
    createdAt: string;
  };
  gateName: string;
}

export interface MemberSettingsView {
  units: "METRIC" | "IMPERIAL";
  bookingReminders: boolean;
  language: "EN" | "ID";
}
