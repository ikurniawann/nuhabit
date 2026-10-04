# Truncate Data — Purchasing Module

Script SQL untuk mengosongkan data modul Purchasing dengan urutan foreign key yang benar.

## Prerequisites

- `DATABASE_URL` di `.env`
- Migration public sudah dijalankan (`npm run migrate:apply`)

## Reset semua data transaksi

```bash
./scripts/reset-db.sh
```

Atau langsung via psql:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/truncate_data/00_truncate_all.sql
```

## Reset modul tertentu

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/truncate_data/06_truncate_po.sql
```

## Struktur file

| File | Scope |
| --- | --- |
| `00_truncate_all.sql` | Semua data transaksi purchasing |
| `01_truncate_returns.sql` | Purchase returns |
| `06_truncate_po.sql` | Purchase orders |
| `11_truncate_supplier.sql` | Suppliers |
| ... | Lihat folder untuk modul lain |

## Catatan

- Menggunakan `TRUNCATE ... CASCADE` dalam transaction
- **Tidak bisa di-rollback** setelah commit
- Tidak menghapus users, brands, positions, candidates

Lihat juga: [../RESET-DATABASE.md](../RESET-DATABASE.md)
