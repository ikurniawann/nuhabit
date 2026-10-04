-- Sub-menu Settings → WhatsApp Gateway: status koneksi + QR pairing nomor
-- pengirim OTP portal member. QR = kredensial sesi WhatsApp, jadi menu (dan
-- API-nya) hanya di-grant ke super_admin.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('settings.wa_gateway', 'WhatsApp Gateway', '/dashboard/settings/wa-gateway',
        'settings', 'sidebar', 12, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'settings', level = 2 WHERE code = 'settings.wa_gateway';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'settings.wa_gateway' AND parent.code = 'settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin' AND m.code = 'settings.wa_gateway'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
