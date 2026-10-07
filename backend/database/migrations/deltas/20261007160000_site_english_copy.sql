-- The public site speaks English. Rewrites the seeded lead forms
-- (franchise, equipment, contact) and the seeded membership packages
-- from the Indonesian seed copy. Field keys stay the same so stored
-- submissions keep their shape; the form name (staff-facing) is untouched.
-- Idempotent: forms update by slug, packages only while they still carry
-- the seeded Indonesian text.

-- 1. Lead forms ---------------------------------------------------------------

UPDATE crm.crm_forms SET
  title = 'Open a NüHabit in your city',
  description = 'Tell us your plan. The branch development team gets in touch within two business days.',
  submit_label = 'Send application',
  success_message = 'Thank you! The branch development team will contact you within two business days.',
  fields = '[
    {"key":"first_name","label":"First name","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
    {"key":"last_name","label":"Last name","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
    {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"name@email.com","help_text":null,"options":[],"width":1},
    {"key":"pic_phone","label":"WhatsApp number","type":"phone","required":true,"placeholder":"e.g. 08123456789","help_text":null,"options":[],"width":1},
    {"key":"country","label":"Country of residence","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Indonesia","Malaysia","Singapore","Australia","Other"],"width":1},
    {"key":"origin_country","label":"Country of origin","type":"select","required":false,"placeholder":null,"help_text":null,"options":["Indonesia","Malaysia","Singapore","Australia","Other"],"width":1},
    {"key":"state","label":"State or province","type":"text","required":false,"placeholder":null,"help_text":null,"options":[],"width":1},
    {"key":"city","label":"City","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
    {"key":"postal_code","label":"Postcode","type":"text","required":false,"placeholder":null,"help_text":null,"options":[],"width":1},
    {"key":"instagram_handle","label":"Instagram","type":"text","required":false,"placeholder":"@yourhandle","help_text":null,"options":[],"width":1},
    {"key":"region_of_interest","label":"Region you have in mind for a branch","type":"text","required":true,"placeholder":"e.g. South Jakarta","help_text":null,"options":[],"width":2},
    {"key":"source","label":"How did you hear about NüHabit?","type":"select","required":false,"placeholder":null,"help_text":null,"options":["Instagram","Google","Friend or family","NüHabit member","Event","Other"],"width":1},
    {"key":"situation","label":"Your current situation","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Gym owner","Coach or athlete","Business owner in another field","Investor","Other"],"width":1},
    {"key":"has_business_experience","label":"Business experience","type":"checkbox","required":false,"placeholder":null,"help_text":"I have run my own business","options":[],"width":1},
    {"key":"has_fitness_background","label":"Fitness background","type":"checkbox","required":false,"placeholder":null,"help_text":"I have a fitness or sports background","options":[],"width":1},
    {"key":"liquid_capital","label":"Liquid capital available","type":"select","required":true,"placeholder":null,"help_text":null,"options":["Under Rp150 million","Rp150 to 300 million","Rp300 million and above"],"width":1},
    {"key":"timeline","label":"Target opening","type":"select","required":true,"placeholder":null,"help_text":null,"options":["0 to 6 months","6 to 12 months","More than 12 months","Still exploring"],"width":1},
    {"key":"notes","label":"Tell us about your plan","type":"textarea","required":false,"placeholder":"Locations you have in mind, experience, questions","help_text":null,"options":[],"width":2}
  ]'::jsonb
WHERE slug = 'franchise';

UPDATE crm.crm_forms SET
  title = 'Ask about equipment',
  description = 'Rigs, sleds, SkiErgs or a complete package for your gym. Our team replies during business hours.',
  submit_label = 'Send',
  success_message = 'Thank you! The equipment team will be in touch.',
  fields = '[
    {"key":"pic_name","label":"Name","type":"text","required":true,"placeholder":"e.g. Jane Doe","help_text":null,"options":[],"width":1},
    {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"name@email.com","help_text":null,"options":[],"width":1},
    {"key":"pic_phone","label":"WhatsApp number","type":"phone","required":true,"placeholder":"e.g. 08123456789","help_text":null,"options":[],"width":2},
    {"key":"notes","label":"Message","type":"textarea","required":true,"placeholder":"What equipment are you looking for, and for how much space?","help_text":null,"options":[],"width":2}
  ]'::jsonb
WHERE slug = 'equipment';

UPDATE crm.crm_forms SET
  title = 'Get in touch',
  description = 'Questions about classes, apparel orders or anything else. We reply by email during business hours.',
  submit_label = 'Send',
  success_message = 'Thank you! We reply by email during business hours.',
  fields = '[
    {"key":"pic_name","label":"Name","type":"text","required":true,"placeholder":"e.g. Jane Doe","help_text":null,"options":[],"width":1},
    {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":"name@email.com","help_text":null,"options":[],"width":1},
    {"key":"order_number","label":"Order number (optional)","type":"text","required":false,"placeholder":"e.g. NH-2026-0001","help_text":"Fill this in if your message is about an apparel order.","options":[],"width":2},
    {"key":"notes","label":"Message","type":"textarea","required":true,"placeholder":null,"help_text":null,"options":[],"width":2}
  ]'::jsonb
WHERE slug = 'contact';

-- 2. Seeded membership packages (shown on /join and the membership panel) ------

UPDATE gym.credit_packages AS p SET name = v.new_name, description = v.new_description
FROM (VALUES
  ('Pass 4 Minggu', '4-Week Pass', 'Unlimited class bookings for 4 weeks.'),
  ('Pass 8 Minggu', '8-Week Pass', 'Unlimited class bookings for 8 weeks.'),
  ('Pass 6 Bulan', '6-Month Pass', 'Unlimited class bookings for 6 months.'),
  ('Holiday Pass 1 Minggu', '1-Week Holiday Pass', 'Unlimited training for one week, ideal when you are visiting.'),
  ('Trial Class', 'Trial Class', 'One trial class for new members.'),
  ('Starter 5', 'Starter 5', 'Five credits to start training regularly.'),
  ('10 Visit Pack', '10 Visit Pack', 'Ten credits, valid for 90 days.'),
  ('20 Visit Pack', '20 Visit Pack', 'Twenty credits, the lowest price per class.'),
  ('Race Prep Block', 'Race Prep Block', 'Eight credits for a HYROX race prep block.')
) AS v(old_name, new_name, new_description)
WHERE p.name = v.old_name
  AND p.description IN (
    'Booking kelas tanpa batas selama 4 minggu.',
    'Booking kelas tanpa batas selama 8 minggu.',
    'Booking kelas tanpa batas selama 6 bulan.',
    'Latihan tanpa batas selama seminggu, cocok saat berkunjung.',
    'Satu kelas percobaan untuk member baru.',
    'Lima kredit untuk mulai rutin latihan.',
    'Sepuluh kredit, berlaku 90 hari.',
    'Dua puluh kredit, harga per kelas paling hemat.',
    'Delapan kredit untuk blok persiapan race HYROX.'
  );

UPDATE gym.credit_packages SET badge = 'Most popular' WHERE badge = 'Paling laris';
