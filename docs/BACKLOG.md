# Backlog NüHabit

Daftar prioritas (seed). Status hidup ada di [epics/README.md](./epics/README.md) — bila
berbeda, epic yang benar.

## Prioritas development

| # | Epic | Ringkas | Status |
|---|------|---------|--------|
| 1 | [EPIC-057](./epics/EPIC-057-member-app-nuhabit.md) | Member App: booking kelas & Personal Training, pass, beli paket online (Xendit), profil coach + foto, News Hyrox | ready-for-qa |
| 2 | [EPIC-058](./epics/EPIC-058-job-harian-notifikasi-wa.md) | Job harian otomatis + pengingat WhatsApp | ready-for-qa |
| 3 | [EPIC-059](./epics/EPIC-059-aset-tetap-qr-penyusutan.md) | Aset tetap: QR per aset, penyusutan, perawatan | backlog |
| 4 | [EPIC-061](./epics/EPIC-061-pos-fnb-absensi-cs.md) | Penyesuaian POS F&B & absensi CS | backlog |
| 5 | [EPIC-062](./epics/EPIC-062-dashboard-hyrox.md) | Dashboard Hyrox | backlog |
| 6 | [EPIC-063](./epics/EPIC-063-siklus-paket.md) | Freeze, perpanjang, upgrade paket | backlog |
| 7 | [EPIC-064](./epics/EPIC-064-calon-member-waiver-trial.md) | Waiver PAR-Q & trial class | backlog |
| 8 | [EPIC-060](./epics/EPIC-060-inventory-rfid.md) | Inventory RFID (tunggu hardware) | backlog |
| 9 | [EPIC-065](./epics/EPIC-065-pembersihan-teknis.md) | Bersihkan sisa BCD + PR ke development | backlog |

## Setup & keputusan di luar development

- [ ] Tautkan profil coach (mis. Coach Pras) ke data karyawan HRIS yang punya akun login → bisa masuk Coach Portal.
- [ ] Finance: atur mapping COA modul STUDIO (penjualan pass, pengakuan revenue kelas/Personal Training, breakage, komisi akrual & pembayaran).
- [ ] Owner: "Facility" mencakup apa (open gym, loker, sauna)? Kuota atau unlimited selama masa aktif?
- [ ] Owner: single branch atau multi-branch?
- [ ] Owner: komisi tetap dibagi ke coach yang tidak mengajar di bulan itu (opsi B saat ini: ya)?
- [ ] Owner: hardware RFID (reader & tag) dan cakupannya (EPIC-060).
- [ ] Konfigurasi WA Gateway (Settings → WA Gateway), lalu nyalakan pengingat di Kelas & Coach → Otomasi & Pengingat.
- [ ] Konfigurasi Xendit (API key & webhook token) di Payment Gateway untuk pembelian paket online.
