/**
 * Test integrasi tipe data driver pg SUNGGUHAN (pelajaran Fase C: kolom
 * `date` kembali sebagai objek Date lokal — bug yang lolos semua unit test
 * berbasis string). Berjalan hanya bila DATABASE_URL tersedia; membaca
 * nilai literal via SELECT — tidak menyentuh tabel aplikasi.
 */

import { describe, it, expect } from "vitest";
import { config as loadEnv } from "dotenv";
import { dateColToIso } from "./period";

loadEnv({ path: ".env", quiet: true });

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

describe.skipIf(!DB_URL)("pg driver type round-trip", () => {
  it("DATE columns come back as local-midnight Date objects; dateColToIso restores the calendar date", async () => {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: DB_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT DATE '2026-06-16' AS d,
                DATE '2026-01-01' AS newyear,
                DATE '2026-12-31' AS yearend,
                12345678.90::numeric(12,2) AS amount`
      );
      const row = rows[0];

      // Asumsi fondasi loader payroll: kolom date = objek Date, BUKAN string
      expect(row.d).toBeInstanceOf(Date);

      // dateColToIso wajib mengembalikan tanggal kalender tanpa geser
      // timezone (server WIB: toISOString akan salah -1 hari)
      expect(dateColToIso(row.d)).toBe("2026-06-16");
      expect(dateColToIso(row.newyear)).toBe("2026-01-01");
      expect(dateColToIso(row.yearend)).toBe("2026-12-31");

      // numeric kembali sebagai STRING — semua konsumen wajib Number()
      expect(typeof row.amount).toBe("string");
      expect(Number(row.amount)).toBe(12345678.9);
    } finally {
      await client.end();
    }
  });
});
