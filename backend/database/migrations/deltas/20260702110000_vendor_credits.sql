-- =============================================================================
-- Legacy shim — vendor_credits schema moved to:
--   schemas/purchasing/00000000000240_table_vendor_credits.sql
--   schemas/purchasing/00000000000241_table_vendor_credit_items.sql
--   bootstrap/00000000001000_functions.sql (generate_vendor_credit_number)
--   bootstrap/00000000002000_foreign_keys.sql (vendor_credits FKs)
--   bootstrap/00000000004000_triggers.sql (trg_generate_vendor_credit_number)
--
-- No-op for databases that already applied the original DDL from this file.
-- =============================================================================

SELECT 1;
