import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  isWithinReplyWindow,
  normalizeInstagramWebhook,
  replyWindowRemainingMs,
  resolveSubscribeChallenge,
  verifySignature,
} from "./webhook";

const SECRET = "rahasia-app-meta";
const sign = (body: string) =>
  "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

describe("verifySignature", () => {
  it("menerima tanda tangan yang benar", () => {
    const body = '{"object":"instagram"}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("menolak bila body diubah walau satu karakter", () => {
    const body = '{"object":"instagram"}';
    const signature = sign(body);
    expect(verifySignature(body + " ", signature, SECRET)).toBe(false);
  });

  it("menolak tanda tangan dengan app secret berbeda", () => {
    const body = '{"a":1}';
    const lain = "sha256=" + createHmac("sha256", "salah").update(body).digest("hex");
    expect(verifySignature(body, lain, SECRET)).toBe(false);
  });

  it("menolak header kosong maupun secret kosong", () => {
    const body = '{"a":1}';
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });

  it("menolak header dengan panjang berbeda tanpa melempar", () => {
    expect(() => verifySignature("{}", "sha256=pendek", SECRET)).not.toThrow();
    expect(verifySignature("{}", "sha256=pendek", SECRET)).toBe(false);
  });
});

describe("resolveSubscribeChallenge", () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it("mengembalikan challenge saat mode & token cocok", () => {
    const p = params({
      "hub.mode": "subscribe",
      "hub.verify_token": "token-uji",
      "hub.challenge": "12345",
    });
    expect(resolveSubscribeChallenge(p, "token-uji")).toBe("12345");
  });

  it("menolak token yang salah", () => {
    const p = params({
      "hub.mode": "subscribe",
      "hub.verify_token": "salah",
      "hub.challenge": "12345",
    });
    expect(resolveSubscribeChallenge(p, "token-uji")).toBeNull();
  });

  it("menolak saat verify token belum dikonfigurasi", () => {
    const p = params({
      "hub.mode": "subscribe",
      "hub.verify_token": "",
      "hub.challenge": "12345",
    });
    expect(resolveSubscribeChallenge(p, "")).toBeNull();
  });
});

describe("normalizeInstagramWebhook", () => {
  const pesan = (over: Record<string, unknown> = {}) => ({
    object: "instagram",
    entry: [
      {
        messaging: [
          {
            sender: { id: "IGSID-PELANGGAN" },
            recipient: { id: "IG-AKUN-BISNIS" },
            timestamp: 1_700_000_000_000,
            message: { mid: "mid-1", text: "halo", ...over },
          },
        ],
      },
    ],
  });

  it("memetakan pesan masuk ke bentuk internal", () => {
    const [msg] = normalizeInstagramWebhook(pesan());
    expect(msg.channel).toBe("instagram");
    expect(msg.externalId).toBe("IGSID-PELANGGAN");
    expect(msg.direction).toBe("in");
    expect(msg.body).toBe("halo");
    expect(msg.phone).toBeNull();
    expect(msg.providerMessageId).toBe("mid-1");
  });

  it("memakai recipient sebagai lawan bicara pada pesan echo", () => {
    // Echo adalah pesan yang kita kirim sendiri; sender-nya akun bisnis.
    const [msg] = normalizeInstagramWebhook({
      object: "instagram",
      entry: [
        {
          messaging: [
            {
              sender: { id: "IG-AKUN-BISNIS" },
              recipient: { id: "IGSID-PELANGGAN" },
              message: { mid: "mid-2", text: "balasan", is_echo: true },
            },
          ],
        },
      ],
    });
    expect(msg.direction).toBe("out");
    expect(msg.externalId).toBe("IGSID-PELANGGAN");
  });

  it("mengabaikan payload dari objek selain instagram", () => {
    expect(normalizeInstagramWebhook({ object: "page", entry: [] })).toHaveLength(0);
  });

  it("melewati pesan terhapus dan event tanpa isi", () => {
    expect(normalizeInstagramWebhook(pesan({ is_deleted: true }))).toHaveLength(0);
    expect(
      normalizeInstagramWebhook({
        object: "instagram",
        entry: [{ messaging: [{ sender: { id: "X" }, message: {} }] }],
      })
    ).toHaveLength(0);
  });

  it("menyimpan jenis lampiran untuk pesan non-teks", () => {
    const [msg] = normalizeInstagramWebhook(
      pesan({ text: undefined, attachments: [{ type: "image" }] })
    );
    expect(msg.mediaType).toBe("image");
    expect(msg.body).toBeNull();
  });

  it("menampung banyak entry dan banyak pesan sekaligus", () => {
    const hasil = normalizeInstagramWebhook({
      object: "instagram",
      entry: [
        { messaging: [{ sender: { id: "A" }, message: { mid: "1", text: "a" } }] },
        {
          messaging: [
            { sender: { id: "B" }, message: { mid: "2", text: "b" } },
            { sender: { id: "C" }, message: { mid: "3", text: "c" } },
          ],
        },
      ],
    });
    expect(hasil.map((m) => m.externalId)).toEqual(["A", "B", "C"]);
  });

  it("tidak melempar pada payload cacat", () => {
    expect(() => normalizeInstagramWebhook({} as never)).not.toThrow();
    expect(normalizeInstagramWebhook({ object: "instagram" })).toHaveLength(0);
  });
});

describe("jendela balas 24 jam", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("masih terbuka sebelum 24 jam", () => {
    const masuk = new Date("2026-07-20T00:00:00Z"); // 12 jam lalu
    expect(isWithinReplyWindow(masuk, now)).toBe(true);
    expect(replyWindowRemainingMs(masuk, now)).toBe(12 * 60 * 60 * 1000);
  });

  it("tertutup tepat pada 24 jam", () => {
    const masuk = new Date("2026-07-19T12:00:00Z");
    expect(isWithinReplyWindow(masuk, now)).toBe(false);
    expect(replyWindowRemainingMs(masuk, now)).toBe(0);
  });

  it("tertutup bila belum pernah ada pesan masuk", () => {
    expect(isWithinReplyWindow(null, now)).toBe(false);
  });
});
