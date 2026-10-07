# POS Table Floor Plan (2D Denah Meja) — MVP

- **Date:** 2026-07-12
- **Status:** Draft for approval
- **Author:** AI + product owner (brainstorming session)
- **Scope:** POS master Meja (`/dashboard/pos/tables`) only

---

## 1. Context & Problem

Halaman **Meja** (`/dashboard/pos/tables`) sudah punya CRUD list (nomor, nama, area,
kapasitas, status, QR, aktif). Kasir dan operasional butuh gambaran letak meja di outlet,
bukan hanya daftar teks.

**Keputusan produk (brainstorming):**

| Pertanyaan | Jawaban |
|---|---|
| Versi pertama | MVP: denah 2D + drag + persist posisi |
| Penempatan UI | Tab **List \| Denah** di halaman Meja yang sama |
| Persistensi | **Auto-save** saat pointer lepas (drag end) |
| Pendekatan teknis | **A** — pointer events + CSS absolute (tanpa library drag/canvas baru) |

Schema `pos.pos_tables` saat ini punya `table_number`, `capacity`, `status`, `qr_code`,
`notes`, `name`, `area`, `is_active` — **belum ada kolom posisi**.

---

## 2. Goals & Non-Goals

### Goals

- Tampilkan denah 2D meja di tab **Denah** pada halaman Meja.
- Meja digeser bebas di dalam canvas; posisi tersimpan ke DB saat drag berakhir.
- Warna meja mengikuti status operasional (available / occupied / reserved / maintenance).
- Meja tanpa posisi mendapat layout awal otomatis (grid) agar denah tidak kosong.
- Klik meja di denah membuka dialog edit yang sama dengan List (reuse CRUD).
- GET list meja mengembalikan posisi agar UI dan kasir nanti bisa memakai data yang sama.

### Non-Goals (MVP)

- Resize / rotate meja
- Snap-to-grid ketat, collision detection, wall/obstacle drawing
- Multi-floor / multi-zone map terpisah (field `area` teks tetap ada, bukan layer denah)
- Denah interaktif di kasir / open-bills (bisa fase berikutnya memakai `pos_x`/`pos_y`)
- Library baru (`dnd-kit`, Konva, Fabric, dll.)
- Real-time multi-user sync posisi

---

## 3. UX

### 3.1 Tabs

Header halaman Meja tetap. Di bawah header (atau di toolbar section):

- **List** — perilaku CRUD yang ada sekarang (tabel + dialog tambah/edit/hapus).
- **Denah** — canvas floor plan.

Default tab: **List**. Preferensi tab tidak perlu di-persist (opsional nanti).

### 3.2 Canvas Denah

- Container relatif, tinggi nyaman (~min 480px), background soft (`bg-gray-50` / token surface),
  border soft `border-gray-200/70`, rounded sesuai pola Purchasing cards.
- Setiap meja = node absoulte berukuran tetap (mis. ~88×72px), rounded, soft shadow ringan.
- Isi node: **nomor meja** (utama) + kapasitas kecil; warna sesuai status (sama tone List).
- Cursor `grab` / `grabbing` saat drag.
- Saat drag: meja mengikuti pointer, clamped di dalam bounds canvas.
- Saat drag end: panggil API posisi; toast sukses singkat atau error (satu sumber toast, loading
  state di node jika request in-flight).
- Meja `is_active = false` tetap tampil di denah (abu / opacity rendah) agar layout tidak
  “hilang”; bisa difilter nanti.

### 3.3 Unplaced tables

Jika `pos_x` / `pos_y` null:

- Saat render Denah, hitung posisi grid awal di client (kolom × baris) **tanpa** menulis DB
  sampai user menggeser meja itu pertama kali.
- Setelah drag pertama, posisi tersimpan; layout berikutnya memakai nilai DB.

### 3.4 Edit from floor

- Single click (tanpa drag signifikan, mis. movement &lt; 4px) → buka dialog edit.
- Drag → jangan buka dialog.

### 3.5 Actions on Denah tab

