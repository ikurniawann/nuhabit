import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { decodeSnapshot } from "./proctor-events";
import { offerResponseDescription } from "./offer-session";
import { assertBodySize, isLinkExpired, isPortalToken, parseJsonBody } from "./route-helpers";

const jsonReq = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body, headers });

const rejection = async (p: Promise<unknown>) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
};

describe("parseJsonBody", () => {
  const schema = z.object({ answers: z.object({ a: z.string().min(1, "wajib") }) });

  it("galat berbunyi path: pesan", async () => {
    const err = await rejection(parseJsonBody(jsonReq('{"answers":{"a":""}}'), schema));
    expect(err.status).toBe(400);
    expect(err.message).toBe("answers.a: wajib");
  });

  it("pesan tetap bila diminta; JSON rusak juga 400", async () => {
    const err = await rejection(parseJsonBody(jsonReq("{oops"), schema, "Payload tidak valid"));
    expect(err.message).toBe("Payload tidak valid");
  });

  it("data valid dikembalikan", async () => {
    await expect(parseJsonBody(jsonReq('{"answers":{"a":"x"}}'), schema)).resolves.toEqual({ answers: { a: "x" } });
  });
});

it("assertBodySize menolak Content-Length di atas batas dgn 413", () => {
  expect(() => assertBodySize(jsonReq("{}", { "content-length": "11" }), 10)).toThrow(ApiError);
  expect(() => assertBodySize(jsonReq("{}", { "content-length": "10" }), 10)).not.toThrow();
});

it("decodeSnapshot memisah mime dan isi base64", () => {
  const { mime, buffer } = decodeSnapshot(`data:image/png;base64,${Buffer.from("hi").toString("base64")}`);
  expect(mime).toBe("image/png");
  expect(buffer.toString()).toBe("hi");
});

it("offerResponseDescription memotong catatan 300 karakter", () => {
  expect(offerResponseDescription("decline", 1, null)).toBe("Kandidat menolak offer v1 via portal");
  const long = offerResponseDescription("negotiate", 3, "x".repeat(400));
  expect(long).toBe(`Kandidat mengajukan negosiasi offer v3 via portal — "${"x".repeat(300)}"`);
});

describe("link portal kandidat", () => {
  const DAY = 86_400_000;
  const now = Date.parse("2026-10-04T00:00:00Z");

  it("token hanya hex 48–128 karakter", () => {
    expect(isPortalToken("a".repeat(48))).toBe(true);
    expect(isPortalToken("a".repeat(47))).toBe(false);
    expect(isPortalToken(`${"a".repeat(47)}/`)).toBe(false);
  });

  it("expires_at menentukan masa berlaku", () => {
    expect(isLinkExpired({ expires_at: "2026-10-03T23:59:59Z", issued_at: null }, DAY, now)).toBe(true);
    expect(isLinkExpired({ expires_at: "2026-10-05T00:00:00Z", issued_at: null }, DAY, now)).toBe(false);
  });

  it("expires_at NULL memakai waktu terbit + umur maksimum, bukan abadi", () => {
    expect(isLinkExpired({ expires_at: null, issued_at: "2026-10-01T00:00:00Z" }, DAY, now)).toBe(true);
    expect(isLinkExpired({ expires_at: null, issued_at: "2026-10-03T12:00:00Z" }, DAY, now)).toBe(false);
    expect(isLinkExpired({ expires_at: null, issued_at: null }, DAY, now)).toBe(true);
  });
});
