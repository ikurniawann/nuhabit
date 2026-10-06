# Deploy DEV — nuhabitdev.reddie.id

Instance DEV Nuhabit (fork BCD Coffee) di server `wit`, diekspos lewat Cloudflare Tunnel.

> `nuhabit.reddie.id` adalah sistem **lain** (hyrox-app di `~/docker-infra/hyrox`,
> port 8112) — jangan disentuh dari repo ini.

## Komponen

| Komponen | Detail |
|----------|--------|
| URL | https://nuhabitdev.reddie.id |
| App | container `nuhabitdev-app` (image `nuhabitdev:local`), `--network host`, listen `127.0.0.1:8141` |
| Database | container `nuhabit-db` (postgres:16-alpine), `127.0.0.1:5482`, DB `nuhabit`, volume `nuhabit-db-data` |
| Storage unggahan | volume `nuhabitdev-storage` → `/app/storage` |
| Tunnel | `/etc/cloudflared/config.yml` (service `cloudflared`, tunnel `ec3e1a8e…`) → `nuhabitdev.reddie.id` → `http://localhost:8141` |
| Kredensial super admin | `~/.nuhabitdev-credentials` (chmod 600, tidak di repo) |

App memakai `--network host` karena pool alamat Docker di server ini sudah habis
(`all predefined address pools have been fully subnetted`), jadi network baru tidak bisa dibuat.

## Redeploy (setelah ada perubahan kode)

```bash
cd ~/Desktop/Nuhabit
docker build -t nuhabitdev:local .
docker rm -f nuhabitdev-app
docker run -d --name nuhabitdev-app --restart unless-stopped --network host \
  -e PORT=8141 -e HOSTNAME=127.0.0.1 \
  -e DATABASE_URL=postgresql://nuhabit:<password>@localhost:5482/nuhabit \
  -e MEMBER_PREVIEW_ENABLED=1 -e MEMBER_OTP_FIXED_CODE=123456 -e PAYMENT_SIMULATOR=1 \
  -v nuhabitdev-storage:/app/storage \
  nuhabitdev:local
```

**Catatan build (2026-10-06):** Dockerfile tidak lagi memakai cache mount `.next/cache`. Cache Turbopack di
BuildKit sempat menyajikan CSS basi (`globals.css` versi BCD, `pink-700 = #e3066f`), sehingga kelas warna NüHabit
(`nh-*`) hilang di DEV. Cek cepat setelah build:
`docker run --rm --entrypoint sh nuhabitdev:local -c 'grep -ho "color-pink-700:[^;]*" .next/static/chunks/*.css'`
→ harus `#00281a`.

`MEMBER_PREVIEW_ENABLED=1` (khusus DEV) menyalakan tombol **Buka Member App** di backoffice — staf membuka Member App
atas nama member tanpa OTP (sesi 4 jam, tercatat di `studio.member_preview_log`). **Jangan** disetel di produksi.

`MEMBER_OTP_FIXED_CODE=123456` (khusus DEV, sementara WA Gateway belum terhubung) — login Member App memakai kode tetap
123456 dan WhatsApp tidak dikirim; layar login menampilkan petunjuk kodenya. Hanya nomor member terdaftar yang bisa
masuk; rate limit & batas percobaan tetap berlaku. **Hapus** begitu WA Gateway terhubung; **jangan** di produksi.

`PAYMENT_SIMULATOR=1` (khusus DEV) — beli paket di Member App menawarkan QRIS, Virtual Account (BCA/BNI/BRI/Mandiri/
Permata), dan kartu kredit; instruksi bayar tampil seperti sungguhan dan pembayaran diperlakukan sukses lewat tombol
simulasi (tanpa uang, kartu uji •••• 1111). Pass terbit seperti pembelian asli (catatan "simulasi DEV", ref `SIM-…`).
**Jangan** di produksi — tanpa flag ini hanya QRIS Xendit yang ditawarkan.

