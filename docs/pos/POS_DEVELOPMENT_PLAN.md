# ARK POS - Development Plan

## Overview

**Project**: ARK POS (Point of Sales)  
**Phase**: Phase 1 - Core POS (MVP)  
**Timeline**: 6-8 weeks  
**Target**: Single outlet, ready for SaaS multi-tenant scaling

## 🔗 Integration with Arkiv OS Modules

### HRD Module Integration
- **Staff Management**: POS uses `hrd.employees` for cashier/server references
- **Role-based Access**: Employee roles determine POS permissions
- **Shift Tracking**: Cashier shifts linked to employee attendance
- **Auto-disable**: POS access revoked when employee resigns

### Purchasing Module Integration
- **Unified Inventory**: POS recipes reference `purchasing.raw_materials`
- **Real-time Deduction**: Order checkout → deduct raw material stock
- **Low Stock Alerts**: Trigger PO suggestions when stock < minimum
- **Cost Tracking**: HPP calculation from purchasing cost prices
- **Negative Stock**: Configurable per product (allow/block orders)

---

## 📋 Phase 1 Scope (Core POS MVP)

### Features Included
- ✅ Product catalog with variants & modifiers
- ✅ Order management (dine-in, takeaway)
- ✅ Payment processing (Cash, QRIS via Xendit, Debit/Credit)
- ✅ Ark Coin wallet (topup, payment, redeem)
- ✅ XP & loyalty system
- ✅ Basic inventory deduction (real-time, allows negative)
- ✅ Shift management (open/close cashier)
- ✅ Customer CRM (phone, order history)
- ✅ Table management (basic)
- ✅ Kitchen Display System (KDS) - basic
- ✅ Receipt printing (thermal & digital)

### Features Excluded (Phase 2+)
- ❌ Self-order kiosk
- ❌ Reservation system
- ❌ MICE booking
- ❌ Multi-outlet support
- ❌ Advanced analytics
- ❌ Mobile customer app
- ❌ 3rd party delivery integration

---

## 🗓️ Sprint Breakdown

### Sprint 1: Foundation (Week 1-2)
**Goal**: Database schema + Product management + Integration setup

#### Tasks
- [ ] **Database Migration**
  - [ ] Run `001_pos_core_schema.sql` migration
  - [ ] Create PostgreSQL RLS policies
  - [ ] **Verify HRD integration**: Check `hrd.employees` table exists
  - [ ] **Verify Purchasing integration**: Check `purchasing.raw_materials` table exists
  - [ ] Seed initial data (categories, sample products)

- [ ] **Integration Layer**
  - [ ] Create HRD employee lookup API (`/api/hrd/employees`)
  - [ ] Create Purchasing inventory API (`/api/purchasing/raw-materials`)
  - [ ] Test foreign key relationships
  - [ ] Document integration points

- [ ] **Product Management UI**
  - [ ] Product list page (CRUD)
  - [ ] Product form with variants
  - [ ] **Recipe builder**: Link products to raw materials (purchasing)
  - [ ] Modifier group management
  - [ ] Product image upload
  - [ ] Bulk import/export CSV

- [ ] **Types & API Contracts**
  - [ ] Define TypeScript types (`src/types/pos.ts`)
  - [ ] Create API routes for products
  - [ ] API validation with Zod

#### Deliverables
- Working product catalog management
- Database schema deployed to PostgreSQL
- Type-safe API layer

---

### Sprint 2: Order Management (Week 3-4)
**Goal**: Core POS interface + Order creation

#### Tasks
- [ ] **POS Interface**
  - [ ] Product grid with search & filter
  - [ ] Shopping cart (add, remove, update quantity)
  - [ ] Variant & modifier selection modal
  - [ ] Cart persistence (IndexedDB for offline)
  - [ ] Quick actions (hold order, recall order)

- [ ] **Checkout Flow**
  - [ ] Customer lookup (by phone)
  - [ ] Payment method selection
  - [ ] Cash payment with change calculation
  - [ ] QRIS payment via Xendit
  - [ ] Ark Coin payment option
  - [ ] Receipt preview & print

- [ ] **Order API**
  - [ ] Create order endpoint
  - [ ] Order list with filters
  - [ ] Order detail page
  - [ ] Order status update workflow

- [ ] **Inventory Deduction**
  - [ ] Recipe-based stock deduction (POS → Purchasing raw_materials)
  - [ ] Real-time inventory update via PostgreSQL Realtime
  - [ ] Allow negative stock setting (per product)
  - [ ] Low stock alerts → notify purchasing manager
  - [ ] **Integration test**: Create order → verify raw_materials.current_stock deducted

