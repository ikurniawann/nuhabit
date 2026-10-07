# Lessons

## Purchasing print pagination
- Jangan `position: absolute` + `body * { visibility: hidden }` untuk cetak. Pagination browser rusak: header section (Persetujuan) yatim di kaki halaman.
- `@page { size: A4; margin: 12mm }` + dokumen di normal flow. Chrome: `aside`/`header`/`print:hidden`. Blok tanda tangan pakai `break-inside: avoid`.

## Purchasing print → redirect `/dashboard`
- Tombol Cetak PR/PO mengarah ke `/dashboard/purchasing/print/{pr|po}/:id` — **sibling** menu IAM (`.../purchasing/pr`), bukan child.
- Layout dashboard (`isPathAllowedByMenus`) hanya prefix-match href menu. Path print tidak tercakup → redirect `firstMenu` = Beranda `/dashboard`.
- Jangan andalkan URL print di luar prefix menu. Alias print ke grant PR/PO di `isPathAllowedByMenus`, atau pindahkan route jadi child `.../pr/:id/print`.


## Produk insert — opsi stall
- Dropdown stall memakai `GET /api/purchasing/warehouses`.
- Jangan hardcode role. Gate pakai `requireIamMenuPrefix` (grant menu produk/inventory).
- Role baru yang punya `items.product.*` otomatis dapat opsi stall.

## IAM role vs Users.role
- Sidebar memakai `iam.user_roles` dulu. `configuration.users.role` hanya fallback.
- Import HRIS sering isi `employee`. Ganti role di Users tanpa sync IAM → menu POS tidak muncul.
- Ganti role wajib `syncIamPrimaryRole`. Relogin setelah assignment diubah.

## POS laporan void
- Menu baru wajib masuk whitelist `iam-menus.sql` NOT IN (kalau tidak, seeder retire menu).
- Icon sidebar harus `NavIconName` yang ada (`document-text`). Jangan `ban`.
- Grant ikut role yang sudah punya `pos.reports.profit`. Relogin / refresh menu IAM setelah migrasi.
- `cashier_id` sering UUID placeholder → join users kosong. Fallback label "Kasir", bukan blank.

## POS cart setelah pindah menu
- `pos_cart_state` + `pos:lastOpenCheckoutId` tetap hidup meski URL sudah tanpa `checkoutId`.
- Masuk kasir dari menu (`?tablet=1` saja) wajib reset keranjang. Handoff `checkoutId`/`orderId`/`tableId` jangan di-reset.
- Tanpa clear `lastOpenCheckoutId`, "Order lagi" menempel ke CHK lama.

## POS default tanggal laporan
- Jangan `new Date(y, m, 1).toISOString().slice(0, 10)` — tengah malam WIB jadi tanggal UTC kemarin (1 Agu → 31 Jul).
- Default rentang = tanggal 1 bulan WIB s/d hari ini WIB (`firstDayOfMonthWib` + `todayWib`). Bulan baru ikut otomatis.

## pg "Client was passed a null or undefined query"
- Hampir selalu `query(sql[params])` karena koma hilang antara template SQL dan array param. `string[array]` = `undefined`.
- Cek argumen `query(` di sekitar edit LIMIT/ORDER, bukan koneksi DB.

## POS pintasan Orders
- Riwayat Transaksi kasir = `/dashboard/pos/orders`, bukan laporan `/dashboard/pos/reports/transactions`.
- `dashboard/pos/layout` dan `dashboard/(dashboard)/layout` tidak berbagi parent. Kasir ↔ Orders wajib `location.assign`, bukan `router.push` (RSC TypeError).
- Bawa `from=cashier|restaurant` + flag tablet supaya tombol kembali mendarat di shell yang sama.

## POS mixed open bill continue
- Open dari Orders untuk `CHK-…` wajib `?checkoutId=`, bukan `orderId` child pertama. Salah id → kasir hanya hydrate 1 stall, Back + order lagi bikin nomor baru.
- Append open bill gabungan tanpa meja tidak bisa andalkan `findUnpaidCheckoutByTable`. Kirim `checkout_id` (session last open + body) ke `/orders/open-bill`.
- Kitchen `completed` + `unpaid` masih open bill. Jangan filter `status=completed` dari lantai/meja.
- Open bill yang di-hydrate: item lama terkunci. Tambah item baru lalu **Order lagi** — jangan kirim ulang item lama (dobel). Jangan lock add kecuali `pay=1`.

