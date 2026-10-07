# POS Demo Accounts

Demo accounts untuk testing POS module.

## POS Admin (Full Access)

| Field | Value |
|-------|-------|
| **Email** | `pos.admin@aapextechnology.com` |
| **Password** | `posadmin123` |
| **Role** | `pos_admin` |
| **Access** | Full access ke semua fitur POS |

### Permissions
- ✅ Dashboard - View all stats & reports
- ✅ Product Management - CRUD products & recipes
- ✅ Cashier - Process transactions
- ✅ Order History - View & manage orders
- ✅ Inventory - View stock levels
- ✅ Reports - Export sales reports

## Login URL

- **Production:** https://arkiv-os.vercel.app/login
- **Local:** http://localhost:3001/login

Setelah login, akses POS di:
- **Dashboard:** `/dashboard/pos`
- **Products:** `/dashboard/pos/products`
- **Cashier:** `/dashboard/pos/cashier`
- **Recipe Builder:** `/dashboard/pos/recipe-builder`

## Setup

Untuk membuat account ini di PostgreSQL, jalankan seed script:

```bash
npm run seed:pos-admin
```

Atau manual via admin database:
1. Go to Authentication → Users
2. Add user dengan email & password di atas
3. Set user metadata: `{"role": "pos_admin"}`
