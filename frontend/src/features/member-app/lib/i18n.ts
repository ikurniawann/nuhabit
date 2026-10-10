"use client";

import { useCallback } from "react";
import { useLang } from "./lang";
import { AUTH_ID } from "./i18n-auth";
import { CLASSES_ID } from "./i18n-classes";
import { HOME_ID } from "./i18n-home";
import { LOYALTY_ID } from "./i18n-loyalty";
import { TRAIN_ID } from "./i18n-train";
import { ID_WORKOUT } from "./i18n-workout";

/**
 * i18n aplikasi member (port 1:1 apps/member/src/lib/i18n.ts NüHabit): teks
 * Inggris adalah kunci, kamus ID menerjemahkannya. Bahasa mengikuti pilihan
 * portal member (default English); kunci tanpa terjemahan tampil apa adanya.
 */
const BASE_ID: Record<string, string> = {
  // Navigation & chrome
  Home: 'Beranda',
  Classes: 'Kelas',
  Train: 'Latihan',
  Profile: 'Profil',
  Notifications: 'Notifikasi',
  'Mark all read': 'Tandai semua dibaca',
  Back: 'Kembali',
  Save: 'Simpan',
  Cancel: 'Batal',
  // Home
  'Credit balance': 'Saldo kredit',
  'Check in': 'Check in',
  'Book a class': 'Pesan kelas',
  Workout: 'Workout',
  Races: 'Race',
  Upcoming: 'Mendatang',
  'All bookings': 'Semua pesanan',
  'Nothing booked yet.': 'Belum ada pesanan.',
  'Browse the schedule →': 'Lihat jadwal →',
  'Low balance - top up now': 'Saldo rendah - isi ulang sekarang',
  'expiring soon': 'segera hangus',
  Promos: 'Promo',
  Announcements: 'Pengumuman',
  'Today at the studio': 'Hari ini di studio',
  'Tomorrow at the studio': 'Besok di studio',
  Schedule: 'Jadwal',
  Booked: 'Dipesan',
  left: 'tersisa',
  'Full · WL': 'Penuh · DT',
  Until: 'Sampai',
  'new members': 'member baru',
  'Use it': 'Pakai',
  'Race day': 'Hari race',
  'Next race near you': 'Race terdekat untukmu',
  'days away': 'hari lagi',
  'Add to my races': 'Tambah ke race saya',
  // Classes & bookings
  'My bookings': 'Pesanan saya',
  upcoming: 'mendatang',
  history: 'riwayat',
  'All branches': 'Semua cabang',
  'No more classes this day.': 'Tidak ada kelas lagi hari ini.',
  'Book this class': 'Pesan kelas ini',
  'Join waitlist': 'Masuk daftar tunggu',
  'Cancel booking': 'Batalkan pesanan',
  'Leave waitlist': 'Keluar daftar tunggu',
  'Confirm spot': 'Konfirmasi slot',
  'A spot opened up - confirm it before someone else takes it.':
    'Ada slot kosong - konfirmasi sebelum diambil orang lain.',
  // Wallet
  Wallet: 'Dompet',
  'Top up credits': 'Isi ulang kredit',
  'Transaction history': 'Riwayat transaksi',
  'Top up': 'Isi ulang',
  Checkout: 'Bayar',
  'Payment method': 'Metode pembayaran',
  'Voucher code': 'Kode voucher',
  Apply: 'Pakai',
  Total: 'Total',
  // QR
  'Gate access': 'Akses gerbang',
  'Show this at the scanner': 'Tunjukkan di pemindai',
  'Visit history': 'Riwayat kunjungan',
  'Code refreshes automatically.': 'Kode diperbarui otomatis.',
  Balance: 'Saldo',
  credits: 'kredit',
  // Profile & settings
  Settings: 'Pengaturan',
  'Emergency contact': 'Kontak darurat',
  'Wallet & credits': 'Dompet & kredit',
  'Balance, top up, history': 'Saldo, isi ulang, riwayat',
  'Units, reminders': 'Satuan, pengingat',
  'Not set - add one': 'Belum diatur - tambahkan',
  'Personal information': 'Informasi pribadi',
  'Digital waiver': 'Waiver digital',
  'Member since': 'Member sejak',
  'Edit contact info': 'Ubah kontak',
  'Sign out': 'Keluar',
  Units: 'Satuan',
  Kilometers: 'Kilometer',
  Miles: 'Mil',
  Language: 'Bahasa',
  'Booking reminders': 'Pengingat kelas',
  'Get notified before a booked class starts': 'Dapatkan notifikasi sebelum kelas dimulai',
  'Contact name': 'Nama kontak',
  'Contact phone': 'Telepon kontak',
  Relationship: 'Hubungan',
  'Save contact': 'Simpan kontak',
  // Train
  Feed: 'Feed',
  Record: 'Rekam',
  You: 'Kamu',
  Explore: 'Jelajah',
  Everyone: 'Semua',
  Following: 'Diikuti',
  Distance: 'Jarak',
  Pace: 'Pace',
  Speed: 'Kecepatan',
  Time: 'Waktu',
  'This week': 'Minggu ini',
  'Start': 'Mulai',
  Pause: 'Jeda',
  Resume: 'Lanjut',
  Finish: 'Selesai',
  'Save activity': 'Simpan aktivitas',
  Discard: 'Buang',
  Title: 'Judul',
  Description: 'Deskripsi',
  Gear: 'Perlengkapan',
  'Who can see this': 'Siapa yang bisa melihat',
  Routes: 'Rute',
  Segments: 'Segment',
  Challenges: 'Tantangan',
  Clubs: 'Klub',
  Athletes: 'Atlet',
  Heatmap: 'Heatmap',
  // Workout & races
  'Generate workout': 'Buat workout',
  'Workout generator': 'Generator workout',
  Division: 'Divisi',
  Generate: 'Buat',
  Preview: 'Pratinjau',
  'Start workout': 'Mulai workout',
  'Complete block': 'Selesaikan blok',
  'Stop & save': 'Berhenti & simpan',
  'My races': 'Race saya',
  'Enter result': 'Masukkan hasil',
  'Run simulation': 'Jalankan simulasi',
  Goal: 'Target',
  Prediction: 'Prediksi',
  Readiness: 'Kesiapan',
};

export const ID: Record<string, string> = {
  ...LOYALTY_ID,
  ...TRAIN_ID,
  ...BASE_ID,
  ...HOME_ID,
  ...CLASSES_ID,
  ...ID_WORKOUT,
  ...AUTH_ID,
};

/** Isi placeholder `{name}` pada teks yang sudah diterjemahkan; yang tak berisi dibiarkan. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function useT(): T {
  const lang = useLang();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const text = lang === "id" ? (ID[key] ?? key) : key;
      return vars ? fill(text, vars) : text;
    },
    [lang]
  );
}
