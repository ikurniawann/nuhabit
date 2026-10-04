import type { DesktopOverview } from "./overview";

/**
 * Notifikasi aktivitas desktop (EPIC-019).
 *
 * Sumbernya polling overview 60 detik: dua snapshot dibandingkan, dan setiap
 * KENAIKAN melahirkan notifikasi popup ("2 pesanan baru", "pengajuan cuti
 * baru"). Snapshot pertama juga melahirkan notifikasi untuk hal yang sudah
 * menunggu — owner yang baru membuka desktop tetap perlu tahu ada 3 cuti
 * menunggu, meski kejadiannya kemarin.
 *
 * Murni dan tanpa I/O supaya bisa diuji: masuk (prev, next) → keluar daftar.
 */

export interface ActivityNotification {
  id: string;
  text: string;
  href: string;
  at: string;
}

let seq = 0;
function makeId(key: string): string {
  // Date.now saja bisa tabrakan saat beberapa notifikasi lahir se-milidetik.
  seq += 1;
  return `${key}-${Date.now()}-${seq}`;
}

type Rule = {
  key: string;
  href: string;
  /** Ambil angka pembanding dari snapshot; null = seksi tidak tersedia. */
  read: (o: DesktopOverview) => number | null;
  /** Teks saat pertama kali dibuka (stok awal). */
  initial: (n: number) => string;
  /** Teks saat angkanya NAIK antar-poll. */
  increase: (delta: number) => string;
};

const RULES: Rule[] = [
  {
    key: "cuti",
    href: "/dashboard/hris/leaves",
    read: (o) => o.perluKeputusan?.cuti ?? null,
    initial: (n) => `${n} pengajuan cuti menunggu keputusan`,
    increase: (d) => `${d} pengajuan cuti baru masuk`,
  },
  {
    key: "lembur",
    href: "/dashboard/hris/overtime",
    read: (o) => o.perluKeputusan?.lembur ?? null,
    initial: (n) => `${n} pengajuan lembur menunggu keputusan`,
    increase: (d) => `${d} pengajuan lembur baru masuk`,
  },
  {
    key: "pinjaman",
    href: "/dashboard/hris/loans",
    read: (o) => o.perluKeputusan?.pinjaman ?? null,
    initial: (n) => `${n} pengajuan pinjaman menunggu keputusan`,
    increase: (d) => `${d} pengajuan pinjaman baru masuk`,
  },
  {
    key: "po",
    href: "/dashboard/purchasing/approval",
    read: (o) => o.perluKeputusan?.poDraft ?? null,
    initial: (n) => `${n} PO draft menunggu approval`,
    increase: (d) => `${d} PO draft baru menunggu approval`,
  },
  {
    key: "kandidat",
    href: "/dashboard/hris/candidates",
    read: (o) => o.perluKeputusan?.kandidatBaru ?? null,
    initial: (n) => `${n} kandidat baru menunggu review`,
    increase: (d) => `${d} kandidat baru melamar`,
  },
  {
    key: "stok",
    href: "/dashboard/inventory/low-stock",
    read: (o) => o.stokMenipis?.jumlah ?? null,
    initial: (n) => `${n} bahan baku di bawah stok minimum`,
    increase: (d) => `${d} bahan baku baru jatuh di bawah minimum`,
  },
  {
    key: "pesanan",
    href: "/dashboard/pos",
    read: (o) => o.pulsaBisnis?.hariIni.pesanan ?? null,
    // Pesanan yang sudah ada saat desktop dibuka bukan berita — hanya kenaikan
    // yang dinotifikasikan.
    initial: () => "",
    increase: (d) => `${d} pesanan baru masuk di POS`,
  },
  {
    key: "member",
    href: "/dashboard/crm/members",
    read: (o) => o.member?.memberBaru7Hari ?? null,
    initial: () => "",
    increase: (d) => `${d} member baru bergabung`,
  },
];

/**
 * Bandingkan dua snapshot → notifikasi baru.
 * prev null = snapshot pertama (initial); angka TURUN tidak bersuara —
 * berkurangnya antrean adalah hasil kerja, bukan berita.
 */
export function diffOverviewNotifications(
  prev: DesktopOverview | null,
  next: DesktopOverview
): ActivityNotification[] {
  const out: ActivityNotification[] = [];
  const at = next.dibuatPada;

  for (const rule of RULES) {
    const now = rule.read(next);
    if (now === null) continue;

    if (!prev) {
      if (now > 0) {
        const text = rule.initial(now);
        if (text) out.push({ id: makeId(rule.key), text, href: rule.href, at });
      }
      continue;
    }

    const before = rule.read(prev);
    if (before === null) continue; // seksi sempat gagal: jangan mengarang delta
    if (now > before) {
      out.push({ id: makeId(rule.key), text: rule.increase(now - before), href: rule.href, at });
    }
  }

  return out;
}

/** Batas riwayat di Notification Center — sesi panjang tidak menumpuk memori. */
export const MAX_NOTIFICATION_HISTORY = 30;