## POS QRIS settle
- Jangan izinkan Confirm QRIS saat QR masih dibuat / gagal. `isValid` QRIS = true, jadi klik Confirm (otot kebiasaan tunai) langsung create order `paid` tanpa Xendit.
- Single-stall `POST /api/pos/orders` menandai QRIS `paid` tanpa verifikasi. Wajib ada `xendit_qr_id`/`external_id` yang belum dipakai order lunas lain.
- Jangan reuse QR state antar metode/transaksi: `shouldSkipQrisPrepare` + QR lama yang sudah paid → poll langsung "lunas".
- Mixed checkout sudah verify Xendit di `completeMixedCheckout`. Single-stall harus ikut gate yang sama di klien.

## POS Print Struk — prefill WA
- Setelah bayar, `cart.clearCart()` jalan sebelum modal Print Struk (delay 120ms). Jangan baca `selectedCustomer` di UI modal — sudah `null`.
- Snapshot nomor HP ke variabel lokal di `storeResultPayload` (dari ref yang di-sync sebelum clear). Jangan baca ref lagi di dalam timeout.
- Field WA selalu editable: prefill dari member/pembeli gift card, kasir tetap bisa ganti atau isi manual.

## POS mixed checkout status
- Pay-now gabungan (bukan open bill) menulis child `status=completed` + `payment_status=paid`. Jangan biarkan `pending` — itu status open bill/KDS.
- Open bill (unpaid / ada meja lalu append) tetap `pending` sampai dapur selesai.

## POS mixed checkout visibility
- Tagihan gabungan = `pos_checkouts` + N `pos_orders` per stall. Orders/laporan yang hanya filter assignment 1 stall (mis. Operasional) menyembunyikan child Bakery/Sushi.
- Kasir pusat (`can_central_checkout`) harus expand laporan ke semua stall branch. Halaman Orders group by `checkout_id` dan tampilkan `CHK-…`, bukan hanya `POS-…`.
- QRIS mixed unpaid belum punya child — harus tetap muncul sebagai checkout yatim.

## POS checkout = one bill
- Collapsed kasir-pusat bill must handoff `checkoutId`, never `children[0]`. Cashier pays via `completeCheckout`.
- Never call bare `completeCheckout(id)` — persist tender (`payment_method` + `amount_paid` + change). NFC/gift/ARK on checkout-bill pay → 400 until debit is wired.
- Bills rail badge uses `soldFrom === "central"`, not `kind === "checkout"` (1-stall kasir pusat is `kind: order`).
- Move-table on a checkout child must move every unpaid sibling **and** `pos_checkouts.table_id`.
- Merge/transfer use the same family gate (`canAppendTransferItems`). Stall must not merge into a central child; disable merge on mixed-family destinations.
- Pay-now mixed while an unpaid central checkout exists → 400 “lanjutkan open bill”, not a second checkout.
- Kasir pusat 1-stall open-bill on a table with an unpaid central checkout appends to that checkout (even if the new cart is 1 stall). Stall cashier still always creates a new order.



## Metode bayar POS
- Tambah metode baru = alias Tunai/Kartu, bukan QRIS/Xendit. Order tetap enum `cash`/`credit`.
- Jangan longgarkan `pos_payment_method` enum dari UI; handler existing yang dipakai kasir.
- Nama custom harus disimpan di `payment_method_code` + `payment_method_name`. Tanpa itu laporan/struk/shift hanya lihat enum Tunai/Kartu.
- Laci shift: hanya kode built-in `cash` yang dihitung tunai. Alias custom (Transfer BCA) jangan masuk expected cash.

