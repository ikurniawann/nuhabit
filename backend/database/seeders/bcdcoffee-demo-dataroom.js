#!/usr/bin/env node
/**
 * Seeder demo Dataroom BCD Coffee: struktur folder + dokumen contoh.
 *
 * Modul ini belum punya seeder sama sekali. Yang dibuat hanya METADATA node
 * (dataroom.nodes) — berkas fisiknya tidak diunggah, jadi dokumen demo tampil
 * di pohon folder tapi tidak bisa diunduh. Itu disengaja: seeder tidak boleh
 * mengarang isi dokumen perusahaan.
 *
 * Idempotent: node dikenali lewat kombinasi (parent, nama).
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-dataroom.js
 *   npm run db:seed:bcdcoffee-dataroom
 */

const { runSeeder, anyAdmin } = require("./lib/bcdcoffee-demo");

/**
 * Pohon folder. Tiap simpul: { name, children?, docs? }
 * docs: [nama_berkas, mime, ukuran_byte]
 */
const TREE = [
  {
    name: "Legal & Perizinan",
    docs: [
      ["Akta Pendirian BCD Coffee.pdf", "application/pdf", 1_842_000],
      ["NIB & Izin Usaha.pdf", "application/pdf", 962_000],
      ["Sertifikat Halal.pdf", "application/pdf", 1_120_000],
    ],
  },
  {
    name: "Keuangan",
    children: [
      { name: "Laporan Bulanan", docs: [["Laporan Laba Rugi.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 248_000]] },
      { name: "Pajak", docs: [["Bukti Setor PPh Final.pdf", "application/pdf", 410_000]] },
    ],
  },
  {
    name: "Operasional",
    children: [
      {
        name: "SOP",
        docs: [
          ["SOP Barista - Standar Espresso.pdf", "application/pdf", 780_000],
          ["SOP Kebersihan Area Kerja.pdf", "application/pdf", 640_000],
          ["SOP Opening & Closing.pdf", "application/pdf", 705_000],
        ],
      },
      { name: "Resep & Takaran", docs: [["Buku Resep Signature BCD.pdf", "application/pdf", 2_340_000]] },
      { name: "Maintenance Mesin", docs: [["Jadwal Servis Espresso Machine.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 96_000]] },
    ],
  },
  {
    name: "SDM",
    children: [
      { name: "Template Kontrak", docs: [["Template PKWT.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 142_000], ["Template PKWTT.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 138_000]] },
      { name: "Peraturan Perusahaan", docs: [["Peraturan Perusahaan 2026.pdf", "application/pdf", 1_560_000]] },
    ],
  },
  {
    name: "Marketing",
    children: [
      { name: "Brand Guideline", docs: [["BCD Coffee Brand Guideline.pdf", "application/pdf", 5_120_000]] },
      { name: "Materi Promosi", docs: [["Konten Feed Instagram.zip", "application/zip", 12_400_000]] },
    ],
  },
  {
    name: "Pengadaan",
    docs: [
      ["Daftar Supplier Terverifikasi.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 118_000],
      ["Template Purchase Order.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 88_000],
    ],
  },
];

async function upsertNode(c, { parentId, kind, name, mime, size, admin }) {
  const { rows: found } = await c.query(
    `SELECT id FROM dataroom.nodes
     WHERE name = $1 AND kind = $2
       AND ((parent_id IS NULL AND $3::uuid IS NULL) OR parent_id = $3)
     LIMIT 1`,
    [name, kind, parentId]
  );
  if (found[0]) {
    await c.query(
      `UPDATE dataroom.nodes SET mime = $2, size_bytes = $3, updated_at = NOW() WHERE id = $1`,
      [found[0].id, mime, size]
    );
    return found[0].id;
  }
  const { rows } = await c.query(
    `INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [parentId, kind, name, mime, size, admin?.id ?? null, admin?.full_name ?? "Seeder"]
  );
  return rows[0].id;
}

runSeeder("Seeding demo Dataroom", async (c, scope) => {
  void scope;
  const admin = await anyAdmin(c);
  let folders = 0;
  let docs = 0;

  async function walk(nodes, parentId, depth) {
    for (const node of nodes) {
      const folderId = await upsertNode(c, {
        // size_bytes NOT NULL: folder memakai 0, bukan null.
        parentId, kind: "folder", name: node.name, mime: null, size: 0, admin,
      });
      folders += 1;
      console.log(`  ${"  ".repeat(depth)}📁 ${node.name}`);
      for (const [fileName, mime, size] of node.docs ?? []) {
        await upsertNode(c, { parentId: folderId, kind: "file", name: fileName, mime, size, admin });
        docs += 1;
        console.log(`  ${"  ".repeat(depth + 1)}📄 ${fileName}`);
      }
      if (node.children) await walk(node.children, folderId, depth + 1);
    }
  }

  await walk(TREE, null, 0);
  console.log(
    "\n  Catatan: metadata saja — berkas fisik tidak diunggah, jadi dokumen demo tidak bisa diunduh."
  );
  return { folder: folders, dokumen: docs };
});
