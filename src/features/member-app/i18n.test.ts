import { describe, expect, it } from "vitest";
import { toEnglish } from "./i18n";

describe("toEnglish — pesan server untuk Member App", () => {
  it.each([
    ["Booking dibuka paling cepat 7 hari sebelum kelas", "Booking opens 7 days before class."],
    ["Booking ditutup 30 menit sebelum kelas", "Booking closes 30 minutes before class."],
    ["Kelas penuh, dan belum ada pass dengan kredit kelas untuk tanggal ini", "This class is full, and you don't have class credits for this date."],
    ["Kelas penuh", "This class is full."],
    ["Sudah masuk waitlist di kelas ini", "You're already on the waitlist for this class."],
    ["Sudah terdaftar di kelas ini", "You're already booked into this class."],
    ["Sudah ada booking Hyrox Engine di jam yang sama", "You already have Hyrox Engine booked at the same time."],
    ["Belum ada pass dengan kredit kelas yang berlaku di tanggal ini", "You don't have class credits valid for this date."],
    ["Belum ada pass dengan kredit Personal Training yang berlaku di tanggal ini", "You don't have Personal Training credits valid for this date."],
    ["Akun member ini dinonaktifkan. Silakan hubungi front desk.", "Your membership is currently inactive. Please contact the front desk."],
    ["Slot sudah tidak tersedia — pilih jam lain", "That slot was just taken. Please pick another time."],
    ["Nomor belum terdaftar sebagai member — daftar dulu di kasir venue kami", "This number isn't registered as a member yet. Please sign up at the front desk."],
    ["Kode salah", "That code isn't right. Please try again."],
    ["Kode OTP dikirim ke WhatsApp Anda", "We've sent a code to your WhatsApp."],
    ["Maksimal 3 booking aktif", "You can have up to 3 active bookings."],
  ])("%s", (id, en) => {
    expect(toEnglish(id)).toBe(en);
  });

  it("pesan Inggris dibiarkan, kosong → pesan umum", () => {
    expect(toEnglish("Please sign in to the Member App")).toBe("Please sign in to the Member App");
    expect(toEnglish("")).toBe("Something went wrong. Please try again.");
  });
});