## Laporan transaksi Xendit
- Jangan reconstruct External ID sebagai `pos-{orderId}`. QR stall = `pos-{uuid acak}` sebelum order ada.
- Simpan `xendit_qr_id` + `xendit_external_id` ke `pos_orders` saat QRIS lunas (create/pay/complete checkout). Transaksi lama tetap kosong.
- Jangan hardcode field Settlement = "Pending". Arkiv tidak lacak settlement Xendit.

## Xendit POS webhook
- Kolom Webhook merah di dashboard Xendit = HTTP non-2xx / URL tak terjangkau, bukan “Settlement Pending” (cair T+2 itu normal).
- QRIS POS biasa (`pos-{uuid}`) diselesaikan poll kasir, bukan webhook. Webhook hanya topup + checkout campur (`pos-chk-`).
- Sulu production: `callback_url` = `https://dashboard.suluinwounderland.com/api/payments/xendit/webhook`. Jangan `sulu.within.ventures` (domain lama).
- Path itu HARUS masuk `publicRoutes` middleware. Tanpa itu Xendit dapat 401 "Authentication required" → webhook failed. Token tetap dicek di route.
- Lookup `pos_checkouts` di webhook jangan sampai 500 kalau tabel/kolom belum ada.

## POS menu baru di server-sulu
- `deploy-docker.sh` tidak menjalankan `db:migrate:apply`. Push kode saja tidak membuat menu IAM.
- Menu Void harus di-apply ke DB `arkiv` di server-sulu (`--allow-remote`). Relogin setelah grant.

## Deploy DB credentials
- Produksi: `postgres@5432/arkiv` + `DB_PASS_URLENCODED` (CI).
- Dev `db-dev-arkiv`: role `agus_remote` / `agus123` (tunnel lokal `:15432`).
- Container deploy tidak bisa `localhost:15432` — pakai `host.docker.internal:5432` + user yang sama.
- Jangan samakan password/user dev dengan produksi. Jangan push ke `production` kecuali diminta.

## ErrorBoundary "Terjadi Kesalahan"
- Copy "Tim kami telah diberitahu" = `src/components/error-boundary.tsx` (client crash), bukan `dashboard/error.tsx`.
- Di production `NODE_ENV=production` stack disembunyikan — selalu tampilkan `error.name + message`.
- Setelah deploy, tab lama sering `ChunkLoadError` / failed dynamic import. Auto-reload sekali (`sessionStorage` guard), jangan loop.
- Pesan "An error occurred in the Server Components render" = throw di layout/page server. Next menyembunyikan detail. Jangan rethrow — catch di layout + render `LayoutLoadError` (kecuali NEXT_REDIRECT).
- `sortWarehouses` / `code.trim()` meledak bila warehouse `code`/`name` null → RSC error di `requireUser` → semua halaman dashboard.



## Restaurant Open Bills drawer
- Panel kanan Open Bills default **tertutup**; buka via **View Orders** → Sheet kanan.
- Workspace restaurant = 2 kolom (action + floor), bukan 3.

## Login hydration mismatch
- Jangan `useState(() => typeof window === "undefined" ? null : searchParams…)` — SSR = null, client = `module=pos` → mismatch teks.
- Baca `redirect`/`module` + jam lokal di `useEffect` setelah mount; state awal sama di server & client.

## POS GUID di UI
- Jangan fallback label meja/stall ke `id` UUID. Pakai "Meja" / "—" / nama dari join warehouses.
- Kasir: bila `tableById` belum match, tampilkan "Meja" — bukan `effectiveTableId` mentah.
- Laporan transaksi: formatStallLabel tolak string yang mirip UUID.

- Jangan biarkan catalog = union semua assignment user. Kasir wajib **satu stall aktif**.
- Mode cookie `all` / "Semua Stall" → block jual (produk kosong + checkout 400).
- Superadmin default sering "Semua Stall" — kasir banner = **pesan saja**, jangan list stall kedua (duplikat switcher sidebar).
- Di path cashier/restaurant: sembunyikan opsi "Semua Stall" di sidebar switcher.
- Stamp `pos_orders.warehouse_id`; laporan transaksi baca header order dulu, bukan `ROW_NUMBER` item termahal.
- Ganti stall saat `pos_cart_state` berisi → **blok** (bukan auto-clear). Key: `POS_CART_STORAGE_KEY`.
- Switcher boleh untuk multi-stall / allAccess, bukan cuma super_admin/admin.
- `stall-options` + `active-stall` API: pakai `requireApiUser` + cek canSwitch, selaras dengan gate kasir.

