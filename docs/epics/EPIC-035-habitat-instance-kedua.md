# EPIC-035: Habitat — Duplikasi Instance Kedua (Fork Repo, DB Baru, Deploy Coolify)

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menjalankan **projek kedua** dengan sistem yang identik dengan Arkiv OS, tapi
**repo, database, dan deployment sepenuhnya terpisah**: nama `habitat-new`,
domain `habitat.within.ventures`. Tidak ada data Sulu yang ikut — hanya kode,
skema database, dan seed IAM minimum.

Epic ini bersifat **infrastruktur/operasional**, bukan fitur aplikasi. Tidak ada
perubahan kode produk di repo `pos-saas/arkiv`.

## Konteks & Keputusan Owner (2026-07-27)

Tiga opsi dipertimbangkan sebelum eksekusi:

| Opsi | Isi | Putusan |
|---|---|---|
| A | Satu repo, tambah target deploy baru di `.gitlab-ci.yml` | ditolak — owner ingin repo & grup terpisah |
| B | **Fork penuh ke repo GitLab baru** | **DIPILIH** |
| C | Satu instance multi-tenant (holding→company→branch) | **ditolak — alasan keamanan** |

Opsi C ditolak karena hierarki di
[`src/lib/configuration/business-scope.ts`](../../src/lib/configuration/business-scope.ts)
hanya **scope akses user**, bukan row-level security — RLS legacy justru sudah
dilepas di `bootstrap/00000000010000_strip_legacy_rls.sql`. Dengan 560 referensi
`company_id` tersebar di `src/`, satu query yang lupa memfilter tenant = data bocor
lintas klien. Isolasi per-database jauh lebih murah diverifikasi daripada mengaudit
setiap query.

Keputusan turunan:

1. **Grup GitLab baru `habitat/`** (bukan di bawah `pos-saas/`) — akses tim dipisah.
2. **History dibawa penuh** (929 commit, 14 MB). `.env` tidak pernah ter-track di git,
   jadi tidak ada rahasia yang ikut pindah.
3. **Deploy via GitLab CI + Docker** — pola yang sama dengan arkiv, tapi tanpa
   kredensial di repo. Coolify sempat dipilih lalu **dibatalkan** (lihat Automation
   Log 27 Jul): server tidak menjalankan proxy Coolify, sehingga nilai utamanya
   (domain + SSL bawaan) tidak tersedia dan domain tetap lewat cloudflared.
   Pipeline arkiv yang melayani produksi Sulu tidak tersentuh sama sekali.
4. **DB: host Postgres yang sama (`127.0.0.1:5435`), tapi role & database baru** —
   role `habitat`, database `db-habitat-new`. Kredensial sengaja dipisah dari role
   `arkiv` supaya kebocoran di satu sisi tidak membuka sisi lain. Bukan Postgres
   baru dari Coolify, karena pipeline migrasi mewajibkan target lokal.

## Arsitektur Target

```
GitLab  habitat/habitat-new.git  (branch development)
   │  deploy key + webhook
   ▼
Coolify (host :8000) — build pack Dockerfile, container port 3000
   │  domain habitat.within.ventures (SSL + health check /login)
   ▼
Postgres host 127.0.0.1:5435
   └─ db-habitat-new   (owner role `habitat`)
      ├─ arkiv, db-dev-arkiv, db-production-arkiv  ← TIDAK tersentuh
```

Migrasi **tidak** dijalankan container — [`Dockerfile`](../../Dockerfile) hanya
`npm run start`. Setiap delta baru diterapkan manual dari server.

## Fase

| Fase | Scope (PR-sized) | Status |
|---|---|---|
| **A** | Fork & bersih-bersih repo: mirror clone, rename paket, hapus `.gitlab-ci.yml` + `.gitlab/deploy-docker.sh`, tambah `.env.example`, tulis runbook `docs/DEPLOY-COOLIFY.md`, README identitas Habitat + cara merge upstream | ✅ selesai |
| **B** | Grup GitLab `habitat/` + project `habitat-new`, push mirror 929 commit, set branch default `development` | ✅ selesai |
| **C** | Database: role `habitat` + `db-habitat-new`, skema di-clone dari `db-dev-arkiv` (bukan replay delta — lihat Automation Log), data referensi IAM, seed super admin | ✅ selesai |
| **D** | GitLab CI: registrasi runner per-project, isi CI/CD Variables, DNS + ingress cloudflared `habitat.within.ventures` → `:3461`, deploy pertama | ✅ selesai |
| **E** (lanjut) | Branding (logo, nama app di UI), nomor WA gateway terpisah, kredensial Xendit/Resend/Google BP sendiri, skrip pre-deploy migrasi otomatis di Coolify | belum |

