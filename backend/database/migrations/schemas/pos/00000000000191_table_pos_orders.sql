-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — table: pos.pos_orders
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:29:45.034Z
-- =============================================================================

-- Table: pos.pos_orders
CREATE TABLE "pos"."pos_orders" (
    "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
    "order_number" character varying(20) NOT NULL,
    "order_type" pos_order_type DEFAULT 'dine_in'::pos_order_type NOT NULL,
    "status" pos_order_status DEFAULT 'pending'::pos_order_status NOT NULL,
    "payment_status" pos_payment_status DEFAULT 'unpaid'::pos_payment_status NOT NULL,
    "payment_method" pos_payment_method,
    "customer_id" uuid,
    "cashier_id" uuid NOT NULL,
    "server_id" uuid,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0,
    "discount_reason" character varying(200),
    "tax_amount" numeric(12,2) DEFAULT 0,
    "service_charge_amount" numeric(12,2) DEFAULT 0,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount_paid" numeric(12,2) DEFAULT 0,
    "change_amount" numeric(12,2) DEFAULT 0,
    "ark_coins_used" numeric(12,2) DEFAULT 0,
    "ark_coins_earned" integer DEFAULT 0,
    "notes" text,
    "special_requests" text,
    "ordered_at" timestamp with time zone DEFAULT now(),
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_reason" character varying(200),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "shift_id" uuid,
    "table_id" text,
    "voided_at" timestamp with time zone,
    "voided_by" uuid,
    "void_reason" text,
    "merged_to_order_id" uuid,
    "merged_from_orders" uuid[] DEFAULT '{}'::uuid[],
    "served_at" timestamp with time zone
);

ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_order_number_key" UNIQUE (order_number);

ALTER TABLE ONLY "pos"."pos_orders"
    ADD CONSTRAINT "pos_orders_pkey" PRIMARY KEY (id);

CREATE INDEX idx_pos_orders_cashier ON pos.pos_orders USING btree (cashier_id);

CREATE INDEX idx_pos_orders_customer ON pos.pos_orders USING btree (customer_id);

CREATE INDEX idx_pos_orders_merged_to ON pos.pos_orders USING btree (merged_to_order_id);

CREATE INDEX idx_pos_orders_order_number ON pos.pos_orders USING btree (order_number);

CREATE INDEX idx_pos_orders_ordered_at ON pos.pos_orders USING btree (ordered_at DESC);

CREATE INDEX idx_pos_orders_shift_id ON pos.pos_orders USING btree (shift_id);

CREATE INDEX idx_pos_orders_status ON pos.pos_orders USING btree (status);

CREATE INDEX idx_pos_orders_table_active ON pos.pos_orders USING btree (table_id, status) WHERE (status = ANY (ARRAY['pending'::pos_order_status, 'confirmed'::pos_order_status, 'preparing'::pos_order_status, 'ready'::pos_order_status, 'served'::pos_order_status]));

COMMENT ON TABLE "pos"."pos_orders" IS 'Main order table with status workflow and payment tracking';
