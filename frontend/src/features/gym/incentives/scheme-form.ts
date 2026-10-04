/** State form skema honor coach: reducer murni + konversi ke payload API. */
import type { SchemeRow } from "@/lib/gym/incentive-server";
import type { SchemeInput } from "./api";

export interface RateDraft {
  class_type_id: string;
  session_fee_idr: string;
  per_attendee_idr: string;
}

/** Angka disimpan sebagai teks input; dikonversi saat simpan. */
export interface SchemeFormState {
  name: string;
  coach_id: string;
  session_fee_idr: string;
  per_attendee_idr: string;
  full_class_bonus_idr: string;
  full_class_threshold_percent: string;
  no_show_penalty_idr: string;
  is_active: boolean;
  rates: RateDraft[];
}

export type SchemeTextField = Exclude<keyof SchemeFormState, "is_active" | "rates">;

export type SchemeFormAction =
  | { type: "field"; key: SchemeTextField; value: string }
  | { type: "active"; value: boolean }
  | { type: "addRate" }
  | { type: "rate"; index: number; patch: Partial<RateDraft> }
  | { type: "removeRate"; index: number };

/** Nilai awal: skema yang diubah, atau default organisasi untuk skema baru. */
export function initialSchemeForm(scheme: SchemeRow | null): SchemeFormState {
  return {
    name: scheme?.name ?? "",
    coach_id: scheme?.coachId ?? "",
    session_fee_idr: String(scheme?.sessionFeeIdr ?? 150_000),
    per_attendee_idr: String(scheme?.perAttendeeIdr ?? 15_000),
    full_class_bonus_idr: String(scheme?.fullClassBonusIdr ?? 50_000),
    full_class_threshold_percent: String(scheme?.fullClassThresholdPercent ?? 80),
    no_show_penalty_idr: String(scheme?.noShowPenaltyIdr ?? 0),
    is_active: scheme?.isActive ?? true,
    rates: (scheme?.rates ?? []).map((r) => ({
      class_type_id: r.classTypeId,
      session_fee_idr: String(r.sessionFeeIdr),
      per_attendee_idr: String(r.perAttendeeIdr),
    })),
  };
}

export function schemeFormReducer(state: SchemeFormState, action: SchemeFormAction): SchemeFormState {
  switch (action.type) {
    case "field":
      return { ...state, [action.key]: action.value };
    case "active":
      return { ...state, is_active: action.value };
    case "addRate":
      // Tarif baru mulai dari honor umum skema.
      return {
        ...state,
        rates: [
          ...state.rates,
          { class_type_id: "", session_fee_idr: state.session_fee_idr, per_attendee_idr: state.per_attendee_idr },
        ],
      };
    case "rate":
      return { ...state, rates: state.rates.map((r, i) => (i === action.index ? { ...r, ...action.patch } : r)) };
    case "removeRate":
      return { ...state, rates: state.rates.filter((_, i) => i !== action.index) };
  }
}

/** Jenis kelas yang sudah dipakai baris tarif (satu tarif per jenis kelas). */
export const usedClassTypes = (state: SchemeFormState) => state.rates.map((r) => r.class_type_id).filter(Boolean);

export function isSchemeFormValid(state: SchemeFormState, isDefault: boolean): boolean {
  const used = usedClassTypes(state);
  const threshold = Number(state.full_class_threshold_percent);
  return (
    state.name.trim().length >= 2 &&
    (isDefault || state.coach_id !== "") &&
    threshold >= 0 &&
    threshold <= 100 &&
    new Set(used).size === used.length
  );
}

const amount = (value: string) => Number(value) || 0;

/** Payload API; skema default tidak terikat coach, baris tarif tanpa jenis kelas dibuang. */
export function toSchemeInput(state: SchemeFormState, id: string | undefined, isDefault: boolean): SchemeInput {
  return {
    id,
    name: state.name.trim(),
    coach_id: isDefault ? null : state.coach_id,
    session_fee_idr: amount(state.session_fee_idr),
    per_attendee_idr: amount(state.per_attendee_idr),
    full_class_bonus_idr: amount(state.full_class_bonus_idr),
    full_class_threshold_percent: amount(state.full_class_threshold_percent),
    no_show_penalty_idr: amount(state.no_show_penalty_idr),
    is_active: state.is_active,
    rates: state.rates
      .filter((r) => r.class_type_id)
      .map((r) => ({
        class_type_id: r.class_type_id,
        session_fee_idr: amount(r.session_fee_idr),
        per_attendee_idr: amount(r.per_attendee_idr),
      })),
  };
}
