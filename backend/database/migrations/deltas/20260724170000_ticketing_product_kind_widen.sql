-- =============================================================================
-- EPIC-028 Fase A (fix) — lebarkan ticketing.ticket_products.product_kind
-- =============================================================================
-- product_kind semula varchar(10) — tak muat nilai 'season_pass' (11 karakter)
-- yang ditambahkan migrasi 20260724160000. Lebarkan ke varchar(20).
-- Idempoten (aman diulang: ALTER TYPE ke lebar sama = no-op logis).
-- =============================================================================

ALTER TABLE ticketing.ticket_products
    ALTER COLUMN product_kind TYPE varchar(20);
