# Tindak lanjut MOM NüHabit, 8 Oktober 2026

Dokumen ini mencatat keputusan kerja dan bahan yang masih diperlukan untuk 13 butir MOM. Angka dan aturan operasional di bagian usulan perlu disetujui pemilik proses sebelum dijadikan kebijakan produksi.

## SOP coach — draf untuk disetujui

1. **Cuti terencana.** Coach mengajukan tanggal, kelas yang terdampak, dan usulan pengganti kepada Program Director paling lambat 7 hari kalender sebelum kelas pertama. Program Director memutuskan dan mengatur pengganti sebelum jadwal publik diubah. HR mencatat cuti di HRIS.
2. **Sakit atau keadaan darurat.** Coach menghubungi Program Director segera setelah mengetahui tidak bisa hadir, melalui kanal tim yang disepakati. Program Director menghubungi coach pengganti dan memberi tahu front desk. Jika tidak ada pengganti, front desk menghubungi peserta terdaftar dan menawarkan pindah jadwal atau pengembalian credits sesuai kebijakan yang berlaku.
3. **Tidak hadir tanpa kabar.** Front desk melakukan eskalasi ke Program Director ketika coach belum hadir 30 menit sebelum kelas. Program Director mencatat kronologi dan tindak lanjut; HR menangani konsekuensi kepegawaian sesuai peraturan kerja.
4. **Keluhan pelanggan.** Penerima keluhan mencatat waktu, kelas, ringkasan, dan cara menghubungi pelanggan. Keluhan keselamatan atau perlakuan tidak pantas langsung diteruskan ke Program Director dan manajemen pada hari yang sama; aktivitas terkait dihentikan bila perlu. Keluhan layanan biasa mendapat tanggapan awal dalam 1 hari kerja. Jawaban akhir dan tindakan dicatat pada tiket agar tidak bergantung pada chat pribadi.
5. **Pelanggan yang memerlukan perhatian khusus.** Coach menanyakan kebutuhan latihan secara privat, mencatat batasan yang diberikan pelanggan hanya di tempat yang aksesnya dibatasi, dan menyesuaikan kelas dalam ruang kompetensinya. Masalah medis atau cedera dirujuk ke tenaga kesehatan; coach tidak memberi diagnosis. Informasi sensitif tidak disebarkan ke grup umum.
6. **Penanggung jawab.** Program Director memegang jadwal pengganti dan eskalasi kelas. Front desk memegang pemberitahuan peserta. HR memegang catatan cuti dan kepegawaian. Manajemen memutuskan kompensasi yang di luar kebijakan standar.

Sebelum berlaku, tetapkan kanal darurat, daftar coach pengganti, batas waktu resmi, kebijakan pengembalian credits, dan lokasi pencatatan keluhan. Angka 7 hari, 30 menit, dan 1 hari kerja di atas adalah usulan awal.

## Email karyawan dan slip gaji

- HR mengisi alamat email kerja tiap karyawan aktif. IT membuat akun pada domain perusahaan, mengaktifkan autentikasi, dan meminta karyawan mengonfirmasi bahwa ia bisa menerima email uji. HR mencocokkan alamat yang sudah dikonfirmasi dengan profil karyawan sebelum tombol kirim slip dipakai.
- Konfigurasi pengirim payroll memakai `RESEND_API_KEY` dan `PAYROLL_FROM_EMAIL` (atau `FROM_EMAIL`) pada domain pengirim terverifikasi. Jangan memakai alamat sandbox. Setelah payroll berstatus **paid**, HR mengirim PDF individual dari detail run. Aplikasi mencatat alamat tujuan, ID kiriman Resend, dan waktu penerimaan permintaan. Status itu belum membuktikan email sampai di inbox; pantau log pengiriman dan kasus bounce pada Resend.
- Akses PDF tetap dibatasi: karyawan hanya dapat mengunduh slipnya sendiri, sedangkan HR dapat mengakses slip untuk proses penggajian. Uji pengiriman pada akun internal sebelum run pertama dikirim ke seluruh karyawan.

