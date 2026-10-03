# POS (Point of Sale) Module - Project Brief

## Overview
POS module for Arkiv OS restaurant app with cashier UI, product management, customer loyalty, and order types.

---

## Tech Stack
- Next.js 16.2.3
- TypeScript
- Tailwind CSS 4
- @base-ui/react components
- PostgreSQL (database)
- Vercel (deployment)

---

## UI Features (Completed)

### Cashier Page (`/dashboard/pos/cashier`)
- Single row search: "Cari Pelanggan" button + badge + "Cari produk..." input
- Products grid with thumbnails (square 1:1, white background food photos)
- All prices shown as: `Rp X (Y ARK)` - 1 ARK = Rp 1000
- Default payment method: Kartu Member (NFC)
- Payment modal: scrollable, compact spacing, max-w-[800px]
- Logo: `/public/brand/` (NüHabit wordmark, mark, and app icons)

### Products (`/dashboard/pos/products`)
- Product management with variants and modifiers
- Dialog modals for variant/modifier management

### Orders (`/dashboard/pos/orders`)
- Order list with status tracking

### Dashboard (`/dashboard/pos`)
- KPI cards for daily sales

---

## Schema Design (Planned)

### POS-Only Tables

#### 1. `pos_customers` - Member/Pelanggan
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | varchar | |
| phone | varchar | unique |
| email | varchar | nullable |
| customer_type | enum | regular/premium/owner/vip |
| tier | enum | platinum/gold/silver (for regular) |
| xp_balance | bigint | XP points |
| is_active | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

**Customer Types:**
- `regular` - Member biasa dengan tier (silver/gold/platinum)
- `premium` - langganan tetap, discount tertentu
- `owner` - punya privilege discount khusus
- `vip` - event/campaign specific

#### 2. `pos_cards` - NFC Card Mapping
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| card_uid | varchar | UID dari kartu NFC |
| customer_id | uuid | FK |
| is_active | boolean | |
| created_at | timestamp | |

#### 3. `pos_wallets` - ARK Coin Wallet
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| customer_id | uuid | FK, unique - 1 wallet per customer |
| balance | decimal | Current ARK coin balance |
| created_at | timestamp | |
| updated_at | timestamp | |

#### 4. `pos_wallet_topups` - Topup Transactions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| wallet_id | uuid | FK |
| amount | decimal | ARK coins purchased |
| payment_method | enum | qris/credit_card/debit/cash |
| payment_reference | varchar | External transaction ID |
| amount_paid | decimal | Cash/Qris amount paid |
| rate | decimal | 1 ARK = Rp X |
| status | enum | pending/completed/failed/refunded |
| staff_id | uuid | FK, who processed |
| created_at | timestamp | |

#### 5. `pos_discounts` - Diskon Config
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | varchar | |
| type | enum | percentage/fixed_amount |
| value | decimal | |
| min_order | decimal | |
| max_discount | decimal | cap |
| is_auto_apply | boolean | langsung apply tanpa pilih |
| is_active | boolean | |
| start_date | timestamp | nullable |
| end_date | timestamp | nullable |
| created_at | timestamp | |

#### 6. `pos_customer_discounts` - Privilege per Customer Type
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| customer_type | enum | regular/premium/owner/vip |
| discount_id | uuid | FK |
| is_default | boolean | auto-apply untuk semua customer type ini |
| created_at | timestamp | |

#### 7. `pos_xp_transactions` - XP History
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| customer_id | uuid | FK |
| order_id | uuid | nullable, FK |
| amount | bigint | + earned / - redeemed |
| type | enum | earned/purchase/redeem/refund/expired |
| source | varchar | pos/partner_api/arkiv/manual |
| reference_id | varchar | external reference |
| description | text | |
| created_at | timestamp | |

#### 8. `pos_xp_redemptions` - Redeem XP (Coming Soon)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| customer_id | uuid | FK |
| order_id | uuid | nullable, FK |
| voucher_code | varchar | nullable, untuk voucher |
| digital_asset_ref | varchar | nullable, untuk Arkiv asset |
| xp_used | bigint | |
| status | enum | pending/completed/cancelled/expired |
| expires_at | timestamp | nullable |
| created_at | timestamp | |

