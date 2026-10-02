/**
 * Member App berbahasa Inggris (keputusan owner 2026-10-02). Mesin booking &
 * login OTP dipakai bersama backoffice yang berbahasa Indonesia, jadi pesan
 * error server diterjemahkan di sisi Member App lewat kamus pola di bawah.
 */

type Rule = [RegExp, string | ((m: RegExpMatchArray) => string)];

const RULES: Rule[] = [
  // Login OTP (portal member)
  [/^Nomor WhatsApp tidak valid/i, "Please enter a valid WhatsApp number."],
  [/^Nomor belum terdaftar sebagai member/i, "This number isn't registered as a member yet. Please sign up at the front desk."],
  [/^Terlalu banyak permintaan/i, "Too many requests. Please try again in 10 minutes."],
  [/^Gagal mengirim OTP/i, "We couldn't send the code. Please try again."],
  [/^Kode OTP dikirim/i, "We've sent a code to your WhatsApp."],
  [/^Nomor\/kode tidak valid/i, "Invalid number or code."],
  [/^Kode kedaluwarsa/i, "This code has expired. Please request a new one."],
  [/^Terlalu banyak percobaan/i, "Too many attempts. Please request a new code."],
  [/^Kode salah/i, "That code isn't right. Please try again."],
  [/^Silakan masuk/i, "Please sign in to continue."],
  // Booking kelas
  [/^Booking dibuka paling cepat (\d+) hari sebelum kelas/i, (m) => `Booking opens ${m[1]} days before class.`],
  [/^Booking ditutup (\d+) menit sebelum kelas/i, (m) => `Booking closes ${m[1]} minutes before class.`],
  [/^Kelas sudah dimulai/i, "This class has already started."],
  [/^Kelas tidak tersedia/i, "This class is no longer available."],
  [/^Kelas tidak ditemukan/i, "Class not found."],
  [/^Kelas penuh, dan belum ada pass/i, "This class is full, and you don't have class credits for this date."],
  [/^Kelas penuh/i, "This class is full."],
  [/^Sudah masuk waitlist/i, "You're already on the waitlist for this class."],
  [/^Sudah terdaftar di kelas ini/i, "You're already booked into this class."],
  [/^Maksimal (\d+) booking aktif/i, (m) => `You can have up to ${m[1]} active bookings.`],
  [/^Sudah ada booking (.+) di jam yang sama/i, (m) => `You already have ${m[1]} booked at the same time.`],
  [/^Belum ada pass dengan kredit kelas/i, "You don't have class credits valid for this date."],
  [/^Belum ada pass dengan kredit Personal Training/i, "You don't have Personal Training credits valid for this date."],
  [/^Booking tidak ditemukan/i, "Booking not found."],
  [/^Kelas sudah diselesaikan/i, "This class has already been completed."],
  [/^Booking ini tidak bisa dibatalkan/i, "This booking can't be cancelled."],
  [/^Akun member ini dinonaktifkan/i, "Your membership is currently inactive. Please contact the front desk."],
  // Personal Training
  [/^Jam tersebut sudah lewat/i, "That time has already passed."],
  [/^Slot sudah tidak tersedia/i, "That slot was just taken. Please pick another time."],
  [/^Program Personal Training tidak ditemukan/i, "Personal Training program not found."],
  [/^Coach tidak ditemukan/i, "Coach not found."],
  [/^Tanggal tidak valid/i, "Invalid date."],
  [/^Jam selesai melewati tengah malam/i, "The session would end after midnight."],
  // Umum
  [/^Data yang sama sudah ada/i, "This already exists."],
  [/^Internal server error/i, "Something went wrong. Please try again."],
  [/^Terjadi kesalahan/i, "Something went wrong. Please try again."],
];

/** Terjemahkan pesan server ke bahasa Inggris; pesan yang sudah Inggris dibiarkan. */
export function toEnglish(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return "Something went wrong. Please try again.";
  for (const [re, out] of RULES) {
    const m = text.match(re);
    if (m) return typeof out === "string" ? out : out(m);
  }
  return text;
}
