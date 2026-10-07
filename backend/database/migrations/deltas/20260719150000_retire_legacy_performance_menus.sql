-- EPIC-010: modul KPI Templates & Performance Review lama tidak pernah
-- terpakai (kpi_templates/performance_reviews/feedback_cycles/behavioral
-- semua 0 baris) dan fungsinya digantikan KPI Scorecard. Nonaktifkan
-- menunya; halaman & tabel dibiarkan (reversible, bookmark tidak 404).
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    updated_at = now()
WHERE code IN ('hris.performance.kpi-templates', 'hris.performance.review');
