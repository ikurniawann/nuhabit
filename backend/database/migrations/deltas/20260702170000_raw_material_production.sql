-- Raw material in-house production: BOM per output material + production order context.

CREATE TABLE IF NOT EXISTS manufacturing.raw_material_bom_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    output_raw_material_id uuid NOT NULL,
    component_raw_material_id uuid NOT NULL,
    qty_required numeric(12,4) NOT NULL,
    satuan_id uuid,
    waste_factor numeric(5,4) DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT raw_material_bom_items_pkey PRIMARY KEY (id),
    CONSTRAINT raw_material_bom_items_output_component_key UNIQUE (output_raw_material_id, component_raw_material_id),
    CONSTRAINT raw_material_bom_items_output_raw_material_id_fkey FOREIGN KEY (output_raw_material_id) REFERENCES item.raw_materials(id) ON DELETE CASCADE,
    CONSTRAINT raw_material_bom_items_component_raw_material_id_fkey FOREIGN KEY (component_raw_material_id) REFERENCES item.raw_materials(id) ON DELETE RESTRICT,
    CONSTRAINT raw_material_bom_items_satuan_id_fkey FOREIGN KEY (satuan_id) REFERENCES item.units(id),
    CONSTRAINT raw_material_bom_items_qty_required_check CHECK (qty_required > 0::numeric),
    CONSTRAINT raw_material_bom_items_no_self_reference CHECK (output_raw_material_id <> component_raw_material_id)
);

CREATE INDEX IF NOT EXISTS idx_rm_bom_output ON manufacturing.raw_material_bom_items USING btree (output_raw_material_id);
CREATE INDEX IF NOT EXISTS idx_rm_bom_component ON manufacturing.raw_material_bom_items USING btree (component_raw_material_id);

ALTER TABLE manufacturing.production_orders
    ADD COLUMN IF NOT EXISTS production_context character varying(20) DEFAULT 'product'::character varying NOT NULL,
    ADD COLUMN IF NOT EXISTS output_raw_material_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'production_orders_output_raw_material_id_fkey'
    ) THEN
        ALTER TABLE manufacturing.production_orders
            ADD CONSTRAINT production_orders_output_raw_material_id_fkey
            FOREIGN KEY (output_raw_material_id) REFERENCES item.raw_materials(id) ON DELETE RESTRICT;
    END IF;
END $$;

ALTER TABLE manufacturing.production_orders
    ALTER COLUMN product_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'production_orders_context_output_check'
    ) THEN
        ALTER TABLE manufacturing.production_orders
            ADD CONSTRAINT production_orders_context_output_check CHECK (
                (
                    production_context::text = 'product'::text
                    AND product_id IS NOT NULL
                    AND output_raw_material_id IS NULL
                )
                OR (
                    production_context::text = 'raw_material'::text
                    AND output_raw_material_id IS NOT NULL
                    AND product_id IS NULL
                )
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_production_orders_context ON manufacturing.production_orders USING btree (production_context);
CREATE INDEX IF NOT EXISTS idx_production_orders_output_rm ON manufacturing.production_orders USING btree (output_raw_material_id);

DROP VIEW IF EXISTS public.v_production_orders;

CREATE VIEW public.v_production_orders AS
 SELECT po.id,
    po.nomor_produksi,
    po.product_id,
    po.output_raw_material_id,
    po.production_context,
    po.outlet_id,
    po.planned_qty,
    po.actual_qty,
    po.status,
    po.planned_material_cost,
    po.actual_material_cost,
    po.overhead_cost,
    po.labor_cost,
    po.packaging_cost,
    po.waste_cost,
    po.hpp_per_unit,
    po.catatan,
    po.started_at,
    po.completed_at,
    po.cancelled_at,
    po.created_by,
    po.updated_by,
    po.created_at,
    po.updated_at,
    po.output_type,
    p.kode AS product_kode,
    p.nama AS product_nama,
    p.harga_jual,
    rm.kode AS output_raw_material_kode,
    rm.nama AS output_raw_material_nama,
    COALESCE(p.nama, rm.nama) AS item_nama,
    COALESCE(p.kode, rm.kode) AS item_kode,
    wip.id AS wip_raw_material_id,
    wip.kode AS wip_raw_material_kode,
    wip.nama AS wip_raw_material_nama,
    COALESCE(material_summary.total_materials, 0::bigint) AS total_materials,
    COALESCE(batch_summary.total_batches, 0::bigint) AS total_batches,
    po.company_id,
    po.branch_id
   FROM manufacturing.production_orders po
     LEFT JOIN products p ON p.id = po.product_id
     LEFT JOIN item.raw_materials rm ON rm.id = po.output_raw_material_id
     LEFT JOIN item.raw_materials wip ON wip.source_product_id = po.product_id
     LEFT JOIN (
        SELECT production_order_materials.production_order_id,
            count(*) AS total_materials
           FROM manufacturing.production_order_materials
          GROUP BY production_order_materials.production_order_id
     ) material_summary ON material_summary.production_order_id = po.id
     LEFT JOIN (
        SELECT production_batches.production_order_id,
            count(*) AS total_batches
           FROM manufacturing.production_batches
          GROUP BY production_batches.production_order_id
     ) batch_summary ON batch_summary.production_order_id = po.id;

ALTER TABLE manufacturing.production_batches
    ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE manufacturing.production_batches
    ADD COLUMN IF NOT EXISTS output_raw_material_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'production_batches_output_raw_material_id_fkey'
    ) THEN
        ALTER TABLE manufacturing.production_batches
            ADD CONSTRAINT production_batches_output_raw_material_id_fkey
            FOREIGN KEY (output_raw_material_id) REFERENCES item.raw_materials(id) ON DELETE SET NULL;
    END IF;
END $$;