## ⚠ Risiko

1. **Divergensi kode.** Dalam beberapa bulan `habitat-new` dan `arkiv` akan menyimpang
   dan cherry-pick jadi kerja rutin. Mitigasi: repo asal disimpan sebagai remote
   `upstream`, cara merge didokumentasikan di README fork.
2. **Nomor WA gateway bentrok.** Satu nomor Baileys tidak bisa dipakai dua instance —
   sesi akan saling menendang. Wajib nomor sender berbeda (lihat EPIC-020 & runbook
   wa-gateway).
3. **Seeder Sulu ikut terjalan.** `demo-sulu`, `accounting-sulu-coa`,
   `purchasing-sulu-suppliers`, `business-stalls`, `items-*`, `pos-tables` berisi data
   Sulu. Hanya `db:seed:iam` + `db:seed:super-admin` yang boleh dijalankan.
4. **`NEXT_PUBLIC_*` di-inline saat build.** Kalau di Coolify tidak ditandai sebagai
   Build Variable, URL akan salah di client bundle meski env runtime sudah benar.
5. **Container tidak menjangkau Postgres host.** Perlu `host.docker.internal` +
   `--add-host host.docker.internal:host-gateway`, atau IP `docker0` (`172.17.0.1`).
6. **Edit cloudflared bisa menjatuhkan layanan lain.** Tunnel `within-ventures` juga melayani
   `sulu`, `member`, `gitlab`, `n8n`. Wajib backup config sebelum menambah ingress.

## Non-Goals

- Tidak mengubah apa pun di repo `pos-saas/arkiv` atau deployment Sulu.
- Tidak memigrasi arkiv ke Coolify (tetap GitLab CI).
- Tidak membangun multi-tenancy/RLS — isolasi dilakukan per-database.
- Tidak menyalin data operasional Sulu ke Habitat.

## Temuan yang Perlu Ditindaklanjuti Terpisah

**Pipeline migrasi tidak bisa lagi bootstrap database dari nol.** Ditemukan saat Fase C:
delta `20260628200000_items_master_company_scope.sql` gagal karena mengacu ke
`item.storage_conditions`, tabel yang sudah dihapus — tidak ada di baseline maupun di
`db-production-arkiv`. Delta lama itu "aman" di database existing hanya karena sudah
tercatat di `schema_migrations` dan tidak pernah di-replay. Konsekuensi: `db:migrate:apply`
di database kosong akan berhenti di tengah, dan kemungkinan ada delta basi lain setelahnya
yang belum ketahuan. Perlu diputuskan arahnya — regenerate baseline agar mencakup seluruh
delta lama, atau beri guard `IF EXISTS` pada delta yang menyentuh objek terhapus. Sampai itu
beres, instance baru harus dibuat lewat `pg_dump --schema-only`, bukan replay migrasi.

**Seeder `super-admin.js` tidak menyetel `search_path`.** Insert `hris.employees` memicu
trigger yang menyebut `onboarding_checklists` tanpa schema, lalu seluruh seed ter-ROLLBACK.
Seeder lain (`accounting-sulu-coa.js:197`) menyetelnya; `super-admin.js` tidak. Di Habitat
di-workaround dengan `ALTER DATABASE ... SET search_path` (menyamai konfigurasi database
`arkiv`), tapi perbaikan sebenarnya ada di seeder.

**Password DB ter-hardcode di repo arkiv.** `.gitlab/deploy-docker.sh:6` memuat
`DB_PASS="${DB_PASS:-301010**}"` sebagai default dan file itu ter-track di git —
kredensial role `arkiv` untuk `db-production-arkiv` dan `db-dev-arkiv`. Fork Habitat
sudah bersih karena file tersebut dihapus, tapi **repo asal belum**. Perlu dipindah ke
CI/CD Variable (masked + protected) dan password dirotasi. Bukan scope epic ini —
sebaiknya jadi epic/task keamanan tersendiri.

## Acceptance Criteria

