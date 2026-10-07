# ARK POS - Backend Setup Guide

## 📋 Overview

Backend POS menggunakan **Next.js API Routes** + **PostgreSQL** (`pg`).

## 🚀 Setup Steps

### 1. Run Migrations di PostgreSQL

Buka admin database → SQL Editor, lalu run:

Skema POS kini bagian dari migrasi standar — tidak perlu copy-paste manual:

```bash
node database/scripts/apply-migrations.js            # dry-run
node database/scripts/apply-migrations.js --apply    # eksekusi
```

(Folder legacy `migrations/` yang dulu dirujuk di sini sudah dihapus
2026-09-14; isinya sudah ada di `database/migrations/`.)

**Atau via CLI:**

```bash
npm run db:migrate:apply
```

### 2. Setup Environment Variables

Pastikan `.env.local` sudah ada:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arkiv
MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arkiv
```

### 3. Test API Endpoints

Jalankan development server:

```bash
npm run dev
```

Test dengan curl atau Postman:

```bash
# Get products
curl http://localhost:3000/api/pos/products

# Get customers
curl http://localhost:3000/api/pos/customers

# Get dashboard stats
curl http://localhost:3000/api/pos/dashboard/stats

# Create order (example)
curl -X POST http://localhost:3000/api/pos/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order_type": "dine_in",
    "cashier_id": "emp-123",
    "items": [
      {
        "product_id": "prod-1",
        "product_name": "Nasi Goreng Special",
        "product_sku": "NGS-001",
        "quantity": 2,
        "unit_price": 50000,
        "subtotal": 100000,
        "total_amount": 100000
      }
    ],
    "subtotal": 100000,
    "total_amount": 100000
  }'
```

## 📁 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pos/products` | List products |
| POST | `/api/pos/products` | Create product |
| GET | `/api/pos/customers` | List customers |
| POST | `/api/pos/customers` | Create/update customer |
| GET | `/api/pos/orders` | List orders |
| POST | `/api/pos/orders` | Create order |
| PATCH | `/api/pos/orders/:id` | Update order status |
| GET | `/api/pos/dashboard/stats` | Dashboard statistics |
| POST | `/api/pos/topup` | Process Ark Coin topup |
| GET | `/api/pos/reservations` | List reservations |
| POST | `/api/pos/reservations` | Create reservation |
| PATCH | `/api/pos/reservations/:id` | Update reservation |

## 🔧 Client-Side Usage

Import helper functions di component React:

```tsx
import { getProducts, getCustomers, createOrder } from '@/lib/pos-api';

// In your component
const { data: products } = await getProducts({ search: 'nasi' });
const { data: customers } = await getCustomers({ phone: '081234567890' });
const { data: order } = await createOrder(orderData);
```

## 🗄️ Database Schema

### Core Tables:
- `pos_products` - Product catalog
- `pos_product_variants` - Product variants (size, temp, etc.)
- `pos_modifier_groups` & `pos_modifiers` - Customization options
- `pos_customers` - CRM with Ark Coin balance
- `pos_orders` & `pos_order_items` - Order management
- `pos_wallet_transactions` - Ark Coin topup/spend history
- `pos_reservations` - Table reservations
- `pos_tables` - Table management

### Integration Tables (existing):
- `hrd.employees` - Staff/cashier references
- `purchasing.raw_materials` - Inventory for recipes
- `pos_recipes` - Bill of Materials (product → raw materials)

## 🔐 Authentication

API memakai `DATABASE_URL` di server. Untuk production:

1. Enable RLS di semua tabel POS (opsional)
2. Gunakan session JWT dari `@/lib/auth/require-user`
3. Buat policies per role (admin, cashier, manager)

Example policy:

```sql
-- Cashiers can only create/read orders
CREATE POLICY "Cashiers can create orders"
ON pos_orders FOR INSERT
TO authenticated
WITH CHECK (auth.jwt()->>'role' IN ('pos_cashier', 'pos_manager', 'pos_admin'));
```

## 📊 Next Steps

1. ✅ Run migrations di PostgreSQL
2. ✅ Test API endpoints
3. ⏳ Update UI components untuk connect ke API
4. ⏳ Implement inventory deduction on order checkout
5. ⏳ Add Xendit integration for QRIS payments
6. ⏳ Setup realtime subscriptions for KDS

## 🆘 Troubleshooting

**Error: "Missing DATABASE_URL"**
→ Pastikan `.env.local` ada dan berisi `DATABASE_URL`

**Error: "relation does not exist"**
→ Run migrations dulu di psql atau SQL client

**Error CORS**
→ Tambahkan domain kamu di admin database → Authentication → URL Configuration
