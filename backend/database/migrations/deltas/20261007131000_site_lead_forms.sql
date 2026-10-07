-- Public site lead forms as CRM forms, so the form builder, UTM capture,
-- honeypot and rate limits apply. Idempotent by slug: staff edits survive
-- a re-run. first_name and last_name are joined into the lead's pic_name;
-- pic_email, pic_phone and notes land on the lead columns.
INSERT INTO crm.crm_forms (slug, name, title, description, default_source, lead_temperature, submit_label, success_message, fields)
VALUES
  ('franchise', 'Buka Cabang', 'Buka cabang NüHabit di kota Anda',
   'Ceritakan rencana Anda. Tim pengembangan cabang menghubungi dalam dua hari kerja.',
   'website', 'panas', 'Kirim pengajuan', 'Terima kasih! Tim pengembangan cabang akan menghubungi Anda dalam dua hari kerja.',
   '[
     {"key":"first_name","label":"Nama depan","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"last_name","label":"Nama belakang","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"nama@email.com","help_text":null,"options":[],"width":1},
     {"key":"pic_phone","label":"Nomor WhatsApp","type":"phone","required":true,"placeholder":"cth. 08123456789","help_text":null,"options":[],"width":1},
     {"key":"country","label":"Negara domisili","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Indonesia","Malaysia","Singapura","Australia","Lainnya"],"width":1},
     {"key":"origin_country","label":"Negara asal","type":"select","required":false,"placeholder":null,"help_text":null,"options":["Indonesia","Malaysia","Singapura","Australia","Lainnya"],"width":1},
     {"key":"state","label":"Provinsi","type":"text","required":false,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"city","label":"Kota","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"postal_code","label":"Kode pos","type":"text","required":false,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"instagram_handle","label":"Instagram","type":"text","required":false,"placeholder":"@namaakun","help_text":null,"options":[],"width":1},
     {"key":"region_of_interest","label":"Wilayah yang diminati untuk cabang","type":"text","required":true,"placeholder":"cth. Jakarta Selatan","help_text":null,"options":[],"width":2},
     {"key":"source","label":"Tahu NüHabit dari","type":"select","required":false,"placeholder":null,"help_text":null,"options":["Instagram","Google","Teman atau keluarga","Member NüHabit","Event","Lainnya"],"width":1},
     {"key":"situation","label":"Situasi Anda saat ini","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Pemilik gym","Pelatih atau atlet","Pengusaha bidang lain","Investor","Lainnya"],"width":1},
     {"key":"has_business_experience","label":"Pengalaman usaha","type":"checkbox","required":false,"placeholder":null,"help_text":"Saya pernah menjalankan usaha sendiri","options":[],"width":1},
     {"key":"has_fitness_background","label":"Latar belakang fitness","type":"checkbox","required":false,"placeholder":null,"help_text":"Saya punya latar belakang fitness atau olahraga","options":[],"width":1},
     {"key":"liquid_capital","label":"Modal likuid yang tersedia","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Di bawah Rp150 juta","Rp150 sampai 300 juta","Rp300 juta ke atas"],"width":1},
     {"key":"timeline","label":"Target pembukaan","type":"select","required":true,"placeholder":null,"help_text":null,"options":["0 sampai 6 bulan","6 sampai 12 bulan","Lebih dari 12 bulan","Masih menjajaki"],"width":1},
     {"key":"notes","label":"Ceritakan rencana Anda","type":"textarea","required":false,"placeholder":"Lokasi yang sudah dilirik, pengalaman, pertanyaan","help_text":null,"options":[],"width":2}
   ]'::jsonb),
  ('equipment', 'Peralatan', 'Tanya soal peralatan',
   'Rak, sled, ski erg, atau paket lengkap untuk gym Anda. Tim kami membalas pada jam kerja.',
   'website', 'hangat', 'Kirim', 'Terima kasih! Tim peralatan akan menghubungi Anda.',
   '[
     {"key":"pic_name","label":"Nama","type":"text","required":true,"placeholder":"cth. Budi Santoso","help_text":null,"options":[],"width":1},
     {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"nama@email.com","help_text":null,"options":[],"width":1},
     {"key":"pic_phone","label":"Nomor WhatsApp","type":"phone","required":true,"placeholder":"cth. 08123456789","help_text":null,"options":[],"width":2},
     {"key":"notes","label":"Pesan","type":"textarea","required":true,"placeholder":"Peralatan apa yang Anda cari, dan untuk ruang seberapa besar?","help_text":null,"options":[],"width":2}
   ]'::jsonb),
  ('contact', 'Kontak', 'Hubungi kami',
   'Pertanyaan soal kelas, pesanan apparel, atau hal lain. Kami membalas lewat email pada jam kerja.',
   'website', 'hangat', 'Kirim', 'Terima kasih! Kami membalas lewat email pada jam kerja.',
   '[
     {"key":"pic_name","label":"Nama","type":"text","required":true,"placeholder":"cth. Budi Santoso","help_text":null,"options":[],"width":1},
     {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"nama@email.com","help_text":null,"options":[],"width":1},
     {"key":"order_number","label":"Nomor pesanan (opsional)","type":"text","required":false,"placeholder":"cth. NH-2026-0001","help_text":"Isi bila pesan Anda soal pesanan apparel.","options":[],"width":2},
     {"key":"notes","label":"Pesan","type":"textarea","required":true,"placeholder":null,"help_text":null,"options":[],"width":2}
   ]'::jsonb)
ON CONFLICT (slug) DO NOTHING;
