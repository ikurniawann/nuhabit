/** Form karir publik: rem spam per IP (audit S1). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/public/rate-limit";

vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn() }));
vi.mock("resend", () => ({ Resend: vi.fn() }));

const submit = async (ip: string) => {
  const { POST } = await import("@/app/api/portal/submit/route");
  const form = new FormData();
  form.set("full_name", "Budi");
  return POST(
    new Request("http://x/api/portal/submit", {
      method: "POST",
      body: form,
      headers: { "cf-connecting-ip": ip },
    }) as never
  );
};

beforeEach(() => resetRateLimits());

describe("POST /api/portal/submit rate limit", () => {
  it("returns 429 after 5 submissions from one IP within the window", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await submit("203.0.113.7")).status).toBe(400);
    }
    expect((await submit("203.0.113.7")).status).toBe(429);
    expect((await submit("198.51.100.1")).status).toBe(400);
  });
});
