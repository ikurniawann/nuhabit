/**
 * HTTP API gateway WhatsApp.
 *
 * Keamanan: server ini HANYA mendengar di 127.0.0.1 dan setiap permintaan
 * wajib membawa header `x-gateway-token`. Ia tidak boleh diekspos ke internet —
 * siapa pun yang bisa memanggilnya bisa mengirim WhatsApp atas nama bisnis.
 */

import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { connect, getQr, getStatus, sendText } from "./wa.js";

const PORT = Number(process.env.WA_GATEWAY_PORT || 3471);
const HOST = "127.0.0.1";
/**
 * Alamat TAMBAHAN untuk mendengar — dipakai agar container Docker (aplikasi
 * yang di-deploy CI) bisa menjangkau gateway lewat IP bridge Docker
 * (host.docker.internal → biasanya 172.17.0.1). loopback host tidak terlihat
 * dari dalam container, jadi tanpa ini fitur WA mati begitu aplikasi pindah
 * dari PM2 ke Docker.
 *
 * Tetap BUKAN ekspos internet: 172.17.0.1 hanya terjangkau dari host dan
 * container di mesin ini, dan setiap permintaan tetap wajib ber-token.
 * Kosongkan env-nya untuk kembali ke loopback murni.
 */
const EXTRA_HOSTS = (process.env.WA_GATEWAY_EXTRA_HOSTS || "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const TOKEN = process.env.WA_GATEWAY_TOKEN;

if (!TOKEN) {
  console.error(
    "[wa-gateway] WA_GATEWAY_TOKEN wajib diisi — menolak berjalan tanpa autentikasi."
  );
  process.exit(1);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Payload terlalu besar"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // /health sengaja dibuka tanpa token supaya monitoring sederhana tetap bisa
  // memeriksa proses hidup — isinya tidak sensitif.
  if (req.method === "GET" && url.pathname === "/health") {
    const status = getStatus();
    return json(res, status.connected ? 200 : 503, status);
  }

  const provided = req.headers["x-gateway-token"];
  const providedBuf = Buffer.from(typeof provided === "string" ? provided : "");
  const expectedBuf = Buffer.from(TOKEN);
  const authorized =
    providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  if (!authorized) {
    return json(res, 401, { success: false, error: "Unauthorized" });
  }

  if (req.method === "GET" && url.pathname === "/qr") {
    const qr = getQr();
    if (!qr) {
      return json(res, 404, {
        success: false,
        error: getStatus().connected
          ? "Sudah terhubung — tidak perlu pairing"
          : "QR belum tersedia, coba lagi sesaat lagi",
      });
    }
    return json(res, 200, { success: true, qr });
  }

  if (req.method === "POST" && url.pathname === "/send") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { success: false, error: "JSON tidak valid" });
    }

    const result = await sendText(payload?.target, payload?.message);
    return json(res, result.success ? 200 : 502, {
      success: result.success,
      error: result.success ? undefined : result.reason,
      messageId: result.messageId,
    });
  }

  return json(res, 404, { success: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[wa-gateway] Mendengar di http://${HOST}:${PORT}`);
});

// Listener tambahan berbagi handler yang sama — request-nya identik, hanya
// alamat masuknya yang berbeda. Gagal bind di salah satu alamat (mis. docker
// belum jalan sehingga 172.18.0.1 tidak ada) tidak mematikan listener utama.
//
// Setelah reboot server, PM2 menyalakan gateway SEBELUM bridge Docker siap →
// EADDRNOTAVAIL. Dulu tidak dicoba ulang, sehingga container app (poskopi)
// tidak bisa menjangkau gateway sampai di-restart manual (insiden 2026-10-01).
// Kini dicoba ulang dgn jeda bertahap (5 dtk → maks 60 dtk) sampai berhasil.
const EXTRA_RETRY_MIN_MS = 5_000;
const EXTRA_RETRY_MAX_MS = 60_000;

function listenExtra(extraHost, attempt = 0) {
  const extra = http.createServer(server.listeners("request")[0]);
  extra.once("error", (error) => {
    const delay = Math.min(EXTRA_RETRY_MAX_MS, EXTRA_RETRY_MIN_MS * 2 ** Math.min(attempt, 4));
    console.error(
      `[wa-gateway] Gagal mendengar di ${extraHost}:${PORT}: ${error?.message ?? error} — coba lagi dalam ${delay / 1000} dtk`
    );
    extra.close();
    setTimeout(() => listenExtra(extraHost, attempt + 1), delay).unref();
  });
  extra.listen(PORT, extraHost, () => {
    console.log(
      `[wa-gateway] Mendengar juga di http://${extraHost}:${PORT}${attempt > 0 ? ` (setelah ${attempt} percobaan ulang)` : ""}`
    );
  });
}

for (const extraHost of EXTRA_HOSTS) {
  listenExtra(extraHost);
}

connect().catch((error) => {
  console.error("[wa-gateway] Gagal memulai koneksi WhatsApp:", error?.message ?? error);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[wa-gateway] ${signal} diterima, menutup server...`);
    server.close(() => process.exit(0));
  });
}
