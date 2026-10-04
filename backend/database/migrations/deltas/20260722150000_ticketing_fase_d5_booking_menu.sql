-- EPIC-023 Fase D4+D5: menu dashboard "Booking" (kelola booking website:
-- list per tanggal, batalkan, tandai refund manual, kirim ulang WA) +
-- penegakan invarian 1 booking = 1 visit hasil redeem.

-- Satu visit hanya boleh berasal dari satu booking (redeem D4);
-- sekaligus meng-indeks lookup gate tap "visit ini dari booking?".
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_bookings_visit
  ON ticketing.ticket_bookings (visit_id)
  WHERE visit_id IS NOT NULL;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.booking', 'Booking',
        '/dashboard/ticketing/booking', 'ticket', 'sidebar', 8,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2
WHERE code = 'ticketing.booking';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ticketing.booking' AND parent.code = 'ticketing';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin' AND m.code = 'ticketing.booking'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