#### 9. `pos_tables` - Meja (dine-in)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | varchar | |
| status | enum | available/occupied/reserved |
| created_at | timestamp | |

#### 10. `pos_orders` - Order Header
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| customer_id | uuid | nullable, FK |
| table_id | uuid | nullable, FK |
| staff_id | uuid | nullable, FK ke HRD staff (kasir) |
| order_type | enum | dine_in/takeaway/delivery/self_order |
| status | enum | pending/preparing/ready/completed/cancelled |
| subtotal | decimal | |
| tax | decimal | 10% |
| tip | decimal | |
| discount_id | uuid | nullable, FK |
| discount_amount | decimal | |
| total | decimal | |
| created_at | timestamp | |

#### 11. `pos_order_items` - Item Pesanan
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_id | uuid | FK |
| product_id | uuid | FK ke Purchasing.products |
| quantity | int | |
| unit_price | decimal | dari product + variant adj |
| total_price | decimal | |

#### 12. `pos_order_item_variants` - Varian (BOM-based, impact cost)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_item_id | uuid | FK |
| variant_id | uuid | FK ke Purchasing.product_variants |

#### 13. `pos_order_item_modifiers` - Modifiers (free add-ons)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_item_id | uuid | FK |
| modifier_id | uuid | FK ke Purchasing.modifiers (yang free) |
| price_adjustment | decimal | 0 untuk free, >0 untuk paid add-ons |

#### 14. `pos_order_payments` - Pembayaran
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_id | uuid | FK |
| method | enum | cash/qris/member/wallet/split |
| amount | decimal | |
| ark_deducted | decimal | dari wallet |
| change_amount | decimal | untuk cash |
| created_at | timestamp | |

#### 15. `pos_split_payments` - Detail Split
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_payment_id | uuid | FK |
| method | enum | cash/qris/member/wallet |
| amount | decimal | |

#### 16. `pos_receipts` - Struk
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_id | uuid | FK |
| receipt_number | varchar | unique |
| customer_id | uuid | nullable, FK |
| subtotal | decimal | |
| tax | decimal | |
| tip | decimal | |
| discount_amount | decimal | |
| total | decimal | |
| xp_earned | bigint | |
| ark_used | decimal | ARK coins used |
| payment_method | enum | |
| digital_sent | boolean | |
| created_at | timestamp | |

#### 17. `pos_api_integrations` - Partner API (Arkiv, etc.)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| partner_name | varchar | |
| api_key_hash | varchar | |
| permissions | jsonb | |
| is_active | boolean | |
| created_at | timestamp | |

---

## Integration Points

| Source | POS Reads | POS Updates |
|--------|-----------|-------------|
| **Purchasing.products** | Product list, price, availability | - |
| **Purchasing.product_variants** | Variant options (BOM-based) | - |
| **Purchasing.modifiers** | Modifier options (free/paid add-ons) | - |
| **Purchasing.inventory** | Real-time stock | On order complete (reduce stock) |
| **HRD.staff** | Staff list (kasir, waiter) | - |
| **pos_wallets** | Customer ARK balance | On topup/payment |
| **pos_customers** | Member data, tier, XP | On earn/redeem XP |

---

## Key Design Decisions

1. **Wallet separate from Customer** - Wallet is 1:1 with customer but stored separately for flexibility

2. **Modifiers vs Variants distinction**:
   - `variants` = Size/Temp yang affect cost → from Purchasing BOM
   - `modifiers` = Add-ons, some free, some paid → from Purchasing modifiers

3. **Customer Type untuk Privilege** - Discount berdasarkan customer_type (owner/premium/vip) bukan berdasarkan staff_id

4. **Topup flow**:
   ```
   Customer Topup → pos_wallet_topups (pending) 
                    → Payment confirmed 
                    → pos_wallets.balance += amount
                    → topup status = completed
   ```

5. **XP can be redeemed** for vouchers or digital assets (Arkiv) - table prepared, coming soon

---

## Product Photos
- Stored in `/public/products/`
- 8 products: nasi-goreng, ayam-bakar, mie-goreng, es-teh, kopi-susu, jus-alpukat, kentang-goreng, roti-bakar
- Format: square 1:1, white background