#### Deliverables
- Working POS interface for cashiers
- Complete order creation flow
- Real-time inventory deduction

---

### Sprint 3: Payment & Wallet (Week 5)
**Goal**: Ark Coin wallet + XP system + Xendit integration

#### Tasks
- [ ] **Ark Coin Wallet**
  - [ ] Customer wallet balance display
  - [ ] Topup flow (Xendit payment gateway)
  - [ ] Payment with Ark Coin
  - [ ] Wallet transaction history
  - [ ] Topup via Xendit (VA, QRIS, Credit Card)

- [ ] **XP & Loyalty**
  - [ ] XP calculation per order
  - [ ] XP redemption to vouchers
  - [ ] Voucher creation & management
  - [ ] Voucher application at checkout
  - [ ] Membership tier logic (auto-promotion)

- [ ] **Xendit Integration**
  - [ ] Xendit API client setup
  - [ ] Create payment gateway endpoint
  - [ ] Payment callback/webhook handler
  - [ ] Payment status sync

- [ ] **CRM Features**
  - [ ] Customer profile page
  - [ ] Order history per customer
  - [ ] Customer search & quick select
  - [ ] Customer notes & tags

#### Deliverables
- Working Ark Coin wallet system
- XP earn & redeem flow
- Xendit payment integration
- Basic CRM

---

### Sprint 4: Shift & KDS (Week 6)
**Goal**: Cashier shift management + Kitchen Display

#### Tasks
- [ ] **Shift Management**
  - [ ] Open shift with opening balance
  - [ ] Shift transaction logging
  - [ ] Close shift with reconciliation
  - [ ] Variance calculation & reporting
  - [ ] Shift history & reports
  - [ ] **HRD Integration**: Link cashier_id to hrd.employees.id

- [ ] **Kitchen Display System**
  - [ ] KDS board UI (kanban style)
  - [ ] Order queue by station
  - [ ] Status updates (pending → cooking → ready → served)
  - [ ] Priority orders (VIP, urgent)
  - [ ] Cooking time tracking
  - [ ] Real-time updates via PostgreSQL Realtime

- [ ] **Table Management**
  - [ ] Table grid with status
  - [ ] Table assignment to orders
  - [ ] Table status updates
  - [ ] QR code generation for tables

#### Deliverables
- Working shift management
- KDS board for kitchen staff
- Table management

---

### Sprint 5: Polish & Testing (Week 7-8)
**Goal**: Bug fixes, performance, offline mode, UAT

#### Tasks
- [ ] **Offline Mode**
  - [ ] IndexedDB setup (Dexie.js)
  - [ ] Cart persistence offline
  - [ ] Order queue for sync
  - [ ] Conflict resolution on reconnect

- [ ] **Performance Optimization**
  - [ ] Product list virtualization
  - [ ] Image lazy loading
  - [ ] API response caching
  - [ ] Database query optimization

- [ ] **Testing**
  - [ ] Unit tests (Vitest)
  - [ ] Integration tests (API)
  - [ ] E2E tests (Playwright)
  - [ ] Load testing (concurrent orders)

- [ ] **UX Polish**
  - [ ] Loading states & skeletons
  - [ ] Error handling & retry
  - [ ] Toast notifications
  - [ ] Keyboard shortcuts
  - [ ] Touch-friendly UI

- [ ] **Documentation**
  - [ ] API documentation
  - [ ] User manual for staff
  - [ ] Deployment guide
  - [ ] Troubleshooting guide

#### Deliverables
- Production-ready POS
- Offline mode support
- Complete documentation
- UAT sign-off

---

## 📁 File Structure

