-- EPIC-023 — keputusan owner 2026-07-22: petugas loket (pos /
-- pos_supervisor) boleh MEMBANTU pengunjung di menu Booking — lihat
-- daftar/rincian & kirim ulang WA kode booking. Aksi ber-uang
-- (batalkan, catatan refund, tutup alert webhook) TETAP super_admin —
-- ditegakkan di server, menu hanya read bagi loket.

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('pos', 'pos_supervisor') AND m.code = 'ticketing.booking'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
