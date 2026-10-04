import { describe, expect, it } from "vitest";
import { createShiftSchema } from "./shifts-repo";

const firstMessage = (data: unknown) => {
  const parsed = createShiftSchema.safeParse(data);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("createShiftSchema", () => {
  it("pesan validasi lama", () => {
    expect(firstMessage({ start_time: "08:00", end_time: "16:00" })).toBe("Nama shift wajib diisi");
    expect(firstMessage({ name: "Pagi", start_time: "8", end_time: "16:00" })).toBe(
      "Jam mulai tidak valid (HH:MM)"
    );
    expect(firstMessage({ name: "Pagi", start_time: "08:00", end_time: "16:00", late_tolerance_minutes: -1 })).toBe(
      "Toleransi terlambat harus angka ≥ 0"
    );
  });

  it("jam selesai sebelum mulai hanya boleh untuk shift malam", () => {
    expect(firstMessage({ name: "Malam", start_time: "22:00", end_time: "06:00" })).toMatch(
      /^Jam selesai harus setelah jam mulai/
    );
    expect(firstMessage({ name: "Malam", start_time: "22:00", end_time: "06:00", is_overnight: true })).toBeNull();
  });

  it("nama di-trim", () => {
    const parsed = createShiftSchema.parse({ name: "  Pagi ", start_time: "08:00", end_time: "16:00:00" });
    expect(parsed.name).toBe("Pagi");
  });
});