- [ ] `http://gitlab.within.ventures/habitat/habitat-new.git` berisi 929+ commit, branch default `development`
- [ ] Repo baru tidak memuat `.gitlab-ci.yml` maupun `.gitlab/deploy-docker.sh`
- [ ] `db-habitat-new` berisi seluruh tabel baseline, `schema_migrations` mencatat 187+ file
- [ ] Database arkiv (`arkiv`, `db-dev-arkiv`, `db-production-arkiv`) tidak berubah
- [ ] `https://habitat.within.ventures/login` mengembalikan 200 dengan SSL valid
- [ ] Bisa login sebagai super admin hasil seed, sidebar menu IAM tampil lengkap
- [ ] Tidak ada data Sulu di instance Habitat
- [ ] Tidak ada kredensial di repo — semua env var hidup di UI Coolify

## Automation Log

- 2026-07-27 — Epic dibuat. Audit server: Coolify aktif (`coolify` :8000,
  `coolify-sentinel`, `coolify-db`), Postgres `:5435` memuat 3 database arkiv,
  `.env` terkonfirmasi tidak pernah ter-track (`.gitignore:35`), repo 20 MB /
  929 commit. Owner memilih Opsi B (fork penuh) + grup GitLab baru `habitat/`
  + domain `habitat.within.ventures`.
- 2026-07-27 — **Fase A TUNTAS** (commit `4c451395` di `~/habitat-new`, belum
  di-push). Mirror bare di `~/habitat-new-mirror.git`. Perubahan: `package.json`
  name `arkiv-os` → `habitat-new`; `.gitlab-ci.yml` + `.gitlab/deploy-docker.sh`
  dihapus (sekaligus melepas default `DB_PASS` yang ter-hardcode); `.env.example`
  baru + `.gitignore` diberi `!.env.example`; `docs/DEPLOY-COOLIFY.md` sebagai
  runbook (DB, Coolify, env var, health check `/login`, catatan migrasi manual);
  README diberi identitas Habitat + perintah merge dari `upstream`.
- 2026-07-27 — **Fase B & C tertahan.** Dua aksi diblokir permission classifier:
  (1) pengambilan token OAuth GitLab untuk membuat grup+project via API —
  grup `habitat/` belum ada sehingga push-to-create juga tidak berlaku;
  (2) `CREATE ROLE` / `CREATE DATABASE` di Postgres. Skrip bootstrap DB siap
  pakai (`bootstrap-habitat-db.sh`: role+password acak → `~/.habitat-new-db-credentials`
  chmod 600, `npm install`, apply migrasi, seed IAM + super admin, verifikasi
  jumlah tabel). Menunggu owner membuat grup+project GitLab kosong dan/atau
  memberi izin `psql`. Owner menyatakan lanjut nanti.
- 2026-07-27 — **Fase B TUNTAS.** Owner membuat grup `habitat/`; project
  `habitat-new` ter-auto-create lewat push. Mirror terkirim: branch
  `development`, `production`, `feature/pos-loyalty-ark-xp-settings`.
  `refs/merge-requests/*` ditolak GitLab (hidden ref milik MR repo asal) —
  wajar, tidak perlu dipindah. Remote `development` kini 930 commit
  (`4c451395`), default branch sudah `development`, `upstream` diarahkan ke
  `pos-saas/arkiv`. Push memakai kredensial yang sudah ada
  (`~/.git-credentials-arkiv`) — **tidak perlu PAT**.
- 2026-07-27 — **Koreksi rencana Fase D** (commit `555c0041` di repo Habitat).
  Audit server menemukan Coolify **tidak menjalankan proxy sendiri**: tidak ada
  container Traefik/Caddy, port 80 dipegang nginx host, 443 tidak listen sama
  sekali. Semua domain `*.within.ventures` masuk lewat tunnel cloudflared
  `within-ventures` (`~/.cloudflared/within.ventures/config.yml`) dengan SSL
  diterminasi di Cloudflare — pola yang sama dipakai `sulu` → :3004,
  `dev-sulu` → :3460, dan Coolify sendiri (`app`) → :8000. Konsekuensi: fitur
  domain/SSL Coolify **tidak dipakai**; Coolify hanya publish ke host port tetap
  **`127.0.0.1:3461`** (diverifikasi bebas), lalu ingress cloudflared merutekan
  `habitat.within.ventures` ke port itu. Runbook `docs/DEPLOY-COOLIFY.md`
  diperbaiki: bagian domain diganti total + langkah backup config tunnel.
