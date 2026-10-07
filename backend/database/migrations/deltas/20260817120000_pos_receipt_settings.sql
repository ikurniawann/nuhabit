-- =============================================================================
-- EPIC-040: Konfigurasi struk POS — header & footer bisa dikonfigurasi.
--
-- Scope resolution di aplikasi: warehouse → branch → global (baris dengan
-- branch_id & warehouse_id NULL). Tidak ada konfigurasi = struk tampil persis
-- seperti sebelum epic ini (default ditangani di src/lib/pos/receipt-settings).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pos.pos_receipt_settings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id uuid REFERENCES configuration.branches(id) ON DELETE CASCADE,
    warehouse_id uuid REFERENCES configuration.warehouses(id) ON DELETE CASCADE,
    header_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    footer_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    show_stall_name boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Satu baris aktif per scope: global, per-branch, per-warehouse.
CREATE UNIQUE INDEX IF NOT EXISTS pos_receipt_settings_one_global_idx
    ON pos.pos_receipt_settings ((true))
    WHERE is_active AND branch_id IS NULL AND warehouse_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_receipt_settings_one_per_branch_idx
    ON pos.pos_receipt_settings (branch_id)
    WHERE is_active AND branch_id IS NOT NULL AND warehouse_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_receipt_settings_one_per_warehouse_idx
    ON pos.pos_receipt_settings (warehouse_id)
    WHERE is_active AND warehouse_id IS NOT NULL;

COMMENT ON TABLE pos.pos_receipt_settings IS
  'Header/footer struk POS per scope (global/branch/warehouse). EPIC-040.';

-- Baris global — kosong = perilaku struk sebelum epic ini.
INSERT INTO pos.pos_receipt_settings (id, header_lines, footer_lines, show_stall_name, is_active)
VALUES ('b0000000-0000-4000-8000-000000000040', '[]'::jsonb, '[]'::jsonb, true, true)
ON CONFLICT DO NOTHING;
