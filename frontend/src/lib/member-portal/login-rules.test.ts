import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  LOGIN_INVALID_MESSAGE,
  LOGIN_NO_PASSWORD_MESSAGE,
  validateLoginInput,
} from "./login-rules";

describe("validateLoginInput", () => {
  it("menolak username kosong / terlalu pendek", () => {
    for (const username of [undefined, null, "", "  ", "ab"]) {
      const res = validateLoginInput({ username, password: "rahasia" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.field).toBe("username");
    }
  });

  it("menolak password kosong atau bukan string", () => {
    for (const password of [undefined, null, "", 123]) {
      const res = validateLoginInput({ username: "081200000001", password });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.field).toBe("password");
    }
  });

  it("memangkas spasi username dan mempertahankan password apa adanya", () => {
    const res = validateLoginInput({ username: "  081200000001  ", password: " pa ss " });
    expect(res).toEqual({ ok: true, value: { username: "081200000001", password: " pa ss " } });
  });

  it("menerima password pendek: aturan panjang hanya saat password dibuat", () => {
    const res = validateLoginInput({ username: "member@example.com", password: "123" });
    expect(res.ok).toBe(true);
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("berformat bcrypt dan tidak cocok dengan tebakan umum", async () => {
    const { verifyPassword } = await import("@/lib/auth/password");
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$\d{2}\$/);
    for (const guess of ["", "password", "123456", "nuhabit", "admin"]) {
      expect(await verifyPassword(guess, DUMMY_PASSWORD_HASH)).toBe(false);
    }
  });
});

describe("pesan", () => {
  it("pesan gagal login tidak membocorkan mana yang salah", () => {
    // Yang dilarang: pesan yang menunjuk salah satu field, sehingga penyerang
    // bisa membedakan "akun tidak ada" dari "password salah".
    expect(LOGIN_INVALID_MESSAGE).not.toMatch(/tidak ditemukan|tidak terdaftar|belum terdaftar/i);
    expect(LOGIN_INVALID_MESSAGE).toBe("Username atau password salah");
    expect(LOGIN_NO_PASSWORD_MESSAGE).toMatch(/password/i);
  });
});
