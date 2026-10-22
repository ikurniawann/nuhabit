-- EPIC-067 T-067-B5 — Keluhan masuk ke KPI coach.
--   • Indikator otomatis coach_complaint_rate: keluhan (kind 'complaint', bukan
--     dibatalkan) yang tertaut ke coach / 100 peserta hadir di sesi coach itu
--     dalam periode. Makin rendah makin baik; target default 1 keluhan per 100
--     peserta. Karyawan yang bukan coach (tidak tertaut studio.coaches) atau
--     tanpa peserta di periode itu tidak punya data → indikator dikeluarkan dari
--     skornya dan bobot dibagi ulang (aturan composeScore), jadi skor staf lain
--     tidak berubah.
--   • Ditambahkan ke scorecard role 'employee' (coach memakai role ini) dengan
--     bobot 15; bisa diubah / dipindah ke konfigurasi departemen di menu KPI.

INSERT INTO performance.kpi_indicators (code, name, unit, direction, source_kind, source_ref, default_target, is_active, notes)
VALUES ('coach_complaint_rate', 'Keluhan per 100 Peserta (Coach)', 'rasio', 'lower_better', 'auto', 'studio.complaints', 1, true,
        'keluhan tertaut coach (bukan masukan / dibatalkan) ÷ peserta hadir di sesi coach × 100')
ON CONFLICT (code) DO NOTHING;

INSERT INTO performance.kpi_role_indicators (role_code, indicator_id, weight)
SELECT 'employee', id, 15 FROM performance.kpi_indicators WHERE code = 'coach_complaint_rate'
ON CONFLICT (role_code, indicator_id) DO NOTHING;