- Jangan auto-buka form create saat Card ID belum terdaftar. Tampilkan choice: pilih existing (link `nfc_uid`) atau buat baru.
- Jangan `onInitialNfcUidConsumed` / clear `pendingNfcUid` saat modal open — Strict Mode + `router.replace(?card=)` bisa remount dan opsi create hilang.
- Topup harus claim NFC (`setPaymentNfcActive(true)`) supaya scan di halaman itu tidak cuma lewat URL. Clear `?card=` setelah select/close, bukan saat resolve unknown.
- Fitur yang “sudah disesuaikan” tapi belum commit/merge akan hilang saat pindah branch.

## Sidebar parent icons
- Icon parent (group) jangan solid + pill penuh: terasa pecah di samping chevron. Outline + `shrink-0` + label `truncate`.
- Nama icon IAM yang tidak ada di `VALID_ICONS`/`iconMap` jatuh ke clipboard. Tambah mapping dulu sebelum ganti icon di DB.

## Appearance / company theme
- Preview = draft only. Apply menulis DB per company + CSS vars di `<html>`.
- Mode light/dark tetap user preference (`arkiv-theme`); warna/font/sidebar/navbar = company (`arkiv-appearance` cache + `configuration.company_appearance`).
- Daftar font Appearance: `FONT_STACKS` + `FONT_OPTIONS` di `appearance-tokens.ts`. ThemeScript wajib `JSON.stringify(FONT_STACKS)`, jangan hardcode.
- Jangan edit delta yang sudah ter-apply.

## Accounting sidebar tree
- Kode menu wajib mengikuti hierarki (`accounting.master.chart-of-accounts`) karena seeder IAM men-wire `parent_id` dari prefix code.
- Menu baru wajib masuk INSERT + whitelist `iam-menus.sql`, kalau tidak seeder akan soft-delete.
- Item belum siap: halaman `ComingSoonPage`, jangan biarkan 404.
- Period & Closing: Fiscal Years dulu, baru Beginning Balance (BB butuh FY).
- Jangan edit delta yang sudah ter-apply (checksum ledger). Urutan menu → delta baru.
- AR: Invoice B2B = funnel sales; Invoice = register customer non-B2B (belum). Jangan samakan nama menu.
- Pindah Finance → Accounting: update ROLE_MODULE_PATHS `finance_staff` ke `/dashboard/accounting`, whitelist seeder, redirect URL lama.
- AP native SoT: dokumen di `accounting.ap_*`; GRN buat AP invoice + post `PURCHASE_AP_INVOICE` keyed by `ap_invoice` id; bayar hanya via Accounting AP Payment (Purchasing pay API 410). Dual-write `vendor_payments` sementara untuk outstanding PO.



## POS ARK & XP menu
- Halaman `/dashboard/pos/loyalty-settings` sudah ada; menu `pos.loyalty.settings` sempat `is_visible=false` (migrasi 20260720 kira 404).
- Restore wajib + masukkan code ke whitelist seeder `iam-menus.sql`, kalau tidak seeder akan soft-delete lagi.



## HPP produk resep vs PO
- Tidak semua HPP lewat PO. Trading → `harga_modal`/GRN; resep → BOM × avg cost.
- Jangan auto-timpa HPP POS. Suggest: HPP saat ini vs HPP seharusnya, user pilih update.
- `hpp_estimasi` di `v_products_cogs` live; `harga_modal` snapshot yang di-accept user.



## i18n Product master + inventory pages
- Sidebar + page title harus bareng: Satuan/Kategori/Produk, Stok/Opname/Penyesuaian/Transfer.
- Satuan & Transfer Stok sudah id-ID; fokus sisa: products CRUD, kategori, stok produk, opname produk, adjustment produk.

