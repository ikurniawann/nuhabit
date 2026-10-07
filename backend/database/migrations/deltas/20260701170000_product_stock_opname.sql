-- =============================================================================
-- Product Stock Opname — header + line items for finished goods counting
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory.product_stock_opnames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opname_number character varying(50),
    company_id uuid,
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
    CONSTRAINT product_stock_opnames_pkey PRIMARY KEY (id),
    CONSTRAINT product_stock_opnames_opname_number_key UNIQUE (opname_number),
    CONSTRAINT product_stock_opnames_status_check CHECK (
        status::text = ANY (
            ARRAY[
                'draft'::character varying,
                'in_progress'::character varying,
                'completed'::character varying,
                'cancelled'::character varying
            ]::text[]
        )
    ),
    CONSTRAINT product_stock_opnames_reason_check CHECK (
        reason::text = ANY (
            ARRAY[
                'stock_opname'::character varying,
                'manual_adjustment'::character varying
            ]::text[]
        )
    )
);

CREATE TABLE IF NOT EXISTS inventory.product_stock_opname_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_stock_opname_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    product_id uuid NOT NULL,
    qty_system numeric(15,3) DEFAULT 0 NOT NULL,
    qty_counted numeric(15,3),
    qty_variance numeric(15,3),
    unit_cost numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_stock_opname_lines_pkey PRIMARY KEY (id),
    CONSTRAINT product_stock_opname_lines_opname_id_fkey
        FOREIGN KEY (product_stock_opname_id) REFERENCES inventory.product_stock_opnames(id) ON DELETE CASCADE,
    CONSTRAINT product_stock_opname_lines_inventory_id_fkey
        FOREIGN KEY (inventory_id) REFERENCES inventory.finished_goods_inventory(id) ON DELETE RESTRICT,
    CONSTRAINT product_stock_opname_lines_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT product_stock_opname_lines_unique_product
        UNIQUE (product_stock_opname_id, product_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_stock_opnames_company_id_fkey'
    ) THEN
        ALTER TABLE inventory.product_stock_opnames
            ADD CONSTRAINT product_stock_opnames_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_stock_opnames_branch_id_fkey'
    ) THEN
        ALTER TABLE inventory.product_stock_opnames
            ADD CONSTRAINT product_stock_opnames_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_stock_opnames_status
    ON inventory.product_stock_opnames (status);

CREATE INDEX IF NOT EXISTS idx_product_stock_opnames_branch
    ON inventory.product_stock_opnames (branch_id);

CREATE INDEX IF NOT EXISTS idx_product_stock_opnames_opname_date
    ON inventory.product_stock_opnames (opname_date DESC);

CREATE INDEX IF NOT EXISTS idx_product_stock_opname_lines_opname
    ON inventory.product_stock_opname_lines (product_stock_opname_id);

CREATE INDEX IF NOT EXISTS idx_product_stock_opname_lines_product
    ON inventory.product_stock_opname_lines (product_id);

COMMENT ON TABLE inventory.product_stock_opnames IS 'Stock opname sessions for finished goods / product inventory';
COMMENT ON TABLE inventory.product_stock_opname_lines IS 'Per-product count lines within a product stock opname session';

CREATE OR REPLACE FUNCTION public.generate_product_stock_opname_number()
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
  FROM inventory.product_stock_opnames
  WHERE opname_number LIKE 'POPN-' || year_part || '-%';

  opname_num := 'POPN-' || year_part || '-' || LPAD(seq_num::TEXT, 3, '0');
  NEW.opname_number := opname_num;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_generate_product_stock_opname_number ON inventory.product_stock_opnames;
CREATE TRIGGER trg_generate_product_stock_opname_number
    BEFORE INSERT ON inventory.product_stock_opnames
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_product_stock_opname_number();
