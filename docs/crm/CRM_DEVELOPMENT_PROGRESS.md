# CRM Membership & Loyalty Development Progress

Last updated: 2026-05-22

## Tujuan Modul

CRM dibuat sebagai layer customer/member untuk Talentpool/Arkiv OS yang terhubung dengan POS, multi outlet, reward redemption, ARK Coins, XP, photobooth, studio games, dan collectible avatar.

Konsep utama:

- Customer POS bisa diaktifkan menjadi CRM member.
- Member mendapatkan XP dari POS dan nantinya dari photobooth/studio games.
- XP bisa dipakai untuk redeem reward, voucher, merchandise, discount, dan avatar collectible.
- Member bisa memiliki banyak avatar collectible.
- Satu member bisa memilih satu active avatar untuk dipakai di pengembangan app berikutnya.

## Struktur Data Utama

Tabel CRM foundation sudah disiapkan lewat migration:

- `crm_membership_tiers`
- `crm_member_profiles`
- `crm_xp_rules`
- `crm_xp_ledger`
- `crm_rewards`
- `crm_redemptions`
- `crm_collectible_avatars`
- `crm_member_avatar_inventory`
- `crm_integration_partners`
- `crm_external_events`

Integrasi POS tambahan:

- `pos_customers` menjadi sumber customer awal.
- `pos_products.xp_points` menjadi konfigurasi XP per produk POS.
- POS order/payment sudah tersambung ke loyalty engine untuk award XP.

## Progress Implementasi

### Phase 1 - Foundation CRM

Status: Done

File/migration:

- `database/migrations/20260522063106_crm_membership_loyalty_foundation.sql`
- `database/migrations/20260522064730_crm_pos_xp_integration.sql`
- `src/lib/crm/server.ts`
- `src/lib/crm/loyalty-engine.ts`

Yang sudah selesai:

- Schema membership tier, member profile, XP ledger, reward, redemption, avatar, inventory avatar, partner event.
- Default tier Bronze/Silver/Gold.
- Helper CRM server dan loyalty engine.
- Missing schema detection diperketat supaya fallback hanya saat schema memang belum siap.

### Phase 2 - POS XP Integration

Status: Done

File:

- `src/app/api/pos/orders/route.ts`
- `src/app/api/pos/orders/[id]/route.ts`
- `src/app/api/pos/orders/[id]/splits/[splitId]/pay/route.ts`
- `src/app/api/pos/products/route.ts`
- `src/app/api/pos/products/[id]/route.ts`
- `src/app/api/crm/xp-rules/route.ts`

Yang sudah selesai:

- XP product dan XP transaksi POS.
- Idempotent XP ledger supaya event tidak double post.
- Auto-create/sync CRM member profile saat transaksi XP masuk.
- Sync `pos_customers.current_xp`, `total_xp`, `total_spent`, `visit_count`.
- Konfigurasi XP POS dari CRM dashboard.
- Test live PostgreSQL untuk award XP dan idempotency sudah pernah dilakukan dan berhasil.

### Phase 3 - CRM Dashboard & Member Management

Status: In progress, core flow done

File:

- `src/app/dashboard/(dashboard)/crm/page.tsx`
- `src/app/dashboard/(dashboard)/crm/members/page.tsx`
- `src/app/dashboard/(dashboard)/crm/members/[id]/page.tsx`
- `src/app/api/crm/dashboard/route.ts`
- `src/app/api/crm/members/route.ts`
- `src/app/api/crm/members/[id]/route.ts`

Yang sudah selesai:

- CRM dashboard dengan stats, leaderboard, XP activity, foundation status.
- Members list dari CRM member profile dan fallback POS customer.
- Detail member pindah ke page khusus.
- Enrollment POS customer menjadi CRM member.
- Edit customer/member detail:
  - name
  - phone
  - email
  - customer active
  - manual tier
  - member status
- Quick action activation dari list member.

Catatan:

- Customer fallback memiliki id format `pos-{customer_id}`.
- Redemption aktif setelah customer punya `crm_member_profiles`.

### Phase 4 - Reward Redemption

Status: Done untuk baseline

File:

- `src/app/api/crm/rewards/route.ts`
- `src/app/api/crm/redemptions/route.ts`
- `src/app/dashboard/(dashboard)/crm/rewards/page.tsx`
- `src/app/dashboard/(dashboard)/crm/members/[id]/page.tsx`

Yang sudah selesai:

