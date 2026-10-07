-- =============================================================================
-- Finished goods stock card: ledger mutasi produk (forward-only).
-- Mirror inventory.inventory_movements for inventory.finished_goods_inventory.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory.finished_goods_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_id uuid NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid,
    branch_id uuid,
    tipe character varying(20) NOT NULL,
    jumlah numeric(15,3) NOT NULL,
    qty_before numeric(15,3) NOT NULL,
    qty_after numeric(15,3) NOT NULL,
    unit_cost numeric(15,2),
    total_cost numeric(15,2),
    reference_type character varying(50),
    reference_id uuid,
    reference_number character varying(100),
    alasan text,
    catatan text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT finished_goods_movements_pkey PRIMARY KEY (id),
    CONSTRAINT finished_goods_movements_tipe_check CHECK (
        tipe::text = ANY (
            ARRAY[
                'in'::character varying,
                'out'::character varying,
                'adjustment'::character varying,
                'transfer'::character varying,
                'return'::character varying
            ]::text[]
        )
    )
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finished_goods_movements_inventory_id_fkey'
    ) THEN
        ALTER TABLE inventory.finished_goods_movements
            ADD CONSTRAINT finished_goods_movements_inventory_id_fkey
            FOREIGN KEY (inventory_id)
            REFERENCES inventory.finished_goods_inventory(id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finished_goods_movements_product_id_fkey'
    ) THEN
        ALTER TABLE inventory.finished_goods_movements
            ADD CONSTRAINT finished_goods_movements_product_id_fkey
            FOREIGN KEY (product_id)
            REFERENCES item.products(id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finished_goods_movements_warehouse_id_fkey'
    ) THEN
        ALTER TABLE inventory.finished_goods_movements
            ADD CONSTRAINT finished_goods_movements_warehouse_id_fkey
            FOREIGN KEY (warehouse_id)
            REFERENCES configuration.warehouses(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finished_goods_movements_branch_id_fkey'
    ) THEN
        ALTER TABLE inventory.finished_goods_movements
            ADD CONSTRAINT finished_goods_movements_branch_id_fkey
            FOREIGN KEY (branch_id)
            REFERENCES configuration.branches(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fgm_created_at
    ON inventory.finished_goods_movements (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fgm_inventory_id
    ON inventory.finished_goods_movements (inventory_id);

CREATE INDEX IF NOT EXISTS idx_fgm_product_id
    ON inventory.finished_goods_movements (product_id);

CREATE INDEX IF NOT EXISTS idx_fgm_warehouse_id
    ON inventory.finished_goods_movements (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_fgm_reference
    ON inventory.finished_goods_movements (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_fgm_tipe
    ON inventory.finished_goods_movements (tipe);

COMMENT ON TABLE inventory.finished_goods_movements IS
  'Ledger mutasi stok produk jadi untuk kartu stok (produksi, opname, adjustment, retur).';
