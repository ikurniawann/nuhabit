import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { computeGobizSignature, verifyGobizSignature } from "./signature";

describe("verifyGobizSignature", () => {
  const body = '{"header":{"event_id":"e1"}}';
  const secret = "96a0-test-secret";
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("HMAC-SHA256 hex atas raw body (contoh NodeJS di docs GoBiz)", () => {
    expect(computeGobizSignature(body, secret)).toBe(good);
    expect(verifyGobizSignature(body, good, secret)).toBe("valid");
    expect(verifyGobizSignature(body, good.toUpperCase(), secret)).toBe("valid");
  });

  it("body diubah / tanda tangan salah / absen / secret kosong", () => {
    expect(verifyGobizSignature(body.replace("e1", "e2"), good, secret)).toBe("invalid");
    expect(verifyGobizSignature(body, "abc", secret)).toBe("invalid");
    expect(verifyGobizSignature(body, null, secret)).toBe("missing");
    expect(verifyGobizSignature(body, good, "")).toBe("unconfigured");
  });
});
