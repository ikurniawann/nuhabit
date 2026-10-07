-- =============================================================================
-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — prelude (extensions + enum types)
-- JANGAN edit manual; regenerate via: npm run db:pull
-- Generated: 2026-06-24T07:28:38.707Z
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS "configuration";
CREATE SCHEMA IF NOT EXISTS "hris";
CREATE SCHEMA IF NOT EXISTS "performance";
CREATE SCHEMA IF NOT EXISTS "recruitment";
CREATE SCHEMA IF NOT EXISTS "item";
CREATE SCHEMA IF NOT EXISTS "purchasing";
CREATE SCHEMA IF NOT EXISTS "inventory";
CREATE SCHEMA IF NOT EXISTS "manufacturing";
CREATE SCHEMA IF NOT EXISTS "pos";
CREATE SCHEMA IF NOT EXISTS "crm";

CREATE SCHEMA IF NOT EXISTS "iam";

CREATE TYPE "public"."attendance_status" AS ENUM ('present', 'late', 'absent', 'half-day', 'remote');
CREATE TYPE "public"."gender_type" AS ENUM ('male', 'female');
CREATE TYPE "public"."leave_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE "public"."leave_type" AS ENUM ('annual', 'sick', 'maternity', 'paternity', 'unpaid', 'emergency', 'pilgrimage', 'menstrual');
CREATE TYPE "public"."marital_status_type" AS ENUM ('single', 'married', 'divorced', 'widowed');
CREATE TYPE "public"."offboarding_status" AS ENUM ('submitted', 'notice_period', 'exit_interview', 'completed');
CREATE TYPE "public"."onboarding_category" AS ENUM ('admin', 'it', 'hr', 'manager', 'general');
CREATE TYPE "public"."pos_employee_role" AS ENUM ('pos_admin', 'pos_manager', 'pos_cashier', 'pos_kitchen', 'pos_server');
CREATE TYPE "public"."pos_order_status" AS ENUM ('pending', 'confirmed', 'preparing', 'ready', 'served', 'completed', 'cancelled', 'voided', 'merged');
CREATE TYPE "public"."pos_order_type" AS ENUM ('dine_in', 'takeaway', 'delivery', 'self_order');
CREATE TYPE "public"."pos_payment_method" AS ENUM ('cash', 'qris', 'debit', 'credit', 'ark_coin');
CREATE TYPE "public"."pos_payment_status" AS ENUM ('unpaid', 'partial', 'paid', 'refunded');
CREATE TYPE "public"."pos_split_status" AS ENUM ('pending', 'paid', 'partial', 'cancelled');
CREATE TYPE "public"."pos_table_status" AS ENUM ('available', 'occupied', 'reserved', 'maintenance');
CREATE TYPE "public"."resignation_type" AS ENUM ('voluntary', 'termination', 'layoff', 'end_of_contract');
CREATE TYPE "public"."shift_type" AS ENUM ('morning', 'afternoon', 'night', 'flexible', 'custom');