- 2026-07-27 — **Fase C TUNTAS**, tapi lewat jalur berbeda dari rencana. Role
  `habitat` + database `db-habitat-new` dibuat sebagai superuser via
  `sudo -u postgres` (role `arkiv` ternyata tidak punya atribut `CREATEROLE`
  maupun `CREATEDB` — database yang ada dibuat superuser). Postgres `:5435`
  adalah instalasi host, bukan container.
  **Replay baseline+delta GAGAL** di `20260628200000_items_master_company_scope.sql`
  (lihat Temuan). Diganti jalur clone: `pg_dump --schema-only --no-owner
  --no-privileges` dari **`db-dev-arkiv`** (328 migrasi, paling mutakhir & sesuai
  branch `development` yang di-fork; produksi tertinggal di 318) → restore sebagai
  role `habitat`. Data referensi ikut disalin: `schema_migrations`, `iam.menus`,
  `iam.roles`, `iam.role_menu_permissions`. Dua hambatan teknis: dump harus
  dijalankan sebagai superuser (role `arkiv` tidak punya USAGE di schema
  `accounting`), dan `iam.menus` butuh `--disable-triggers` karena
  `menus_set_level()` menolak baris anak sebelum induknya ada.
  Hasil verifikasi: **262 tabel, 328 migrasi tercatat, 207 menu, 18 role,
  1 super admin + 1 employee**. Database arkiv tidak berubah (dev 328,
  produksi 318 — sama seperti sebelum eksekusi).
- 2026-07-27 — **Coolify dibatalkan, kembali ke GitLab CI** (commit `90fe01af`).
  Owner mempertanyakan perlunya Coolify; setelah ditimbang ulang, dua dari tiga
  alasan awal gugur: domain+SSL tidak tersedia (proxy Coolify tidak jalan) dan
  env var UI bisa digantikan CI/CD Variables yang sama amannya. Sisa keunggulan
  hanya rollback + log viewer. Sementara itu GitLab Runner **sudah berjalan** di
  host (`executor = "shell"`, config di `~/.config/gitlab-runner/config.toml`,
  runner `arkiv-server-v2` & `brag2026-server`) — jadi "CI" di sini praktis
  hanya bash script yang dipicu push, bukan sistem tambahan. Konsistensi dua repo
  dinilai lebih berharga daripada fitur UI.
  Yang ditulis: `.gitlab-ci.yml` (1 job, branch `development`, port 3461,
  container `habitat`) + `.gitlab/deploy-docker.sh`. Beda dari skrip arkiv:
  tidak ada kredensial hardcoded (`DATABASE_URL` wajib dari CI/CD Variables,
  skrip berhenti bila kosong), variabel opsional hanya diteruskan bila terisi,
  image di-tag per commit SHA agar rollback tanpa rebuild, health check `/login`.
  Diverifikasi: seluruh `NEXT_PUBLIC_*` di repo hanya dipakai server-side, jadi
  **tidak** perlu build arg — cukup env runtime (koreksi atas asumsi awal).
  `docs/DEPLOY-COOLIFY.md` → `docs/DEPLOY.md`, ditulis ulang penuh.
- 2026-07-27 — **Fase D TUNTAS. Habitat LIVE di `https://habitat.within.ventures`**
  (HTTP 200 di `/login`, container `habitat` healthy di `127.0.0.1:3461`,
  pipeline 230 sukses). Yang dikerjakan: DNS CNAME dibuat lewat
  `cloudflared tunnel route dns within-ventures habitat.within.ventures`;
  ingress ditambahkan ke `~/.cloudflared/within.ventures/config.yml` (config
  di-backup, `tunnel ingress validate` OK, reload lewat **SIGHUP tanpa
  downtime**); CI/CD Variable `DATABASE_URL` di-set masked lewat API; runner
  project `habitat-server` (id 5) dibuat via API lalu diregistrasi dengan
  executor shell.
  Catatan infrastruktur: ada **dua proses cloudflared** menjalankan config
  `within.ventures` yang sama — satu dikelola PM2 (`cloudflared-within`), satu
  yatim (parent init). SIGHUP dikirim ke keduanya supaya tidak ada connector
  yang menyisakan config lama. Proses yatim itu perlu dirapikan, tidak mendesak.
  Temuan lain: `member.within.ventures` sedang **down** sejak sebelum pekerjaan
  ini (port 3459 tidak listen, PM2 `arkiv-pos-saas` berstatus stopped, 396
  restart) — tidak berkaitan dengan Habitat, tapi perlu ditindaklanjuti.
