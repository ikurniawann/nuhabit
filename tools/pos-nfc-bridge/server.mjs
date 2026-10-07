#!/usr/bin/env node
/**
 * Local PC/SC → WebSocket bridge for ACS ACR1555 (and compatible) readers.
 * Run: npm run pos:nfc-bridge
 * Browser connects to ws://127.0.0.1:8787
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import pcsclite from "@pokusew/pcsclite";

const HOST = "127.0.0.1";
const PORT = Number(process.env.POS_NFC_BRIDGE_PORT || 8787);
const GET_UID = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);

function parseUidFromTransmit(data) {
  if (!data || data.length < 3) return null;
  const sw1 = data[data.length - 2];
  const sw2 = data[data.length - 1];
  if (sw1 !== 0x90 || sw2 !== 0x00) return null;
  const uid = data.subarray(0, data.length - 2);
  if (!uid.length) return null;
  return Buffer.from(uid).toString("hex").toUpperCase();
}

function nextCardPresence({ hadCard, hasCard }) {
  if (hasCard && !hadCard) return { hadCard: true, emit: true };
  if (!hasCard) return { hadCard: false, emit: false };
  return { hadCard: true, emit: false };
}

const clients = new Set();

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(raw);
  }
  console.log("[pos-nfc-bridge]", payload);
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "pos-nfc-bridge", port: PORT }));
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", service: "pos-nfc-bridge" }));
  ws.on("close", () => clients.delete(ws));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[pos-nfc-bridge] listening on ws://${HOST}:${PORT}`);
});

const pcsc = pcsclite();

pcsc.on("reader", (reader) => {
  console.log(`[pos-nfc-bridge] reader connected: ${reader.name}`);
  let hadCard = false;

  reader.on("error", (err) => {
    console.error(`[pos-nfc-bridge] reader error (${reader.name}):`, err.message);
  });

  reader.on("end", () => {
    console.log(`[pos-nfc-bridge] reader removed: ${reader.name}`);
    hadCard = false;
  });

  reader.on("status", (status) => {
    const changes = reader.state ^ status.state;
    if (!changes) return;

    if (changes & reader.SCARD_STATE_EMPTY && status.state & reader.SCARD_STATE_EMPTY) {
      const edge = nextCardPresence({ hadCard, hasCard: false });
      hadCard = edge.hadCard;
      broadcast({ type: "card_removed", reader: reader.name });
      return;
    }

    if (changes & reader.SCARD_STATE_PRESENT && status.state & reader.SCARD_STATE_PRESENT) {
      const edge = nextCardPresence({ hadCard, hasCard: true });
      hadCard = edge.hadCard;
      if (!edge.emit) return;

      reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (connectErr, protocol) => {
        if (connectErr) {
          // Secondary interface (e.g. SAM) often reports present without a usable card.
          const msg = connectErr.message || String(connectErr);
          if (/no smart card/i.test(msg)) {
            hadCard = false;
            return;
          }
          console.error("[pos-nfc-bridge] connect failed:", msg);
          broadcast({ type: "error", message: msg });
          return;
        }

        reader.transmit(GET_UID, 40, protocol, (txErr, data) => {
          const disconnect = () => {
            reader.disconnect(reader.SCARD_LEAVE_CARD, () => {});
          };

          if (txErr) {
            console.error("[pos-nfc-bridge] transmit failed:", txErr.message);
            broadcast({ type: "error", message: txErr.message });
            disconnect();
            return;
          }

          const uid = parseUidFromTransmit(data);
          if (!uid) {
            broadcast({
              type: "error",
              message: "UID read failed",
              raw: Buffer.from(data || []).toString("hex"),
            });
            disconnect();
            return;
          }

          broadcast({
            type: "card",
            uid,
            reader: reader.name,
            atr: status.atr ? Buffer.from(status.atr).toString("hex") : null,
          });
          disconnect();
        });
      });
    }
  });
});

pcsc.on("error", (err) => {
  console.error("[pos-nfc-bridge] pcsc error:", err.message);
});

process.on("SIGINT", () => {
  pcsc.close();
  httpServer.close();
  process.exit(0);
});
