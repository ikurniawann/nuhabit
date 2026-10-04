// Link Dataroom ber-PIN: kegagalan dihitung per link di DB (bertahan saat
// restart, tak bisa diakali ganti IP); cookie Secure mengikuti request.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyPin = vi.fn();
const findActiveLock = vi.fn();
const recordFailure = vi.fn();
const clearFailures = vi.fn();
const share = {
  id: "sh-1", token: "t".repeat(24), access_type: "public", pin_hash: "$2hash", expires_at: "2099-01-01T00:00:00Z",
};

vi.mock("@/lib/dataroom/api", () => ({
  resolveShareContext: vi.fn(async () => ({
    ok: true, share, root: {}, session: null, steps: { needEmail: false, needPin: true }, verified: false,
  })),
}));
vi.mock("@/lib/dataroom/shares", async (orig) => ({
  ...(await orig<typeof import("@/lib/dataroom/shares")>()),
  verifyPin: (...a: unknown[]) => verifyPin(...a),
  logShareAccess: vi.fn(),
  upsertSession: vi.fn(async () => ({
    session_token: "s".repeat(32), expires_at: "2099-01-01T00:00:00Z", email_ok: false, pin_ok: true,
  })),
}));
vi.mock("@/lib/security/attempt-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/attempt-limit")>()),
  findActiveLock: (...a: unknown[]) => findActiveLock(...a),
  recordFailure: (...a: unknown[]) => recordFailure(...a),
  clearFailures: (...a: unknown[]) => clearFailures(...a),
}));

async function post(pin: string, url = "https://sulu.example.com/api/share/x/verify", ip = "203.0.113.1") {
  const { POST } = await import("./route");
  const req = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, host: new URL(url).host },
    body: JSON.stringify({ pin }),
  });
  return POST(req, { params: Promise.resolve({ token: share.token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  findActiveLock.mockResolvedValue(null);
  recordFailure.mockResolvedValue(null);
});

describe("POST /api/share/[token]/verify (PIN)", () => {
  it("PIN salah → dicatat per link; kegagalan ke-5 mengunci (429)", async () => {
    verifyPin.mockResolvedValue(false);
    expect((await post("1111")).status).toBe(400);
    expect(recordFailure).toHaveBeenCalledWith("dataroom_share_pin", ["share:sh-1"], expect.objectContaining({ maxFailures: 5 }));
    recordFailure.mockResolvedValue(new Date(Date.now() + 30 * 60_000));
    expect((await post("2222", undefined, "198.51.100.7")).status).toBe(429);
  });

  it("terkunci → PIN tidak dicek, bahkan dari IP lain", async () => {
    findActiveLock.mockResolvedValue(new Date(Date.now() + 5 * 60_000));
    const res = await post("1234", undefined, "192.0.2.50");
    expect(res.status).toBe(429);
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("PIN benar → hitungan dibersihkan; cookie Secure di https", async () => {
    verifyPin.mockResolvedValue(true);
    const res = await post("1234");
    expect(res.status).toBe(200);
    expect(clearFailures).toHaveBeenCalledWith("dataroom_share_pin", ["share:sh-1"]);
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("akses langsung lewat IP LAN http → cookie tanpa Secure (tetap bisa dipakai)", async () => {
    verifyPin.mockResolvedValue(true);
    const res = await post("1234", "http://10.20.89.5:3000/api/share/x/verify");
    expect(res.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });
});
