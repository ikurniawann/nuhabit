import { describe, expect, it } from "vitest";
import { formatEvery, reminderLabel } from "./api";

describe("formatEvery", () => {
  it("names the job interval in the largest whole unit", () => {
    expect(formatEvery(60)).toBe("tiap menit");
    expect(formatEvery(300)).toBe("tiap 5 menit");
    expect(formatEvery(3600)).toBe("tiap jam");
    expect(formatEvery(21600)).toBe("tiap 6 jam");
    expect(formatEvery(86400)).toBe("tiap hari");
    expect(formatEvery(45)).toBe("tiap 45 detik");
  });
});

describe("reminderLabel", () => {
  it("labels known reminder kinds and passes unknown ones through", () => {
    expect(reminderLabel("gym_class_reminder")).toBe("Pengingat kelas");
    expect(reminderLabel("custom_kind")).toBe("custom_kind");
  });
});
