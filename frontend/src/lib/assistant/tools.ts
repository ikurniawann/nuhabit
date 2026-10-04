import { query } from "@/lib/db";

/**
 * Tool baca untuk Do (EPIC-017 Fase D).
 *
 * Prinsip yang tidak boleh dilanggar:
 * 1. **Tidak ada SQL bebas dari model.** Model hanya memilih nama tool dan
 *    mengisi argumen; SQL-nya ditulis di sini dan selalu parameterized.
 * 2. **Read-only.** Tidak ada INSERT/UPDATE/DELETE di fase ini — aksi menulis
 *    adalah Fase E dan wajib lewat konfirmasi user.
 * 3. **Berbatas.** Setiap query punya LIMIT; model tidak bisa meminta 100 ribu baris.
 */

export const TOOL_ROW_LIMIT = 25;

export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Ambil string aman dari argumen model (yang bisa saja mengirim tipe aneh). */
function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function argInt(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** YYYY-MM-DD saja; format lain ditolak agar tidak bocor ke query. */
function argDate(args: Record<string, unknown>, key: string): string | null {
  const value = argString(args, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function todayJakarta(): string {
  // Operasional perusahaan memakai WIB; tanggal server belum tentu sama.
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: "cari_karyawan",
    description:
      "Cari karyawan berdasarkan sebagian nama atau NIP. Mengembalikan nama, NIP, jabatan, departemen, status aktif, dan tanggal bergabung.",
    parameters: {
      type: "object",
      properties: {
        nama: { type: "string", description: "Sebagian nama atau NIP karyawan" },
      },
      required: ["nama"],
    },
    run: async (args) => {
      const keyword = argString(args, "nama");
      if (!keyword) return { error: "Nama tidak boleh kosong" };
      const rows = await query(
        `SELECT e.full_name, e.nip, e.employment_status, e.is_active,
                e.join_date::text AS join_date,
                d.name AS departemen
           FROM hris.employees e
           LEFT JOIN hris.departments d ON d.id = e.department_id
          WHERE e.full_name ILIKE $1 OR e.nip ILIKE $1
          ORDER BY e.is_active DESC, e.full_name
          LIMIT $2`,
        [`%${keyword}%`, TOOL_ROW_LIMIT]
      );
      return { jumlah: rows.length, karyawan: rows };
    },
  },
  {
    name: "absensi_hari_ini",
    description:
      "Ringkasan kehadiran pada satu tanggal: berapa yang sudah absen, terlambat, dan daftar karyawan aktif yang belum absen. Tanpa argumen berarti hari ini.",
    parameters: {
      type: "object",
      properties: {
        tanggal: { type: "string", description: "Tanggal YYYY-MM-DD; kosongkan untuk hari ini" },
      },
    },
    run: async (args) => {
      const date = argDate(args, "tanggal") ?? todayJakarta();
      const [ringkasan] = await query(
        `SELECT count(*)::int AS sudah_absen,
                count(*) FILTER (WHERE is_late)::int AS terlambat
           FROM hris.attendance
          WHERE date = $1::date`,
        [date]
      );
      const belum = await query(
        `SELECT e.full_name, e.nip
           FROM hris.employees e
          WHERE e.is_active
            AND NOT EXISTS (
              SELECT 1 FROM hris.attendance a
               WHERE a.employee_id = e.id AND a.date = $1::date
            )
          ORDER BY e.full_name
          LIMIT $2`,
        [date, TOOL_ROW_LIMIT]
      );
      return {
        tanggal: date,
        sudah_absen: ringkasan?.sudah_absen ?? 0,
        terlambat: ringkasan?.terlambat ?? 0,
        belum_absen_jumlah: belum.length,
        belum_absen: belum,
        catatan:
          belum.length === TOOL_ROW_LIMIT
            ? `Daftar dipotong di ${TOOL_ROW_LIMIT} nama pertama`
            : undefined,
      };
    },
  },
  {
    name: "stok_menipis",
    description:
      "Daftar bahan baku yang stok tersedianya sudah di bawah atau sama dengan batas minimum, beserta jumlah yang sedang dipesan.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = await query(
        `SELECT rm.nama AS bahan, rm.kode,
                i.qty_available::float AS tersedia,
                i.qty_minimum::float AS minimum,
                i.qty_on_order::float AS sedang_dipesan
           FROM inventory.inventory i
           JOIN item.raw_materials rm ON rm.id = i.raw_material_id
          WHERE i.is_active
            AND rm.deleted_at IS NULL
            AND i.qty_available <= i.qty_minimum
          ORDER BY (i.qty_minimum - i.qty_available) DESC
          LIMIT $1`,
        [TOOL_ROW_LIMIT]
      );
      return { jumlah: rows.length, bahan: rows };
    },
  },
  {
    name: "penjualan_periode",
    description:
      "Ringkasan penjualan POS pada rentang tanggal: jumlah pesanan, total omzet, dan rata-rata per pesanan. Hanya menghitung pesanan yang tidak dibatalkan.",
    parameters: {
      type: "object",
      properties: {
        dari: { type: "string", description: "Tanggal mulai YYYY-MM-DD" },
        sampai: { type: "string", description: "Tanggal akhir YYYY-MM-DD" },
      },
    },
    run: async (args) => {
      const dari = argDate(args, "dari") ?? todayJakarta();
      const sampai = argDate(args, "sampai") ?? dari;
      // Definisi omzet tunggal (keputusan owner 2026-08-19): uang yang sudah
      // dibayar. Sama persis dengan widget Ringkasan Transaksi & Laporan Profit —
      // owner tidak boleh mendapat dua angka berbeda untuk pertanyaan yang
      // sama. Sebelumnya di sini order belum dibayar ikut terhitung.
      const [row] = await query(
        `SELECT count(*)::int AS jumlah_pesanan,
                COALESCE(sum(total_amount), 0)::float AS total_omzet,
                COALESCE(avg(total_amount), 0)::float AS rata_rata
           FROM pos.pos_orders
          WHERE COALESCE(ordered_at, created_at) >= $1::date
            AND COALESCE(ordered_at, created_at) < ($2::date + interval '1 day')
            AND payment_status = 'paid'
            AND status::text NOT IN ('cancelled', 'voided', 'merged')`,
        [dari, sampai]
      );
      return { dari, sampai, ...row };
    },
  },
  {
    name: "status_kandidat",
    description:
      "Cari kandidat rekrutmen berdasarkan nama, atau tampilkan kandidat terbaru bila nama dikosongkan. Mengembalikan status pipeline dan sumber lamaran.",
    parameters: {
      type: "object",
      properties: {
        nama: { type: "string", description: "Sebagian nama kandidat; boleh dikosongkan" },
        batas: { type: "number", description: "Jumlah baris maksimum (default 10)" },
      },
    },
    run: async (args) => {
      const keyword = argString(args, "nama");
      const limit = Math.min(Math.max(argInt(args, "batas", 10), 1), TOOL_ROW_LIMIT);
      const rows = keyword
        ? await query(
            `SELECT full_name, status, source, domicile, created_at::text
               FROM recruitment.candidates
              WHERE full_name ILIKE $1
              ORDER BY created_at DESC
              LIMIT $2`,
            [`%${keyword}%`, limit]
          )
        : await query(
            `SELECT full_name, status, source, domicile, created_at::text
               FROM recruitment.candidates
              ORDER BY created_at DESC
              LIMIT $1`,
            [limit]
          );
      return { jumlah: rows.length, kandidat: rows };
    },
  },
];

/** Bentuk yang dikirim ke OpenAI sebagai daftar function. */
export function toolDefinitions() {
  return ASSISTANT_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Jalankan satu tool. Nama yang tidak dikenal dan error eksekusi dikembalikan
 * sebagai data biasa supaya model bisa menjelaskannya ke user — bukan
 * melemparkan exception yang menggagalkan seluruh percakapan.
 */
export async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = ASSISTANT_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Tool tidak dikenal: ${name}` };
  try {
    return await tool.run(args);
  } catch (error) {
    console.error(`[do:tool] ${name} gagal:`, error);
    return { error: "Data gagal diambil dari sistem" };
  }
}

/** Argumen dari model datang sebagai string JSON; rusak = objek kosong. */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    // Array juga bertipe "object" — tetapi argumen tool selalu objek bernama,
    // jadi array (atau null) diperlakukan sebagai argumen kosong.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