## Product purchasing align RM
- Price list produk dipensiun (soft-delete IAM) seperti RM; PR/PO estimasi pakai `harga_modal`, bukan vendor-price-list.
- Label sidebar + page GRN/pengiriman produk: Penerimaan (GRN), Lacak Pengiriman. Invoice produk belum dipindah ke AP.

## i18n menu + page harus bareng
- Ganti label sidebar IAM saja tidak cukup; page title/toast/empty state di feature page sering masih English.
- Scope Approval + Produksi: hub, list, editor BOM, detail order, laporan terkait.

## Master harga_beli vs avg stok
- GRN post stok: update `raw_materials.harga_beli` = **last purchase** (konversi ke satuan besar); jangan set ke weighted avg.
- `inventory.unit_cost` = avg; movement GRN `unit_cost` = harga transaksi (bukan avg) supaya riwayat/harga terakhir akurat.
- Hook di `addInventoryFromGrn` agar semua jalur QC/inline GRN ikut.

## Menu Invoice RM → Account Payable
- Sidebar IAM: pindah ke `accounting.accounts-payable` (`/dashboard/accounting/accounts-payable`); soft-delete `items.raw-material.purchasing.invoice`.
- Update `iam-menus.sql` + whitelist soft-delete; `RM_ROUTES.purchasingInvoice` + redirect next.config ke path Accounting.
- Detail PO dari AP: deteksi `/accounts-payable/po/` selain `/invoice/po/`.