`NEXT_PUBLIC_*` di-inline saat build dari file `.env` (gitignored):

```
NEXT_PUBLIC_APP_NAME=NüHabit
NEXT_PUBLIC_APP_URL=https://nuhabitdev.reddie.id
NEXT_PUBLIC_BASE_URL=https://nuhabitdev.reddie.id
```

## Migrasi database

```bash
npm run db:migrate          # dry-run
npm run db:migrate:apply    # terapkan (target lokal dari .env.local)
```

Replay dari database **kosong** sekarang berhasil (460 migrasi). Lima delta lama
diberi guard di fork ini:

- `20260628200000_items_master_company_scope.sql` — blok `item.storage_conditions`
  (tabel sudah dihapus di baseline) dibungkus `to_regclass(...) IS NULL → RETURN`.
- `20260727151000_…`, `20260727152000_…`, `20260809120000_…` — `GRANT … TO authenticated/service_role`
  (role legacy Supabase) hanya dijalankan bila role-nya ada.
- `20260701180000_backfill_items_sulu_dago_scope.sql` — lolos dengan sendirinya setelah perbaikan di atas.

Database baru juga butuh `search_path` tingkat database (sama seperti instance arkiv/Habitat):

```bash
SP=$(node -e 'console.log(require("./database/schema-map").searchPathSchemas().join(", "))')
docker exec nuhabit-db psql -U nuhabit -d postgres -c "ALTER DATABASE nuhabit SET search_path TO $SP"
```

### Seed awal (database baru)

Grup induk menu (POS, CRM, …) dibuat oleh seeder canonical, bukan oleh delta —
tanpa langkah ini sidebar tampil rata/berantakan dan super admin tidak punya akses.

```bash
# 1. pohon menu canonical + pruning Nuhabit (jalankan ulang delta prune setelahnya)
cat database/seeders/iam-menus.sql database/migrations/deltas/20261002150000_nuhabit_prune_irrelevant_menus.sql \
  | docker exec -i nuhabit-db psql -U nuhabit -d nuhabit -v ON_ERROR_STOP=1
# 2. super admin & admin dapat semua menu aktif
node database/seeders/iam-admin-permissions.js
# 3. akun super admin (pakai password acak, jangan default di seeder)
SUPER_USER_EMAIL=... SUPER_USER_PASSWORD=... node database/seeders/super-admin.js
```

## Tunnel

Config `/etc/cloudflared/config.yml` milik root. Perubahan disiapkan sebagai file staged
lalu dipasang dengan sudo:

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-nuhabitdev-$(date +%Y%m%d-%H%M%S)
sudo cp ~/.cloudflared/config-nuhabitdev-staged.yml /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

DNS (`CNAME nuhabitdev.reddie.id → tunnel`) dibuat dengan
`cloudflared tunnel route dns ec3e1a8e-7973-4572-90a0-58710a2456d3 nuhabitdev.reddie.id`.

## Database uji (E2E)

Database `nuhabit` dipakai oleh nuhabitdev.reddie.id **dan berisi data asli owner** —
jangan menjalankan E2E ke sana. Pakai `nuhabit_test` (Postgres yang sama, :5482):

```bash
# bangun ulang dari nol (replay 465 migrasi + seed IAM + super admin)
docker exec nuhabit-db psql -U nuhabit -d postgres -c "DROP DATABASE IF EXISTS nuhabit_test" -c "CREATE DATABASE nuhabit_test"
# lalu: ALTER DATABASE nuhabit_test SET search_path (lihat di atas), apply-migrations,
# seed iam-menus + prune delta, iam-admin-permissions, super-admin — dengan
# MIGRATE_DATABASE_URL/DATABASE_URL=postgresql://nuhabit:<password>@localhost:5482/nuhabit_test

# dev server ke database uji
DATABASE_URL=postgresql://nuhabit:<password>@localhost:5482/nuhabit_test npx next dev -p 3470
```