- 2026-07-27 — **INSIDEN (tertangkap, tanpa dampak): pipeline branch `production`
  nyaris men-deploy ulang produksi Sulu.** Begitu runner project didaftarkan,
  GitLab menjalankan pipeline lama yang antre — termasuk pipeline di branch
  `production` hasil mirror, yang masih memuat `.gitlab-ci.yml` arkiv dengan
  `CONTAINER_NAME: arkiv`, `HOST_PORT: 3004`, `DATABASE_NAME: db-production-arkiv`.
  Job 505 sempat start 03:36:03 dan dibatalkan; dari trace, ia berhenti saat
  `next build` di dalam `docker build` — **sebelum baris `docker stop arkiv`**.
  Container produksi terkonfirmasi utuh (`Up 2 hours (healthy)`, uptime tidak
  reset). **Akar masalah:** saat menyiapkan CI hanya branch `development` yang
  dipikirkan; branch lain hasil mirror masih membawa konfigurasi deploy repo asal.
  **Mitigasi:** `.gitlab-ci.yml` + `.gitlab/` dihapus dari branch `production` dan
  `feature/pos-loyalty-ark-xp-settings` (penghapusan branch diblokir, tapi tanpa
  definisi CI efeknya sama). Ditemukan pula **Auto DevOps menyala** — memunculkan
  12 job scanning liar di 2 pipeline; semuanya dibatalkan dan Auto DevOps
  dimatikan (`auto_devops_enabled=false`).
  **Pelajaran untuk fork berikutnya:** setelah mirror push, bersihkan konfigurasi
  deploy di SEMUA branch sebelum runner didaftarkan — bukan hanya branch default.
- 2026-07-27 — **Verifikasi kesetaraan skema `db-habitat-new` vs `db-dev-arkiv`.**
  Dibandingkan sebagai superuser di kedua sisi dengan `search_path = pg_catalog`
  agar rendering setara: **249 tabel, 3.736 kolom, 912 indeks, 128 function,
  78 trigger, 13 view, 16 enum, 1.336 constraint — seluruhnya identik**, termasuk
  129 body function yang dicocokkan lewat md5 `pg_get_functiondef`.
  Satu-satunya selisih: **10 CHECK constraint** yang teksnya berbeda karena
  PostgreSQL menulis ulang penempatan cast setelah dump/restore
  (`ANY ((ARRAY[...])::text[])` vs `ANY (ARRAY[(...)::text, ...])`). Dibuktikan
  setara — nama constraint sama persis dan himpunan nilai yang diizinkan identik
  pada kesepuluhnya. Kosmetik, bukan perbedaan perilaku.
  Dua jebakan saat memverifikasi, dicatat supaya tidak terulang: (1) query lewat
  role `arkiv` memberi hasil menyesatkan (252 vs 262 tabel) karena role itu tidak
  punya hak lihat di schema `accounting`/`giftcard`/dll — harus superuser;
  (2) `regclass` dan `pg_get_constraintdef` menyembunyikan nama schema yang ada di
  `search_path`, sehingga Habitat (yang punya `search_path` level database) tampak
  berbeda padahal sama.
- 2026-07-27 — **Login gagal: `no pg_hba.conf entry for host "172.30.0.14",
  user "habitat"`** (dilaporkan owner saat QA). Postgres host hanya menerima
  koneksi dari subnet Docker untuk role yang terdaftar di `pg_hba.conf`; role
  `arkiv` punya baris untuk `172.17.0.0/16` dan `172.30.0.0/16`, role `habitat`
  belum ada sama sekali. Ditambahkan dua baris, **scoped ke `db-habitat-new`
  saja** (lebih ketat dari baris `arkiv` yang `all`), file di-backup dulu, lalu
  `pg_reload_conf()`. Terverifikasi dari **dalam container** (`current_user=habitat`,
  207 menu terbaca) dan `POST /api/auth/login` → **HTTP 200 + session token**.
  **Kenapa lolos deploy pertama:** smoke test saya hanya `curl /login`, dan
  halaman itu tidak menyentuh database — jadi 200-nya menyesatkan. Runbook
  `docs/DEPLOY.md` diperbaiki (commit `9af7aeb9`): langkah pg_hba ditambahkan dan
  smoke test diganti ke `POST /api/auth/login` yang benar-benar query DB.
