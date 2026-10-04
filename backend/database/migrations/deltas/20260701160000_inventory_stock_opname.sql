-- =============================================================================
-- Stock Opname — header + line items for raw material inventory counting
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory.stock_opnames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opname_number character varying(50),
    warehouse_id uuid,
    branch_id uuid,
    opname_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    reason character varying(50) DEFAULT 'stock_opname'::character varying NOT NULL,
    notes text,
    total_lines integer DEFAULT 0 NOT NULL,
    lines_counted integer DEFAULT 0 NOT NULL,
    lines_with_variance integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_opnames_pkey PRIMARY KEY (id),
    CONSTRAINT stock_opnames_opname_number_key UNIQUE (opname_number),
    CONSTRAINT stock_opnames_status_check CHECK (
        status::text = ANY (
            ARRAY[
                'draft'::character varying,
                'in_progress'::character varying,
                'completed'::character varying,
                'cancelled'::character varying
            ]::text[]
        )
    ),
    CONSTRAINT stock_opnames_reason_check CHECK (
        reason::text = ANY (
            ARRAY[
                'stock_opname'::character varying,
                'manual_adjustment'::character varying
            ]::text[]
        )
    )
);

CREATE TABLE IF NOT EXISTS inventory.stock_opname_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stock_opname_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    raw_material_id uuid NOT NULL,
    qty_system numeric(15,3) DEFAULT 0 NOT NULL,
    qty_counted numeric(15,3),
    qty_variance numeric(15,3),
    unit_cost numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_opname_lines_pkey PRIMARY KEY (id),
    CONSTRAINT stock_opname_lines_stock_opname_id_fkey
        FOREIGN KEY (stock_opname_id) REFERENCES inventory.stock_opnames(id) ON DELETE CASCADE,
    CONSTRAINT stock_opname_lines_inventory_id_fkey
        FOREIGN KEY (inventory_id) REFERENCES inventory.inventory(id) ON DELETE RESTRICT,
    CONSTRAINT stock_opname_lines_raw_material_id_fkey
        FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE RESTRICT,
    CONSTRAINT stock_opname_lines_unique_material
        UNIQUE (stock_opname_id, inventory_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_opnames_warehouse_id_fkey'
    ) THEN
        ALTER TABLE inventory.stock_opnames
            ADD CONSTRAINT stock_opnames_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_opnames_branch_id_fkey'
    ) THEN
        ALTER TABLE inventory.stock_opnames
            ADD CONSTRAINT stock_opnames_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_opnames_status
    ON inventory.stock_opnames (status);

CREATE INDEX IF NOT EXISTS idx_stock_opnames_warehouse
    ON inventory.stock_opnames (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_opnames_opname_date
    ON inventory.stock_opnames (opname_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_opname_lines_opname
    ON inventory.stock_opname_lines (stock_opname_id);

CREATE INDEX IF NOT EXISTS idx_stock_opname_lines_material
    ON inventory.stock_opname_lines (raw_material_id);

COMMENT ON TABLE inventory.stock_opnames IS 'Stock opname / physical count sessions for raw material inventory';
COMMENT ON TABLE inventory.stock_opname_lines IS 'Per-material count lines within a stock opname session';

-- Auto-generate opname number: OPN-2026-001
CREATE OR REPLACE FUNCTION public.generate_stock_opname_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  year_part TEXT;
  seq_num INTEGER;
  opname_num TEXT;
BEGIN
  IF NEW.opname_number IS NOT NULL AND NEW.opname_number <> '' THEN
    RETURN NEW;
  END IF;

  year_part := TO_CHAR(COALESCE(NEW.opname_date, CURRENT_DATE), 'YYYY');

  SELECT COUNT(*) + 1 INTO seq_num
  FROM inventory.stock_opnames
  WHERE opname_number LIKE 'OPN-' || year_part || '-%';

  opname_num := 'OPN-' || year_part || '-' || LPAD(seq_num::TEXT, 3, '0');
  NEW.opname_number := opname_num;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_generate_stock_opname_number ON inventory.stock_opnames;
CREATE TRIGGER trg_generate_stock_opname_number
    BEFORE INSERT ON inventory.stock_opnames
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_stock_opname_number();
