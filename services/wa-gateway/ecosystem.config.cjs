// PM2 untuk gateway WhatsApp. Dijalankan terpisah dari aplikasi Next.js supaya
// sesi WhatsApp tidak putus setiap kali aplikasi di-deploy ulang.
//
// Token TIDAK ditulis di sini (file ini masuk git). Node 20+ memuat rahasia
// dari services/wa-gateway/.env yang gitignored lewat --env-file.
module.exports = {
  apps: [
    {
      // Nama khusus BCD: gateway Tedja memakai "wa-gateway"; dua proses tak boleh
      // berbagi nama/port/sesi (satu sesi = satu nomor WhatsApp).
      name: "wa-gateway-bcd",
      cwd: __dirname,
      script: "src/server.js",
      interpreter: "node",
      interpreter_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 20,
      // Jangan pakai watch: restart beruntun membuka koneksi WhatsApp berulang
      // dan menaikkan risiko nomor diblokir.
      watch: false,
    },
  ],
};