## POS journal mapping + KDS + antrian
- Jurnal POS cash-basis: hook setelah lunas (checkout / PATCH pay / split pay), bukan open bill atau KDS status.
- `entry_date` jurnal WAJIB `YYYY-MM-DD`. Jangan `String(ordered_at).slice(0,10)` — `Date` dari pg jadi `"Sun Aug 09"` → Postgres `invalid input syntax for type date`. Pakai `toJournalEntryDate` (en-CA + Asia/Jakarta).
- `sourceModule: "POS"`; sale + COGS = 2 event, `document_id` sama (order id). Split pakai `pos_split_payments.id`.
- NFC Tab skip jurnal POS (AR pindah ticketing). Hybrid sama purchasing: mapping kosong → skip/draft; fiscal gagal → `AccountingPostError`.
- Mapping sale wajib DISCOUNT (Dr, optional) + SERVICE_CHARGE (Cr, optional) + TAX optional supaya ticket diskon/SC/tax=0 tetap balance.
- KDS = `pos_orders` + items, bukan tabel `pos_kds_*`. Payment jangan set `status=completed` — pisahkan `payment_status` vs kitchen status. Status bump per station.
- Item `kitchen_status` check harus include `confirmed`. Jangan map `confirmed` → `pending`: derive order status dari item lalu ticket KDS tidak bergerak. Gagal update item harus 500, jangan `console.warn`.
- Nomor antrian = kolom `queue_number` pendek harian, generate sekali via `generate_queue_number` (advisory lock). Jangan reuse `order_number`.
- Query builder `IN`/`NOT IN`: jangan `.not('col','in','(a,b)')` tanpa quote — parser lama nyatu jadi `"ab"`. Prefer array `.not('col','in', ['a','b'])`. Enum Postgres akan error `22P02`.
- KDS fullscreen = `/pos/kds` di LUAR `/dashboard/pos` layout (App Router tidak bisa opt-out induk). Sama pola `/pos/customer-display`. Jangan taruh fullscreen KDS di bawah layout yang masih `AppSidebar`.
- Jangan `<Link>` ke `/pos/*` dari dashboard: Next RSC payload gagal (`TypeError: Failed to fetch`) karena beda root layout. Sidebar pakai `<a>` hard nav (`isPosChromeLessPath`). KDS enter/exit tetap `location.assign`.
- Sama untuk POS dashboard ↔ back-office: `dashboard/pos/layout` vs `dashboard/(dashboard)/layout` tidak berbagi parent. Soft nav (sidebar Roles, tablet Beranda `router.push('/dashboard')`) → overlay `Runtime TypeError / network error`. Pakai `needsCrossPosLayoutHardNav` + `<a>` / `location.assign`.
- `AppSidebar` Suspense fallback jangan render `ThemeToggle`/`useTheme` (atau chrome penuh). `useSearchParams` suspend → fallback SSR kadang di luar ThemeProvider → crash `useTheme must be used within ThemeProvider`. Fallback = shell mesh kosong; `ThemeToggle` pakai `useThemeOrNull`.
- TV antrian customer = `/pos/queue` (bukan CFD `/pos/customer-display`). CFD = monitor kasir (cart/bayar); queue board = dinding tamu (nomor + status).
- Kasir mode tablet: jangan tampilkan Layar Customer / TV Antrian di toolbar — itu untuk monitor kedua di desktop. Sembunyikan juga di **handheld UA** (iPad/Android) meski URL masih `/cashier-new` tanpa `?tablet=1`. Jangan ikat hanya ke immersive flag.
- POS chrome: **Beranda** hanya saat immersive/tablet (sidebar hilang). Desktop kasir jangan tampilkan. Layar penuh = immersive + FS API. KDS fullscreen: Beranda pakai `location.assign('/dashboard')`.
- Kasir PWA/tablet: produk + keranjang wajib `flex-row` (jangan tunggu `lg`). Target min **8.7"** (~800px): cart `w-56`, grid 3–4 kolom via `@container`. Layar lebih besar: cart `w-72/80/96`, kolom 5–8. Jangan `w-[40vw]` — di 8.7" keranjang makan ruang produk.
- Split 800px berlaku juga di **cashier-new** (bukan cuma `?tablet=1`). `lg:flex-row` + cart `max-h-[60vh]` di iPad → grid produk height 0 (tampak blank). Pakai `cashier-workspace-layout` + `min-h-[240px]` pada scroller produk.
- Restaurant tablet: floor 3-kolom dari 800px (`restaurant-workspace-layout`), bukan `lg`. Handoff meja → kasir pakai `shouldUseTabletCashierHandoff` (immersive **atau** handheld) supaya iPad di `/restaurant` masuk `cashier-fullscreen?tablet=1`, bukan `cashier-new`. Chrome Beranda tetap hanya jika immersive (sidebar hilang).
- Kasir: jangan buka modal Print Struk di tick yang sama dengan close PaymentModal (Base UI Dialog). Tutup payment dulu + delay ~120ms. Payload cash/method dari `onConfirm`, jangan andalkan state parent yang masih stale.
- Print thermal: pairing Bluetooth 1x di `/dashboard/pos/printer-settings`, bukan di modal kasir. Print Struk hanya kirim job. Desktop: Web Serial ESC/POS silent. Android tablet: intent RawBT (`rawbt` + base64 ESC/POS). Fallback terakhir: popup HTML + `print()` (jangan iframe 0×0 — Android sering capture halaman kasir/dialog).
- Web Serial di tablet/Android sering tetap ada API-nya tapi picker kosong (“tidak ada perangkat kompatibel”). Deteksi handheld → jangan tampilkan Hubungkan; pairing hanya Chrome/Edge laptop. Print tablet Android lewat RawBT intent.
- Menu baru: delta + INSERT `iam-menus.sql` + whitelist prune. Code `pos.kitchen.queue-board` di bawah `pos.kitchen`. Icon wajib ada di `VALID_ICONS` (pakai `video`, bukan `monitor`/`tv`).
- Unique index harian tidak boleh pakai `timezone()`/`now()` (bukan IMMUTABLE). Wrapper `pos_jkt_date(timestamptz)` IMMUTABLE + index pada `ordered_at` saja.

## Purchasing → Accounting journal mapping
- Hook setelah stok GRN / payment posted / return approved; jangan di PO create.
- Idempotensi: `(company_id, source_event_code, source_document_id)` — GRN memicu 2 event berbeda dengan `document_id` sama.
- Hybrid failure: mapping hilang/incomplete → skip/draft warning; mapping lengkap tapi fiscal/DB gagal → throw `AccountingPostError` (block request).
- Amount GRN = qty lolos QC × harga PO (+ PPN bila ada), bukan qty pintu ditolak.

