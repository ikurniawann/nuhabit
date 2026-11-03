import { ESS_HOME_PATH, isEssPath, isPathAllowedByMenus } from "@/lib/iam/access";

export interface GuideTopic {
  title: string;
  /** Page the topic is about; a topic without one applies to every account. */
  href?: string;
  steps: string[];
}

/** Each button and field name here matches the label on the page it describes. */
export const GUIDE_TOPICS: GuideTopic[] = [
  {
    title: "Quick search",
    steps: [
      "Tekan ⌘K atau Ctrl+K dari halaman mana pun. Di HP, ketuk ikon kaca pembesar di header.",
      "Ketik nama halaman, member, transaksi, produk, karyawan, atau dokumen. Data hanya muncul dari modul yang boleh Anda buka.",
      "Pilih dengan panah atas dan bawah, lalu Enter. Esc menutup hasil.",
    ],
  },
  {
    title: "Akun, kata sandi, dan tema",
    steps: [
      "Klik nama Anda di header, lalu pilih Ganti kata sandi atau Keluar.",
      "Di layar lebar, ikon tema di header berganti antara Terang, Gelap, dan Auto setiap kali diklik.",
    ],
  },
  {
    title: "Notifikasi",
    steps: ["Klik ikon lonceng di header untuk melihat notifikasi.", "Tandai semua menandai seluruh notifikasi sudah dibaca."],
  },
  {
    title: "Absen dan cuti",
    href: ESS_HOME_PATH,
    steps: [
      "Buka Area Karyawan, lalu tekan Clock In saat mulai dan Clock Out saat selesai.",
      "Ambil selfie dengan Ambil Foto, lalu tekan Gunakan Foto Ini.",
      "Untuk izin atau cuti, buka Izin & Cuti, tekan Ajukan Izin / Cuti, isi formnya, lalu tekan Kirim Pengajuan.",
    ],
  },
  {
    title: "Tugas Saya",
    href: "/dashboard/tasks",
    steps: [
      "Ketik tugas di kotak tambah tugas, lalu tekan Tambah. Kotak ini nonaktif kalau akun belum terhubung ke karyawan dan departemen.",
      "Centang baris tugas untuk menyelesaikannya.",
      "Buka tugas untuk mengisi Progres (%) dan menekan Simpan progres, atau menekan Tandai selesai.",
    ],
  },
  {
    title: "Membuat jadwal kelas",
    href: "/dashboard/gym/schedule",
    steps: [
      "Buka Jadwal Kelas, lalu tekan Sesi baru.",
      "Isi jenis kelas, cabang, coach, tanggal, jam mulai, kapasitas, dan biaya kredit.",
      "Tekan Terbitkan agar member bisa booking, atau Simpan draf untuk melanjutkan nanti.",
      "Untuk jadwal mingguan, buka Template Jadwal, tekan Template baru, lalu Generate sekarang.",
    ],
  },
  {
    title: "Peserta dan absensi kelas",
    href: "/dashboard/gym/sessions",
    steps: [
      "Buka Sesi & Absensi, pilih Hari ini, lalu tekan Buka pada kelasnya.",
      "Di bagian Peserta, tekan Check-in atau Tidak hadir untuk tiap member.",
      "Daftarkan member menambah peserta. Tutup sesi mengakhiri kelas.",
    ],
  },
  {
    title: "Check-in di front desk",
    href: "/dashboard/gym/checkin",
    steps: [
      "Buka Check-in, lalu pilih Scan QR, Cari member, atau Drop-in.",
      "Pada Scan QR, pindai QR member lalu tekan Periksa. Hasilnya Masuk atau Ditolak.",
    ],
  },
  {
    title: "Mencari member dan mencatat waiver",
    href: "/dashboard/gym/members",
    steps: [
      "Buka Member, cari dengan nama, nomor HP, email, atau kode member, lalu klik namanya.",
      "Tab di profil menampilkan membership, booking, check-in, pembelian, asesmen, catatan, dan keluhan.",
      "Kalau waiver belum berlaku, buka tab Profil, centang persetujuan setelah member membacanya di depan Anda, lalu tekan Catat waiver.",
    ],
  },
  {
    title: "Menjual paket kredit atau pass",
    href: "/dashboard/gym/credits",
    steps: [
      "Buka Kredit Member, cari member, lalu tekan Jual paket.",
      "Pilih cabang, paket, dan metode bayar. Tambahkan diskon atau kode voucher kalau ada.",
      "Tekan Simpan penjualan.",
      "Pass aktif dikelola dari kartu Pass dengan Aktifkan, Bekukan, atau Perpanjang.",
    ],
  },
  {
    title: "Memproses pesanan toko online",
    href: "/dashboard/shop/orders",
    steps: [
      "Buka Pesanan, lalu klik baris pesanan yang sudah dibayar.",
      "Untuk pengiriman: Tandai Dikemas, lalu Buat Pengiriman (Provider) atau isi resi manual, lalu Tandai Selesai.",
      "Untuk ambil di cabang: Tandai Siap Diambil, lalu Tandai Sudah Diambil.",
      "Batalkan membatalkan pesanan. Refund Xendit tetap dilakukan manual.",
    ],
  },
  {
    title: "Mengatur toko online",
    href: "/dashboard/shop/settings",
    steps: [
      "Buka Storefront Settings untuk mengatur ambil di cabang, batas gratis ongkir, nomor WhatsApp toko, dan banner promo.",
      "Tekan Simpan.",
    ],
  },
];

/** The topics this account can act on, given the pages its menus open. */
export function visibleTopics(menuHrefs: readonly string[]): GuideTopic[] {
  return GUIDE_TOPICS.filter(
    (topic) => !topic.href || isEssPath(topic.href) || isPathAllowedByMenus(topic.href, menuHrefs)
  );
}
