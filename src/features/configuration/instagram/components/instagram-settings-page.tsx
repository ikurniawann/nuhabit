"use client";

import { Camera, ExternalLink } from "lucide-react";
import { InstagramConnectPanel } from "./instagram-connect-panel";

/**
 * EPIC-013 Fase C — halaman pengaturan Instagram Messaging.
 *
 * Selain form kredensial, halaman ini memuat urutan langkah di dashboard
 * Meta. Nilai-nilai itu tersebar di beberapa layar Meta dan mudah tertukar
 * (App Secret vs Access Token, Page ID vs Instagram Account ID), jadi
 * panduannya diletakkan berdampingan dengan formnya.
 */

const LANGKAH: { judul: string; detail: string }[] = [
  {
    judul: "Siapkan akun Instagram Professional",
    detail:
      "Akun harus bertipe Business/Creator dan tertaut ke sebuah Halaman Facebook. Instagram pribadi tidak bisa menerima API pesan.",
  },
  {
    judul: "Buat aplikasi di Meta for Developers",
    detail:
      "developers.facebook.com → Create App → tambahkan produk Instagram. Salin App Secret dari Settings → Basic ke form di bawah.",
  },
  {
    judul: "Tentukan Verify Token",
    detail:
      "Nilai bebas yang Anda karang sendiri, misalnya kata sandi acak. Isi di form bawah, lalu tulis nilai yang sama persis saat mendaftarkan webhook di Meta.",
  },
  {
    judul: "Daftarkan webhook",
    detail:
      "Di produk Instagram → Webhooks, tempel Callback URL dari form di bawah beserta Verify Token, lalu berlangganan bidang messages. Meta akan langsung memanggil URL itu untuk verifikasi.",
  },
  {
    judul: "Ambil Access Token & ID Akun",
    detail:
      "Buat token berizin instagram_manage_messages, lalu salin Instagram Business Account ID. Tanpa keduanya pesan tetap bisa masuk, tetapi balasan belum bisa dikirim.",
  },
];

export function InstagramSettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Camera className="size-5 text-pink-600" /> Instagram Messaging
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Hubungkan akun Instagram bisnis agar DM masuk ke Inbox CS dan bisa
          dibalas dari dashboard. Hanya Super Admin yang dapat mengubah
          pengaturan ini.
        </p>
      </header>

      <InstagramConnectPanel />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Langkah di dashboard Meta
        </h2>
        <ol className="mt-3 space-y-3">
          {LANGKAH.map((langkah, index) => (
            <li key={langkah.judul} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {langkah.judul}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {langkah.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <a
          href="https://developers.facebook.com/docs/messenger-platform/instagram"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:underline"
        >
          Dokumentasi resmi Instagram Messaging{" "}
          <ExternalLink className="size-3" />
        </a>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Yang perlu diketahui
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-800">
          <li>
            <strong>Jendela balas 24 jam.</strong> Meta hanya mengizinkan
            balasan dalam 24 jam sejak pesan terakhir pelanggan. Lewat dari itu
            balasan ditolak, dan dashboard akan memberi tahu alasannya sebelum
            Anda mengetik.
          </li>
          <li>
            <strong>Konteks member sengaja kosong.</strong> DM Instagram tidak
            ditautkan ke profil member karena Instagram tidak membawa nomor
            telepon.
          </li>
          <li>
            <strong>Mode development.</strong> Untuk pengujian, aplikasi Meta
            yang masih berstatus development umumnya sudah bisa berkirim pesan
            dengan akun yang punya peran di aplikasi tersebut. App Review baru
            wajib untuk penggunaan publik.
          </li>
        </ul>
      </section>
    </div>
  );
}