## Kirim ulang setelah GRN partial
- `active_delivery_id` di detail PO harus = delivery **open** saja (`pending`/`shipped`/`in_transit`), bukan latest delivery.
- Setelah delivery `delivered` + GRN sisa, tombol harus **Kirim Ulang** → `/delivery/insert?po_id=...`, bukan "Lihat Pengiriman".
- Label "kirim ulang" tidak ada di menu terpisah — entry point = detail PO atau Lacak Pengiriman → Tambah Pengiriman.
- **Bug klasik:** `updateDeliveryStatusAfterGrn(partially_received)` jangan set `in_transit` — itu mengunci PO (tidak bisa delivery baru). Satu SJ = satu GRN; setelah GRN, delivery wajib `delivered` (atau `cancelled` jika ditolak total).
- GRN status `partially_received` ≠ “lanjutkan penerimaan di GRN yang sama”. UI “Lanjutkan Penerimaan” hanya untuk `pending` (belum QC). Sisa qty → **Kirim Ulang** + GRN baru.

## Sidebar labels vs items-nav
- Label sidebar IAM diambil dari tabel `iam.menus` (DB), bukan hanya dari `items-nav.ts`.
- Saat ganti bahasa/label menu yang terlihat di screenshot sidebar: update seeder + buat migration `UPDATE iam.menus SET menu_name=... WHERE code=...`.
- `items-nav.ts` / landing cards tetap perlu diselaraskan untuk konsistensi breadcrumb & hub Items.

## Satuan stok bahan baku
- `inventory.qty_available` / `unit_cost` adalah satuan dasar: satuan kecil bila material punya satuan kecil, selain itu satuan besar.
- Field di master (`harga_beli`, `stok_minimum`, `stok_maximum`) tetap per satuan besar. Jangan bandingkan langsung dengan qty inventory tanpa konversi.
- Semua jalur posting stok (GRN, impor, PO on-order) wajib lewat `resolveBaseUnitFactor` sebelum menulis ke inventory.
- Sebelum mengubah tampilan qty/harga, cek dulu jalur penulisan datanya; label UI di project ini sempat memakai satuan besar padahal datanya satuan kecil.

## POS laporan Rush Hour
- Menu `pos.reports.rush-hour` wajib masuk INSERT seeder + whitelist `NOT IN` — seeder akan soft-delete kalau tidak.
- Jam/hari pakai `AT TIME ZONE 'Asia/Jakarta'` + ISODOW. Filter sama laporan Transaksi (lunas, exclude void).

## POS void order lunas
- Void bukan menu sidebar; aksi di `/dashboard/pos/orders` + PIN supervisor.
- Order `completed`/`paid` boleh di-void. Tetap tolak `cancelled` / `voided` / `merged`.
- Balik tender dulu (ARK / gift card / NFC tab), baru stempel `voided` + `refunded`. Helper harus idempoten.
- Checkout campur: void satu child = void seluruh sibling + checkout `refunded`. ARK dikembalikan sekali, bukan dijumlah per child.
- Gift card yang dijual lewat order: matikan jika belum terpakai; jika sudah ada ledger `pakai`, tolak void.
- Tunai & QRIS tidak di-refund ke Xendit/laci otomatis — kasir kembalikan manual. Laporan sudah exclude `voided`.

## i18n Purchasing
- Terjemahkan label bersama dulu (`PR_STATUS_LABELS`, `RETURN_*_LABELS`, `getPRStatusLabel`), baru hapus override lokal. Jangan biarkan halaman approval/list masih override Inggris.
- `CsvImporter` template header memakai `col.key`, bukan `col.label` — aman menerjemahkan `import-config` label tanpa merusak format file.
- Jangan terjemahkan free-text yang ditulis server ke DB tanpa memikirkan display lama: contoh deskripsi termin PO (`Paid in Full` / `Installment N`). Lebih aman localize saat render.
- Bahasa Indonesia tidak memakai plural `s`; hapus pola `${n === 1 ? "" : "s"}` saat menerjemahkan toast/dialog.
- Locale tanggal/angka UI id-ID: `toLocaleDateString("id-ID")`, `Intl.NumberFormat("id-ID")`.
