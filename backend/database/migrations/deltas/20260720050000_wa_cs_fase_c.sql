-- EPIC-012 Fase C: UI Inbox CS — template balasan cepat + menu sidebar.

-- 1) Template balasan cepat (canned responses) ------------------------------
CREATE TABLE IF NOT EXISTS crm.wa_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_reply_templates_title_len CHECK (char_length(title) BETWEEN 1 AND 80),
  CONSTRAINT wa_reply_templates_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
);

DROP TRIGGER IF EXISTS wa_reply_templates_set_updated_at ON crm.wa_reply_templates;
CREATE TRIGGER wa_reply_templates_set_updated_at
  BEFORE UPDATE ON crm.wa_reply_templates
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();

-- Seed contoh agar UI tidak kosong saat UAT (boleh diedit/hapus dari UI).
INSERT INTO crm.wa_reply_templates (title, body)
SELECT * FROM (VALUES
  ('Salam pembuka',
   'Halo! Terima kasih sudah menghubungi Sulu Wonderland. Ada yang bisa kami bantu?'),
  ('Minta detail komplain',
   'Mohon maaf atas ketidaknyamanannya. Boleh diinformasikan nomor pesanan/tanggal kunjungan dan detail kendalanya agar bisa segera kami cek?'),
  ('Penutup',
   'Terima kasih! Jika masih ada kendala, jangan ragu menghubungi kami kembali. 🙏')
) AS seed(title, body)
WHERE NOT EXISTS (SELECT 1 FROM crm.wa_reply_templates);

-- 2) Menu sidebar: CRM → Members → Inbox WhatsApp ---------------------------
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.members.inbox', 'Inbox WhatsApp', '/dashboard/crm/inbox',
        'clipboard', 'sidebar', 20, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 3 WHERE code = 'crm.members.inbox';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.members.inbox' AND parent.code = 'crm.members';

-- 3) Grant peran CS (keputusan epic: super_admin, admin, pos_supervisor)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'pos_supervisor')
  AND m.code = 'crm.members.inbox'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
