export type BandStatus =
  | "tersedia"
  | "dipakai"
  | "hilang"
  | "rusak"
  | "karyawan";

/** Fase E — pairing gelang NFC ↔ karyawan HRIS (akses gate gratis). */
export interface StaffPass {
  id: string;
  band_id: string;
  nfc_uid: string;
  band_label: string | null;
  employee_id: string;
  full_name: string;
  nip: string | null;
  employee_active: boolean;
  created_at: string;
}

export interface EmployeeOption {
  id: string;
  full_name: string;
  nip: string | null;
}
export type ReEntryPolicy = "sekali-masuk" | "bebas-keluar-masuk";
export type PaymentMode = "postpaid" | "prepaid";

export interface TicketChannel {
  id: string;
  code: string;
  name: string;
  is_online: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketBand {
  id: string;
  nfc_uid: string;
  label: string | null;
  status: BandStatus;
  created_at: string;
  updated_at: string;
}

export interface BandFilters {
  q: string;
  status: BandStatus | "";
  page: number;
}

export interface BandListResponse {
  success: boolean;
  data: TicketBand[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface TicketingSettings {
  id: string;
  re_entry_policy: ReEntryPolicy;
  default_credit_limit: string;
  default_payment_mode: PaymentMode;
  booking_slug: string | null;
  /** Masa berlaku redeem booking (H+N hari); null = kebijakan belum diisi. */
  booking_forfeit_days: number | null;
  /** EPIC-031: kuota harian venue (per orang); null = unlimited. */
  daily_capacity: number | null;
  /** EPIC-031 D: toleransi jam masuk slot saat redeem (menit). */
  slot_grace_minutes: number;
  updated_at: string;
}

export interface SettingsFormValues {
  re_entry_policy?: ReEntryPolicy;
  default_credit_limit?: number;
  default_payment_mode?: PaymentMode;
  booking_slug?: string | null;
  booking_forfeit_days?: number | null;
  daily_capacity?: number | null;
  slot_grace_minutes?: number;
}

/** EPIC-031: override kapasitas per rentang tanggal (0 = tanggal tutup). */
export interface CapacityDate {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CapacityDateFormValues {
  label: string;
  start_date: string;
  end_date: string;
  capacity: number;
}

/** EPIC-031 D: template slot waktu timed-entry (level venue). */
export interface TimeSlot {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  /** null = tanpa batas per-slot (jendela jam saja). */
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeSlotFormValues {
  label: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
}
