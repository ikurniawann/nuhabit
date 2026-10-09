-- Existing demo branch content may still use the previous coach title.
UPDATE configuration.branches
SET accordions = jsonb_set(accordions, '{team}', '["Program Director: Rani"]'::jsonb)
WHERE slug = 'sulu-bandung'
  AND accordions -> 'team' = '["Head coach: Rani"]'::jsonb;
