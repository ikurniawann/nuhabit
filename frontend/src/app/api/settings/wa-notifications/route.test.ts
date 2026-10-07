import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});

const store = new Map<string, string | null>();
const setSetting = vi.fn(async (key: string, value: string | null) => {
  store.set(key, value);
});
vi.mock("@/lib/settings/app-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/app-settings")>();
  return {
    ...actual,
    getSetting: async (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string | null) => setSetting(key, value),
  };
});

function put(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  requireIamMenuPrefix.mockResolvedValue({ id: "u-1" });
});

describe("/api/settings/wa-notifications", () => {
  it("403 dari guard", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(403);
  });

  it("PUT parsial menyimpan nomor ternormalisasi tanpa menghapus field lain", async () => {
    const { GET, PUT } = await import("./route");
    const res = await PUT(put({ recipients: ["0812-3456-7890", "6281234567890"], digestHour: 7 }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.config.recipients).toEqual(["6281234567890"]);
    expect(data.config.digestHour).toBe(7);

    const again = await (await PUT(put({ enabled: true }))).json();
    expect(again.data.config.recipients).toEqual(["6281234567890"]);
    expect((await (await GET()).json()).data.config.enabled).toBe(true);
  });

  it("400 berpesan untuk nilai tidak valid, tidak ada yang tersimpan", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(put({ digestHour: 24 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jam ringkasan harus 0-23 (WIB)");
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("penerima laporan tutup kasir disaring dan disimpan terpisah", async () => {
    const { GET, PUT } = await import("./route");
    await PUT(put({ shift_report_recipients: ["0812 3456 789", "123", "0812 3456 789"] }));
    const { data } = await (await GET()).json();
    expect(data.shift_report_recipients).toEqual(["08123456789"]);
  });
});
