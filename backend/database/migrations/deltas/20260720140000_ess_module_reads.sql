-- EPIC-007 lanjutan — penanda "sudah dilihat" untuk badge notifikasi ESS.
--
-- Badge sisi admin cukup menghitung pengajuan berstatus 'pending', tetapi sisi
-- karyawan perlu tahu apa yang BERUBAH sejak terakhir ia membuka halaman.
-- Satu baris per (karyawan, modul) sudah memadai: membuka halaman menandai
-- seluruh modul terbaca, dan badge muncul lagi saat ada keputusan berikutnya.
-- Penanda per baris pengajuan sengaja dihindari karena jauh lebih berat tanpa
-- memberi perbedaan yang terasa bagi pengguna.

CREATE TABLE IF NOT EXISTS hris.ess_module_reads (
  employee_id  uuid        NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  module       text        NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, module),
  CONSTRAINT ess_module_reads_module_check
    CHECK (module = ANY (ARRAY['leaves', 'overtime', 'loans']))
);

COMMENT ON TABLE hris.ess_module_reads IS
  'Kapan karyawan terakhir membuka halaman ESS sebuah modul pengajuan. Dipakai badge notifikasi: pengajuan miliknya dengan updated_at > last_seen_at dihitung sebagai pembaruan yang belum dilihat.';
COMMENT ON COLUMN hris.ess_module_reads.module IS
  'Modul pengajuan: leaves (izin & cuti), overtime (lembur), loans (pinjaman).';