- Reward catalog CRUD baseline.
- Reward edit/update tanpa reset `stock_redeemed`.
- Toggle active/inactive.
- Copy reward.
- Delete reward aman.
- API redemption:
  - cek reward active
  - cek stock
  - cek XP cukup
  - cek required tier
  - cek max redemption per member
  - create `crm_redemptions`
  - create XP ledger spend
  - update member current/spent XP
  - update customer current XP
  - update stock redeemed
  - generate voucher code untuk discount/voucher
- Member detail sudah punya section Redeem Reward dan Redemption History.

### Phase 5 - Tier Management

Status: Done untuk baseline

File:

- `src/app/api/crm/tiers/route.ts`
- `src/app/dashboard/(dashboard)/crm/page.tsx`

Yang sudah selesai:

- Konfigurasi tier langsung dari CRM dashboard.
- Field:
  - name
  - rank
  - min lifetime XP
  - min spend
  - XP multiplier
  - discount percent
  - display color
  - active/inactive

### Phase 6 - Collectible Avatar Catalog & Ownership

Status: Baseline done

File:

- `src/app/api/crm/avatars/route.ts`
- `src/app/api/crm/avatar-inventory/route.ts`
- `src/app/dashboard/(dashboard)/crm/avatars/page.tsx`
- `src/app/dashboard/(dashboard)/crm/members/[id]/page.tsx`
- `src/app/dashboard/(dashboard)/crm/page.tsx`

Yang sudah selesai:

- API avatar catalog:
  - GET avatars
  - POST upsert avatar
  - DELETE avatar aman
- Halaman Collectible Avatars:
  - form avatar
  - image preview
  - rarity
  - required tier
  - XP cost
  - stock
  - active/inactive
  - edit/copy/toggle/delete
- Link Avatars dari CRM dashboard.
- 2 avatar contoh sudah dimasukkan:
  - `ARK Bronze Explorer`
  - `ARK Gold Guardian`
- API avatar inventory:
  - GET inventory per member/customer
  - POST redeem avatar dengan XP
  - POST grant avatar manual/campaign/partner tanpa potong XP
  - PATCH equip active avatar
- Detail member sudah punya:
  - active avatar card
  - avatar catalog redeem
  - admin grant avatar
  - owned avatar collection
  - use/equip avatar
  - avatar activity baseline
- Reward internal tipe `avatar` tidak tampil di katalog reward default.

### Phase 7 - Partner Integration Preparation

Status: Planning document ready, photobooth implementation parked

File:

- `docs/crm/PHOTOBOOTH_PARTNER_INTEGRATION_GUIDE.md`
- `docs/crm/PHOTOBOOTH_SELF_SERVICE_POS_PLAN.md`
- `src/app/photobooth/self-service/page.tsx`

Yang sudah selesai:

- Dokumen kontrak integrasi photobooth untuk partner.
- Flow payment POS sukses ke partner.
- Flow callback session completed dari partner ke ARK.
- Contoh payload request/response.
- Signature HMAC dan header auth.
- Idempotency dengan `event_id`.
- Mapping status partner ke processing ARK.
- Checklist teknis ARK dan partner.
- Development phases untuk sandbox sampai monitoring.
- Rencana POS self-service photobooth terpisah dari POS F&B.
- Rencana data model `photobooth_sessions`.
- Rencana route `/photobooth/self-service` untuk kiosk customer-facing.
- UI baseline `/photobooth/self-service` sudah dibuat:
  - pilih paket photobooth
  - member lookup mock
  - payment QRIS/ARK Coin mock
  - session ready mock
  - reset/new session

Catatan:

- Photobooth diparkir dulu sambil menunggu integrasi partner.
- Fokus development berikutnya pindah ke Table Self-Service Ordering.

### Phase 8 - Table Self-Service Ordering

Status: UI baseline done

File:

- `docs/pos/TABLE_SELF_SERVICE_ORDERING_PLAN.md`
- `src/app/table-order/[tableCode]/page.tsx`

Yang sudah selesai:

- Rencana POS self-service dari QR meja.
- Route baseline `/table-order/[tableCode]`.
- UI mobile-first untuk customer/member order dari meja.
- Table code otomatis dari URL.
- Member phone input dan guest checkout.
- Menu dengan XP per produk.
- Cart dengan subtotal, tax, total, dan earned XP.
- Payment option:
  - QRIS
  - ARK Coin
  - Virtual Account
  - Bayar di kasir
- Submit order mock dan success state.
- Catatan kitchen/bar routing.

## Konsep Avatar Ownership