```
src/
├── app/(dashboard)/pos/
│   ├── layout.tsx                 # POS layout with sidebar
│   ├── page.tsx                   # Main POS interface
│   ├── checkout/
│   │   └── page.tsx               # Checkout page
│   ├── orders/
│   │   ├── page.tsx               # Order list
│   │   └── [id]/page.tsx          # Order detail
│   ├── products/
│   │   ├── page.tsx               # Product list
│   │   ├── new/page.tsx           # Create product
│   │   └── [id]/edit/page.tsx     # Edit product
│   ├── customers/
│   │   ├── page.tsx               # Customer list
│   │   └── [id]/page.tsx          # Customer detail
│   ├── shifts/
│   │   ├── page.tsx               # Shift list
│   │   └── [id]/page.tsx          # Shift detail
│   ├── kds/
│   │   └── page.tsx               # Kitchen display
│   └── settings/
│       └── page.tsx               # POS settings
│
├── modules/pos/
│   ├── components/
│   │   ├── ProductGrid.tsx
│   │   ├── ShoppingCart.tsx
│   │   ├── VariantSelector.tsx
│   │   ├── ModifierSelector.tsx
│   │   ├── PaymentSelector.tsx
│   │   ├── CustomerLookup.tsx
│   │   ├── ReceiptPreview.tsx
│   │   ├── KDSBoard.tsx
│   │   ├── TableGrid.tsx
│   │   └── ShiftManager.tsx
│   ├── hooks/
│   │   ├── use-cart.ts
│   │   ├── use-orders.ts
│   │   ├── use-wallet.ts
│   │   └── use-kds.ts
│   ├── lib/
│   │   ├── pos-api.ts             # API client
│   │   ├── xendit-client.ts       # Xendit integration
│   │   ├── inventory.ts           # Inventory logic
│   │   └── xp-calculator.ts       # XP calculation
│   └── stores/
│       ├── cart-store.ts          # Zustand cart state
│       └── pos-settings-store.ts
│
├── types/pos.ts                   # TypeScript types
├── lib/pos/
│   ├── schema.ts                  # Zod schemas
│   └── validators.ts
│
└── app/api/pos/
    ├── products/
    │   ├── route.ts               # GET, POST products
    │   └── [id]/route.ts          # GET, PUT, DELETE product
    ├── orders/
    │   ├── route.ts               # GET, POST orders
    │   └── [id]/route.ts          # GET, PUT order
    ├── customers/
    │   ├── route.ts
    │   └── [id]/route.ts
    ├── wallet/
    │   ├── topup/route.ts         # Xendit topup
    │   └── transactions/route.ts
    ├── xp/
    │   └── transactions/route.ts
    ├── kds/
    │   └── orders/route.ts
    └── shifts/
        ├── route.ts
        └── [id]/close/route.ts
```

---

## 🔐 Security & RLS Policies

### Row Level Security (PostgreSQL)

```sql
-- POS Products (read: all authenticated, write: admin only)
CREATE POLICY "POS products read"
  ON pos_products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "POS products write"
  ON pos_products FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('pos_admin', 'manager')
    )
  );

-- Orders (read: own outlet, write: cashier)
CREATE POLICY "POS orders read"
  ON pos_orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "POS orders create"
  ON pos_orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = cashier_id);

-- Wallet transactions (read: own wallet, write: system)
CREATE POLICY "POS wallet read"
  ON pos_wallet_transactions FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());
```

---

## 🔌 API Endpoints

### Products
- `GET /api/pos/products` - List products (with filters)
- `POST /api/pos/products` - Create product
- `GET /api/pos/products/:id` - Get product detail
- `PUT /api/pos/products/:id` - Update product
- `DELETE /api/pos/products/:id` - Delete product

### Orders
- `GET /api/pos/orders` - List orders (with filters: status, date, cashier)
- `POST /api/pos/orders` - Create order (checkout)
- `GET /api/pos/orders/:id` - Get order detail
- `PUT /api/pos/orders/:id` - Update order (status, payment)
- `POST /api/pos/orders/:id/cancel` - Cancel order

### Customers
- `GET /api/pos/customers` - List customers
- `GET /api/pos/customers/search?phone=xxx` - Search by phone
- `POST /api/pos/customers` - Create customer
- `GET /api/pos/customers/:id` - Get customer detail
- `GET /api/pos/customers/:id/orders` - Customer order history

### Wallet
- `GET /api/pos/wallet/balance` - Get customer wallet balance
- `POST /api/pos/wallet/topup` - Initiate topup (Xendit)
- `POST /api/pos/wallet/payment` - Pay with Ark Coin
- `GET /api/pos/wallet/transactions` - Wallet transaction history

### XP
- `GET /api/pos/xp/balance` - Get customer XP balance
- `POST /api/pos/xp/redeem` - Redeem XP to voucher
- `GET /api/pos/xp/transactions` - XP transaction history

### KDS
- `GET /api/pos/kds/orders` - Get KDS order queue
- `PUT /api/pos/kds/orders/:id/status` - Update item status
- `GET /api/pos/kds/stations` - List KDS stations

### Shifts
- `GET /api/pos/shifts` - List shifts
- `POST /api/pos/shifts` - Open new shift
- `POST /api/pos/shifts/:id/close` - Close shift
- `GET /api/pos/shifts/:id` - Shift detail with transactions

---

## 🎨 UI/UX Wireframes

