/**
 * Manajer koneksi WhatsApp berbasis Baileys.
 *
 * Ditulis JavaScript polos (ESM) dengan sengaja: service ini harus hidup terus
 * di PM2, dan menghindari langkah build membuat operasionalnya lebih sederhana
 * serta mengurangi cara-cara ia bisa gagal saat restart.
 *
 * Dua hal yang menentukan keandalan gateway ini:
 * 1. Sesi harus persisten — kalau kredensial hilang, nomor wajib scan QR lagi
 *    dan OTP berhenti total sampai ada orang yang menanganinya.
 * 2. Pengiriman harus diberi jeda — mengirim beruntun tanpa jeda adalah pola
 *    paling khas yang memicu WhatsApp memblokir nomor.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

const SESSION_DIR = process.env.WA_SESSION_DIR || new URL("../.session", import.meta.url).pathname;

/** Jeda acak antar pesan (ms) — meniru ritme manusia, menekan risiko blokir. */
const MIN_SEND_GAP_MS = Number(process.env.WA_MIN_GAP_MS || 1500);
const MAX_SEND_GAP_MS = Number(process.env.WA_MAX_GAP_MS || 3500);

const logger = pino({ level: process.env.WA_LOG_LEVEL || "warn" });

/**
 * EPIC-012 Fase B — teruskan pesan (masuk & keluar-manual dari HP) ke app.
 * App yang menyimpan; gateway hanya kurir. Antrean memori + retry ringan
 * supaya pesan tidak hilang saat app sedang restart/deploy.
 */
const APP_INBOUND_URL =
  process.env.APP_INBOUND_URL || "http://127.0.0.1:3459/api/wa/inbound";
const INBOUND_TOKEN = process.env.WA_GATEWAY_TOKEN;
// Backoff bertingkat lalu MENETAP di 60 dtk — tidak pernah menyerah selama
// antrean belum penuh, supaya jendela deploy/restart app (bisa >1 menit)
// tidak menghilangkan pesan customer (temuan review M1).
const FORWARD_RETRY_MS = [2000, 10000, 30000, 60000];
const FORWARD_TIMEOUT_MS = 10000;
const FORWARD_QUEUE_MAX = 2000;

const forwardQueue = [];
let forwardTimer = null;
let forwardAttempt = 0;
let flushing = false;

function extractMessageContent(message) {
  if (!message) return { text: null, mediaType: null };
  // Baileys membungkus beberapa jenis pesan (ephemeral, viewOnce) satu level.
  const inner =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message;

  const text =
    inner.conversation ??
    inner.extendedTextMessage?.text ??
    inner.imageMessage?.caption ??
    inner.videoMessage?.caption ??
    inner.documentMessage?.caption ??
    null;

  let mediaType = null;
  if (inner.imageMessage) mediaType = "image";
  else if (inner.videoMessage) mediaType = "video";
  else if (inner.audioMessage) mediaType = "audio";
  else if (inner.documentMessage) mediaType = "document";
  else if (inner.stickerMessage) mediaType = "sticker";

  return { text, mediaType };
}

