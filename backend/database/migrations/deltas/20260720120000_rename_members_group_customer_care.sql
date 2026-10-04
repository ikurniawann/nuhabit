-- Grup CRM → "Members" diubah jadi "Customer Care".
--
-- Grup ini kini menampung Inbox WhatsApp (EPIC-012) dan Google Review
-- (EPIC-013) di samping daftar member — isinya sudah menjadi pusat layanan
-- pelanggan, bukan sekadar daftar member. Kode menu (`crm.members*`) sengaja
-- TIDAK diubah agar seluruh grant peran & referensi existing tetap utuh;
-- yang berubah hanya label yang dilihat pengguna.
UPDATE iam.menus
   SET menu_name = 'Customer Care', updated_at = now()
 WHERE code = 'crm.members' AND menu_type = 'group';

-- Item daftar member di dalamnya tetap bernama "Members" (itu memang daftar
-- member), jadi tidak disentuh.
