-- GRN Quality Control: inspections linked to modern purchasing.grn

-- Allow pending QC status on line items
ALTER TABLE purchasing.grn_items
  DROP CONSTRAINT IF EXISTS grn_items_qc_status_check;

ALTER TABLE purchasing.grn_items
  ALTER COLUMN qc_status SET DEFAULT 'pending';

ALTER TABLE purchasing.grn_items
  ADD CONSTRAINT grn_items_qc_status_check
  CHECK (
    qc_status::text = ANY (
      ARRAY[
        'pending'::character varying,
        'accepted'::character varying,
        'partially_rejected'::character varying,
        'rejected'::character varying
      ]::text[]
    )
  );

CREATE TABLE IF NOT EXISTS purchasing.grn_qc_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES purchasing.grn(id) ON DELETE CASCADE,
  status character varying(20) NOT NULL
    CHECK (status::text = ANY (ARRAY['approved'::character varying, 'rejected'::character varying, 'partial'::character varying]::text[])),
  parameter_inspeksi jsonb,
  hasil_inspeksi jsonb,
  catatan text,
  rekomendasi character varying(20),
  inspector_id uuid REFERENCES users(id) ON DELETE SET NULL,
  inspected_at timestamp with time zone NOT NULL DEFAULT now(),
  inventory_posted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT grn_qc_inspections_grn_id_key UNIQUE (grn_id)
);

CREATE INDEX IF NOT EXISTS idx_grn_qc_inspections_grn_id
  ON purchasing.grn_qc_inspections USING btree (grn_id);

CREATE TABLE IF NOT EXISTS purchasing.grn_qc_inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_inspection_id uuid NOT NULL REFERENCES purchasing.grn_qc_inspections(id) ON DELETE CASCADE,
  grn_item_id uuid NOT NULL REFERENCES purchasing.grn_items(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
  qty_inspected numeric(12, 4) NOT NULL DEFAULT 0,
  qty_accepted numeric(12, 4) NOT NULL DEFAULT 0,
  qty_rejected numeric(12, 4) NOT NULL DEFAULT 0,
  item_status character varying(30) NOT NULL
    CHECK (
      item_status::text = ANY (
        ARRAY[
          'accepted'::character varying,
          'partially_rejected'::character varying,
          'rejected'::character varying
        ]::text[]
      )
    ),
  catatan text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_qc_inspection_items_qc_id
  ON purchasing.grn_qc_inspection_items USING btree (qc_inspection_id);

CREATE INDEX IF NOT EXISTS idx_grn_qc_inspection_items_grn_item_id
  ON purchasing.grn_qc_inspection_items USING btree (grn_item_id);

CREATE TRIGGER update_grn_qc_inspections_updated_at
  BEFORE UPDATE ON purchasing.grn_qc_inspections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE purchasing.grn_items
  ADD COLUMN IF NOT EXISTS qty_qc_posted numeric(12, 4) NOT NULL DEFAULT 0;
