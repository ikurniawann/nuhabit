-- Replace the demo event's general contact form with a spot request form.
-- A CRM lead is a request; it does not reserve a class seat.
INSERT INTO crm.crm_forms
  (slug, name, title, description, default_source, lead_temperature, submit_label, success_message, fields)
VALUES
  ('race-sim-october', 'October Race Simulation', 'Request a spot',
   'Tell us how to reach you. The NüHabit team will confirm availability.',
   'website', 'hangat', 'Request a spot',
   'Request received. The NüHabit team will contact you to confirm availability.',
   '[
     {"key":"pic_name","label":"Name","type":"text","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"pic_email","label":"Email","type":"email","required":true,"placeholder":null,"help_text":null,"options":[],"width":1},
     {"key":"pic_phone","label":"WhatsApp number","type":"phone","required":true,"placeholder":null,"help_text":null,"options":[],"width":2},
     {"key":"notes","label":"Anything we should know?","type":"textarea","required":false,"placeholder":null,"help_text":null,"options":[],"width":2}
   ]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

UPDATE site.events
SET form_slug = 'race-sim-october',
    body_md = 'A full race simulation. Request a spot with the form below.'
WHERE slug = 'race-sim-oktober'
  AND title = 'October Race Simulation'
  AND form_slug = 'contact'
  AND body_md = 'A full race simulation. Register with the form below.';
