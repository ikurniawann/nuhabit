import { describe, expect, it } from "vitest";
import { clientIp, clientIpFromHeaders } from "./client-ip";
import { clientIpFrom } from "@/lib/public/rate-limit";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("clientIp", () => {
  it("cf-connecting-ip (diisi edge Cloudflare) menang atas x-forwarded-for kiriman klien", () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
  });

  it("jalur langsung: nilai paling kiri x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": " 10.20.89.9 , 10.0.0.1" }))).toBe("10.20.89.9");
  });

  it("cadangan x-real-ip lalu 'unknown'", () => {
    expect(clientIp(req({ "x-real-ip": "10.1.1.1" }))).toBe("10.1.1.1");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("rate limiter publik memakai aturan yang sama", () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" });
    expect(clientIpFrom(headers)).toBe(clientIpFromHeaders(headers));
  });
});
