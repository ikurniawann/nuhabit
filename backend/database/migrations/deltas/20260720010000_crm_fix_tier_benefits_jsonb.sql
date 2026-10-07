-- EPIC-011 fix pasca-UAT: kolom benefits di crm_membership_tiers tersimpan
-- sebagai objek '{}' (bukan array '[]') karena API tiers mengirim array JS
-- mentah ke jsonb — driver pg menserialisasinya jadi literal array Postgres.
-- Route sudah diperbaiki (JSON.stringify); normalisasi data existing di sini.

UPDATE crm.crm_membership_tiers
SET benefits = '[]'::jsonb
WHERE jsonb_typeof(benefits) <> 'array';