- Tombol **Tambah Meja** tetap tersedia (dialog create); meja baru masuk List + muncul di
  denah sebagai unplaced (grid slot berikutnya).
- Tidak ada tombol “Simpan denah” (auto-save).

---

## 4. Data model

Migrasi delta pada `pos.pos_tables`:

```sql
ALTER TABLE pos.pos_tables
  ADD COLUMN IF NOT EXISTS pos_x numeric(8,2),
  ADD COLUMN IF NOT EXISTS pos_y numeric(8,2);
```

**Koordinat:** persen relatif terhadap ukuran canvas (0–100), sudut kiri-atas node.

- `pos_x` = jarak dari kiri canvas (%)
- `pos_y` = jarak dari atas canvas (%)

Alasan persen: layout responsif tanpa hitung ulang px saat resize.

Nullable = belum ditempatkan oleh user.

Tidak menambah `pos_w` / `pos_h` di MVP (ukuran node fixed di UI).

---

## 5. API

### 5.1 Extend existing GET / PATCH

- `GET /api/pos/tables` — select + return `pos_x`, `pos_y`.
- `PATCH /api/pos/tables/[id]` — boleh menerima `pos_x`/`pos_y` sebagai bagian payload form
  (opsional; tidak wajib dari dialog master).

### 5.2 Dedicated position endpoint (recommended)

`PATCH /api/pos/tables/[id]/position`

Request:

```json
{ "pos_x": 12.5, "pos_y": 40.0 }
```

Rules:

- Auth: `getPosSession()` (sama route meja lain).
- Validasi: keduanya number finite, clamp ke `[0, 100]`.
- Response: `{ success, data: { id, pos_x, pos_y }, message }`.
- Error: 400 invalid, 401 unauth, 404 not found, 500.

Alasan endpoint khusus: payload master form tidak tercampur; race kecil saat auto-save
hanya update 2 kolom.

---

## 6. Frontend architecture

```
src/features/pos/tables/
  components/
    tables-page.tsx          # tabs List | Denah
    tables-list.tsx          # (extract) list + search existing
    tables-floor-plan.tsx    # canvas + drag + auto-save
  api.ts                     # + patchPosTablePosition
  mutations.ts               # + usePatchPosTablePosition
  types.ts                   # + pos_x?, pos_y?
```

### Drag implementation (Approach A)

- `onPointerDown` di node → `setPointerCapture`, catat offset.
- `onPointerMove` → update local `x/y` state (%).
- `onPointerUp` / `onPointerCancel` → jika posisi berubah dari awal drag, panggil mutation;
  jika movement kecil → treat as click → edit dialog.
- Tidak pakai HTML5 DnD.

### Optimistic UI

- Update local/query cache segera saat drag end; rollback + toast error jika API gagal.

---

## 7. Permissions & menu

Tidak ada menu IAM baru. Tetap `pos.operations.tables` (actions create/update/delete/read).
Update posisi memakai permission update yang sama secara praktis (session POS sudah cukup
untuk API meja saat ini; tidak mengubah model auth di MVP).

---

## 8. Testing / acceptance

1. Buka Meja → tab Denah → meja tanpa posisi tampil di grid awal.
2. Drag meja → lepas → refresh halaman → posisi tetap.
3. Drag gagal (network) → toast error, posisi kembali / re-fetch.
4. Click meja tanpa drag → dialog edit terbuka; simpan nama → node ter-update.
5. Tab List masih CRUD normal (create/edit/soft-delete).
6. Resize window → posisi relatif (%) tetap proporsional.

---

## 9. Future (out of this MVP)

- Floor plan di kasir untuk pilih meja.
- Snap grid, rotate, ukuran per meja.
- Multi-area layers / background denah image.
- Collision / “meja saling menumpuk” warning.

---

## 10. Open decisions (resolved)

| Item | Decision |
|---|---|
| Approach | A — CSS absolute + pointer events |
| Placement | Tabs on Meja page |
| Save | Auto-save on drag end |
| Coordinates | Percent 0–100 of canvas |
| Position API | Dedicated `PATCH .../position` |