async function flushForwardQueue() {
  if (flushing || forwardQueue.length === 0) return;
  flushing = true;

  try {
    while (forwardQueue.length > 0) {
      const batch = forwardQueue.slice(0, 50);
      try {
        const response = await fetch(APP_INBOUND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gateway-token": INBOUND_TOKEN ?? "",
          },
          body: JSON.stringify({ messages: batch }),
          signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        forwardQueue.splice(0, batch.length);
        forwardAttempt = 0;
      } catch (error) {
        // Jangan buang batch — jadwalkan ulang dengan backoff (menetap di
        // interval terakhir). Antrean tetap utuh untuk percobaan berikutnya.
        const delay =
          FORWARD_RETRY_MS[Math.min(forwardAttempt, FORWARD_RETRY_MS.length - 1)];
        forwardAttempt += 1;
        if (forwardAttempt === 1 || forwardAttempt % 10 === 0) {
          console.warn(
            `[wa-gateway] App belum bisa menerima ${forwardQueue.length} pesan ` +
              `(percobaan ${forwardAttempt}): ${error?.message ?? error}. Coba lagi ${delay / 1000}s.`
          );
        }
        if (!forwardTimer) {
          forwardTimer = setTimeout(() => {
            forwardTimer = null;
            flushForwardQueue().catch(() => undefined);
          }, delay);
        }
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

function enqueueForward(payload) {
  if (forwardQueue.length >= FORWARD_QUEUE_MAX) {
    // Batas pengaman memori; pesan tertua dibuang dengan log jelas.
    forwardQueue.shift();
    console.error(
      `[wa-gateway] Antrean forward penuh (${FORWARD_QUEUE_MAX}) — pesan tertua dibuang.`
    );
  }
  forwardQueue.push(payload);
  // Debounce singkat agar burst pesan terkirim satu batch.
  if (!forwardTimer && !flushing) {
    forwardTimer = setTimeout(() => {
      forwardTimer = null;
      flushForwardQueue().catch(() => undefined);
    }, 300);
  }
}

const state = {
  socket: null,
  connected: false,
  /** QR terakhir yang belum dipakai — dibaca lewat GET /qr saat pairing. */
  qr: null,
  phone: null,
  lastConnectedAt: null,
  lastDisconnectReason: null,
  startedAt: new Date().toISOString(),
};

/** Antrean serial: satu pesan pada satu waktu, selalu berjeda. */
let sendChain = Promise.resolve();
let lastSentAt = 0;

function randomGap() {
  return MIN_SEND_GAP_MS + Math.floor(Math.random() * (MAX_SEND_GAP_MS - MIN_SEND_GAP_MS + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ubah nomor jadi JID WhatsApp. Input diharapkan digit 62xxx. */
export function toJid(target) {
  const digits = String(target || "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  if (normalized.length < 10 || normalized.length > 15) return null;
  return `${normalized}@s.whatsapp.net`;
}

export function getStatus() {
  return {
    connected: state.connected,
    phone: state.phone,
    needsPairing: Boolean(state.qr) && !state.connected,
    lastConnectedAt: state.lastConnectedAt,
    lastDisconnectReason: state.lastDisconnectReason,
    startedAt: state.startedAt,
  };
}

export function getQr() {
  return state.qr;
}

export async function connect() {
  // Fungsi Baileys, bukan React hook; namanya saja diawali "use".
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: authState,
    logger,
    // Gateway tidak membaca chat; menandai online justru membuat notifikasi HP
    // pemilik nomor jadi kacau.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  state.socket = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (process.env.WA_DEBUG_UPSERT === "1") {
      console.log(
        `[wa-gateway][debug] upsert type=${type} n=${messages?.length ?? 0} ` +
          (messages ?? [])
            .map((m) => `${m?.key?.remoteJid}|alt=${m?.key?.remoteJidAlt ?? m?.key?.senderPn ?? "-"}|fromMe=${m?.key?.fromMe}`)
            .join(" ; ")
      );
    }
    // "notify" = pesan baru real-time; append/history sync dilewati agar
    // riwayat lama HP tidak membanjiri app.
    if (type !== "notify") return;

    for (const item of messages ?? []) {
      const key = item?.key ?? {};
      // WhatsApp kini memakai LID (@lid) untuk sebagian chat; nomor aslinya
      // dititipkan di remoteJidAlt / senderPn. Pakai itu bila remoteJid
      // bukan JID nomor biasa.
      let jid = key.remoteJid ?? "";
      if (!jid.endsWith("@s.whatsapp.net")) {
        const alt = key.remoteJidAlt ?? key.senderPn ?? "";
        if (alt.endsWith("@s.whatsapp.net")) jid = alt;
        else continue; // grup/status/newsletter/lid tanpa nomor
      }

      const { text, mediaType } = extractMessageContent(item.message);
      if (!text && !mediaType) continue; // reaksi/protokol/receipt

      enqueueForward({
        remoteJid: jid,
        fromMe: Boolean(key.fromMe),
        messageId: key.id ?? null,
        timestamp: Number(item.messageTimestamp) || null,
        text,
        mediaType,
        pushName: item.pushName ?? null,
      });
    }
  });

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.qr = qr;
      console.log("[wa-gateway] QR pairing tersedia. Pindai dengan WhatsApp nomor pengirim:");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      state.connected = true;
      state.qr = null;
      state.lastConnectedAt = new Date().toISOString();
      state.lastDisconnectReason = null;
      state.phone = socket.user?.id?.split(":")[0] ?? null;
      console.log(`[wa-gateway] Terhubung sebagai ${state.phone}`);
    }

    if (connection === "close") {
      state.connected = false;
      // Baileys membungkus error dengan Boom; statusCode dibaca langsung
      // agar tidak bergantung pada @hapi/boom yang cuma dependensi transitif.
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      state.lastDisconnectReason = String(statusCode ?? "unknown");

      // loggedOut = sesi dicabut dari HP; scan ulang wajib, reconnect percuma.
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.warn(
        `[wa-gateway] Terputus (alasan ${state.lastDisconnectReason}).` +
          (loggedOut
            ? " Sesi dicabut — hapus .session lalu pairing ulang."
            : " Mencoba sambung ulang...")
      );

      if (!loggedOut) {
        setTimeout(() => {
          connect().catch((error) =>
            console.error("[wa-gateway] Gagal sambung ulang:", error?.message ?? error)
          );
        }, 3000);
      }
    }
  });

  return socket;
}

/**
 * Kirim pesan teks. Dijalankan serial dengan jeda acak antar pesan.
 * Mengembalikan objek hasil, tidak melempar, agar pemanggil HTTP mudah.
 */
export function sendText(target, message) {
  const jid = toJid(target);
  if (!jid) {
    return Promise.resolve({ success: false, reason: "Nomor tujuan tidak valid" });
  }
  if (!message || !String(message).trim()) {
    return Promise.resolve({ success: false, reason: "Pesan kosong" });
  }

  const task = sendChain.then(async () => {
    if (!state.connected || !state.socket) {
      return { success: false, reason: "WhatsApp belum terhubung" };
    }

    const gap = randomGap();
    const sinceLast = Date.now() - lastSentAt;
    if (sinceLast < gap) await sleep(gap - sinceLast);

    try {
      const result = await state.socket.sendMessage(jid, { text: String(message) });
      lastSentAt = Date.now();
      return { success: true, messageId: result?.key?.id ?? null };
    } catch (error) {
      lastSentAt = Date.now();
      return { success: false, reason: error?.message ?? "Gagal mengirim" };
    }
  });

  // Rantai tidak boleh putus walau satu tugas gagal.
  sendChain = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
