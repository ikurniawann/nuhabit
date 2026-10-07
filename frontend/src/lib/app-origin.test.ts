import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin } from "./app-origin";

const req = (origin: string) => ({ nextUrl: { origin } });

describe("appOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("memakai NEXT_PUBLIC_APP_URL bila diset, tanpa garis miring akhir", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", " https://app.nuhabit.id/ ");
    expect(appOrigin(req("http://10.20.89.5:3000"))).toBe("https://app.nuhabit.id");
  });

  it("membaca NEXT_PUBLIC_BASE_URL (nama lama) bila NEXT_PUBLIC_APP_URL kosong", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://lama.nuhabit.id/");
    expect(appOrigin(req("http://10.20.89.5:3000"))).toBe("https://lama.nuhabit.id");
  });

  it("NEXT_PUBLIC_APP_URL menang atas NEXT_PUBLIC_BASE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.nuhabit.id");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://lama.nuhabit.id");
    expect(appOrigin()).toBe("https://app.nuhabit.id");
  });

  it("tanpa konfigurasi jatuh ke origin request", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    expect(appOrigin(req("http://10.20.89.5:3000"))).toBe("http://10.20.89.5:3000");
  });

  it("tanpa konfigurasi dan tanpa request menghasilkan string kosong", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    expect(appOrigin()).toBe("");
  });
});