## Format export penggajian — usulan awal

Tombol detail run sekarang menghasilkan XLSX draf internal. Sheet **Ringkasan** memuat periode, status, jumlah karyawan, bruto, total potongan, net transfer, jumlah rekening yang belum lengkap, dan jumlah baris yang tidak rekonsiliasi. Sheet **Rincian** memuat NIP, nama, departemen, bank dan nomor rekening sebagai teks, komponen pendapatan dan potongan, bruto, net transfer, serta selisih cek. Rekening diambil dari profil HRIS saat export, bukan snapshot saat run dibayar. File ini bukan instruksi transfer bank. Format final tetap harus dicocokkan dengan contoh berkas Finance/bank, termasuk urutan kolom dan aturan pembulatan.

## Import Task Department Tedja

Modul Task Department dan progress sudah ada. Untuk migrasi, minta export Tedja berisi ID sumber, departemen, judul, deskripsi, penanggung jawab, frekuensi/tenggat, status, dan histori progress. Cocokkan departemen dan karyawan dengan NüHabit; tampilkan pratinjau baris yang gagal dipetakan; lalu import sekali dengan ID sumber sebagai kunci anti-duplikasi. Jangan menyalin komentar atau lampiran yang mengandung data pribadi tanpa tinjauan akses.

## Member, credits, dan tier — keputusan yang disarankan

- **Member** berarti akun terdaftar yang dapat booking; akses kelas berasal dari credits atau paket yang dibeli. Personal Training tetap produk dan alur terpisah.
- **Credits kelas** dipotong saat booking terkonfirmasi, dikembalikan bila kelas dibatalkan studio, dan tunduk pada batas pembatalan yang disetujui. Tentukan masa berlaku credits, aturan no-show, dan harga per jenis kelas sebelum dijual.
- **Tier loyalitas** sebaiknya dihitung dari belanja yang benar-benar dibayar, setelah refund, pada jendela 12 bulan berjalan. Mulai dengan tiga tier dan manfaat non-finansial yang mudah dilayani (misalnya prioritas booking), lalu tetapkan ambang rupiah berdasarkan distribusi belanja nyata. Pembelian credits yang belum terpakai tetap dapat dihitung sebagai spending hanya jika Finance menyetujui definisinya.

Keputusan di atas adalah rancangan untuk dibahas, belum aturan aplikasi. Ambang, perks, masa berlaku, pembatalan, dan perlakuan refund harus disahkan sebelum transaksi pelanggan diubah.

## Status butir MOM

| No. | Butir | Status |
| --- | --- | --- |
| 1 | SOP coach | Draf di atas menunggu persetujuan operasional. |
| 2 | Program Director | Label aplikasi dan data awal diperbarui. |
| 3 | Email karyawan | Alur dan konfigurasi disiapkan; akun serta konfirmasi inbox perlu dikerjakan IT/HR. |
| 4 | Hapus run payroll | Hanya superadmin, ditegakkan di server dan UI. |
| 5 | Export penggajian | Draf XLSX tersedia; format final menunggu contoh Finance/bank. |
| 6 | Slip gaji via email | Pengiriman PDF email dibuat; perlu konfigurasi pengirim dan aktivasi email karyawan. |
| 7 | Task Tedja | Modul tujuan tersedia; menunggu export Tedja untuk import. |
| 8 | Sisa slot kelas | Ditampilkan pada jadwal dan detail sesi. |
| 9 | Model member | Rekomendasi di atas menunggu keputusan. |
| 10 | Credits kelas | Rekomendasi di atas menunggu keputusan. |
| 11 | Google Calendar | Tombol pada detail booking mendatang. |
| 12 | Tier spending | Rekomendasi di atas menunggu keputusan dan data spending. |
| 13 | Dataroom | Modul dan halaman sudah tersedia; perlu uji akses dengan akun operasional. |