### Main POS Interface
```
┌─────────────────────────────────────────────────────────────┐
│  ARK POS                                    [Shift: Open]   │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │                 │  │  ┌─────────────────────────────┐ │  │
│  │   Categories    │  │  │      Shopping Cart          │ │  │
│  │   - All         │  │  │  ┌───────────────────────┐  │ │  │
│  │   - Coffee      │  │  │  │ Customer: Walk-in     │  │ │  │
│  │   - Food        │  │  │  │ [Change Customer]     │  │ │  │
│  │   - Dessert     │  │  │  └───────────────────────┘  │ │  │
│  │                 │  │  │                             │ │  │
│  │  [Search...]    │  │  │  1x Kopi Gula Aren    25K  │ │  │
│  │                 │  │  │     - Less Sugar            │ │  │
│  │ ┌─────┬─────┐   │  │  │  2x Roti Bakar        40K  │ │  │
│  │ │ ☕  │ 🍰  │   │  │  │     - Chocolate             │ │  │
│  │ │Latte│Cake │   │  │  │                             │ │  │
│  │ │ 25K │ 30K │   │  │  │  Subtotal:    Rp 65.000    │ │  │
│  │ └─────┴─────┘   │  │  │  Discount:    Rp     0     │ │  │
│  │                 │  │  │  Tax (10%):   Rp  6.500     │ │  │
│  │ ┌─────┬─────┐   │  │  │  ────────────────────────  │ │  │
│  │ │ 🍜  │ 🧊  │   │  │  │  Total:       Rp 71.500    │ │  │
│  │ │Noodle│Ice  │   │  │  │                             │ │  │
│  │ │ 35K │ 15K │   │  │  │  [Hold]  [Checkout]         │ │  │
│  │ └─────┴─────┘   │  │  └─────────────────────────────┘ │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### KDS Board
```
┌─────────────────────────────────────────────────────────────┐
│  KITCHEN DISPLAY                    [Kitchen] [Bar] [Dessert]│
├─────────────────────────────────────────────────────────────┤
│  PENDING (3)           COOKING (2)         READY (1)        │
│  ┌────────────────┐   ┌────────────────┐  ┌──────────────┐  │
│  │ #0045 Dine-in │   │ #0043 Takeaway│  │ #0042 Dine-in│  │
│  │ Table: A5     │   │ 2x Nasi Goreng│  │ 1x Ice Coffee│  │
│  │ 5 min ago     │   │ 1x Ayam Bakar │  │ 8 min        │  │
│  │ ─────────────  │   │ ─────────────  │  │ [Mark Served]│  │
│  │ [Start]       │   │ [Complete]    │  └──────────────┘  │
│  └────────────────┘   └────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Key Metrics to Track

### Performance
- Order creation time: < 30 seconds
- Payment processing: < 5 seconds (cash), < 30 seconds (QRIS)
- KDS update latency: < 1 second (realtime)
- Offline sync: < 10 seconds on reconnect

### Business
- Average transaction value
- Orders per hour (peak vs off-peak)
- Ark Coin adoption rate (% of transactions)
- XP redemption rate
- Inventory waste percentage

---

## 🚀 Deployment Checklist

### Pre-Launch
- [ ] Database migration applied
- [ ] RLS policies tested
- [ ] Xendit webhook configured
- [ ] Thermal printer tested
- [ ] Staff training completed
- [ ] Sample data loaded (products, customers)

### Go-Live
- [ ] Opening balance recorded
- [ ] Shift opened
- [ ] Test transaction completed
- [ ] Receipt printing verified
- [ ] KDS display working
- [ ] Real-time sync verified

### Post-Launch
- [ ] Daily sales report
- [ ] Shift reconciliation
- [ ] Inventory audit
- [ ] Customer feedback collected
- [ ] Bug tracking & fixes

---

## 📞 Support & Maintenance

### Week 1-2 (Hypercare)
- Daily check-ins with staff
- Immediate bug fixes
- Performance monitoring
- User feedback collection

### Ongoing
- Weekly performance review
- Monthly feature updates
- Quarterly security audit
- Annual system health check

---

## 🎯 Success Criteria

**Phase 1 is successful when:**
- ✅ Cashiers can complete orders in < 30 seconds
- ✅ Payment processing works for all methods (Cash, QRIS, Ark Coin)
- ✅ Inventory deduction is accurate (within 5% tolerance)
- ✅ KDS updates in real-time (< 1 second latency)
- ✅ Shift reconciliation matches actual cash
- ✅ Zero data loss during offline mode
- ✅ Staff can use system without manual after 1 week

---

*Last updated: 2026-04-26*  
*Version: 1.0 (Phase 1 MVP)*