Avatar catalog global disimpan di:

- `crm_collectible_avatars`

Avatar yang dimiliki member/customer disimpan di:

- `crm_member_avatar_inventory`

Avatar aktif member disimpan di:

- `crm_member_profiles.active_avatar_id`

Relasi yang diinginkan:

```text
crm_collectible_avatars
  -> master avatar global

crm_member_avatar_inventory
  -> koleksi avatar per member
  -> satu member bisa punya banyak avatar

crm_member_profiles.active_avatar_id
  -> satu avatar yang sedang dipakai member
```

Flow yang sudah berjalan:

1. Member redeem avatar memakai XP.
2. Sistem cek XP, required tier, active status, dan stock avatar.
3. Sistem membuat `crm_redemptions`.
4. Sistem membuat `crm_xp_ledger` spend.
5. Sistem memasukkan avatar ke `crm_member_avatar_inventory`.
6. Jika avatar pertama member, avatar otomatis dijadikan active avatar.
7. Member bisa equip avatar lain dari inventory.

Flow grant admin/campaign:

1. Admin memilih avatar dari detail member.
2. Sistem cek avatar aktif, belum dimiliki, dan stok masih tersedia.
3. Sistem memasukkan avatar ke `crm_member_avatar_inventory`.
4. XP member tidak berubah.
5. Avatar bisa langsung dijadikan active avatar atau hanya masuk collection.

Avatar activity baseline:

- Ditampilkan dari data `crm_member_avatar_inventory`.
- Menampilkan sumber ownership:
  - XP redemption
  - manual grant
  - campaign grant
  - partner grant
- Menampilkan avatar aktif saat ini.
- Belum menyimpan semua history equip berulang karena itu membutuhkan event table khusus.

## Testing Yang Sudah Dilakukan

Sudah pernah diverifikasi:

- Migration berhasil diterapkan di PostgreSQL.
- XP POS integration live smoke test berhasil.
- Product XP save dari UI berhasil.
- Member list dan member detail render.
- Enrollment POS customer menjadi CRM member berhasil.
- Reward redemption live UI/API berhasil.
- Reward catalog edit/toggle/delete berhasil.
- Tier management panel render dan save API berjalan.
- Avatar catalog render dan 2 sample avatar muncul di UI.
- Avatar redeem live dari detail member berhasil:
  - test member `H. Abdullah Trading`
  - XP trial dinaikkan ke 2.000
  - redeem `ARK Bronze Explorer`
  - XP turun menjadi 1.500
  - avatar masuk collection dan otomatis menjadi active avatar
- Manual grant avatar live dari detail member berhasil:
  - grant `ARK Gold Guardian` tanpa memotong XP
  - inventory menjadi 2 avatar
  - equip `ARK Gold Guardian` berhasil
  - reward catalog default tidak menampilkan reward internal avatar
- Avatar Activity baseline tampil di detail member.
- Photobooth self-service POS UI baseline berhasil dibuka di browser.
- Flow UI paket -> member -> payment -> session ready berhasil diklik.

Catatan testing:

- Full `tsc --noEmit` masih gagal karena error lama di modul lain seperti Purchasing/POS backup/Arkiv voice, bukan dari CRM flow yang sedang dikerjakan.
- Targeted ESLint dan targeted TypeScript check untuk file CRM yang disentuh sudah beberapa kali dijalankan dan bersih.

## Next Development Plan

Progress terbaru:

- API `GET /api/table-order/session/[tableCode]` sudah dibuat.
- API `GET /api/table-order/products` sudah dibuat dan membaca menu POS + XP.
- API `POST /api/table-order/customers/lookup` sudah dibuat untuk lookup/create member POS.
- API `POST /api/table-order/orders` sudah dibuat untuk membuat dine-in POS order dari QR meja.
- UI `/table-order/[tableCode]` sudah tersambung ke products/customer/order API.
- Bayar di kasir/QRIS/VA saat ini membuat unpaid/open bill.
- ARK Coin langsung memotong saldo, membuat order paid, dan award CRM XP.

Prioritas berikutnya:

1. Kitchen/bar station mapping lebih eksplisit per produk.
2. QRIS/VA gateway + callback/status polling untuk table self-service.
3. Strict QR table registry atau signed table token.
4. Kasir monitoring khusus self-service order.
5. Photobooth sessions backend setelah partner siap.

Rekomendasi next task:

- Implement **QRIS/VA payment flow atau station mapping produk**, tergantung prioritas operasional.
