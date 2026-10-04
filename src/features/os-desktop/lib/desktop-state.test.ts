import { describe, expect, it } from "vitest";
import { emptyDesktopOverview, type DesktopOverview } from "@/lib/desktop/overview";
import { EMPTY_ACTIVITY_FEED, MAX_POPUPS, activityFeedReducer } from "./activity-feed";
import { buildMonthCells, deltaPct, formatRupiah, formatTanggalPendek } from "./format";
import { DESKTOP_MODULES, filterModules, moduleHref } from "./modules";
import { CLOSED_PANELS, panelReducer } from "./panels";
import { addWaRecipient, parseBoundedInt } from "./wa-recipients";

function overviewWithLeaves(cuti: number): DesktopOverview {
  const base = emptyDesktopOverview();
  return {
    ...base,
    dibuatPada: "2026-10-04T02:00:00.000Z",
    perluKeputusan: { cuti, lembur: 0, pinjaman: 0, poDraft: 0, kandidatBaru: 0, total: cuti },
  };
}

describe("panelReducer", () => {
  it("open/close/toggle", () => {
    const opened = panelReducer(CLOSED_PANELS, { type: "open", panel: "settings" });
    expect(opened.settings).toBe(true);
    expect(panelReducer(opened, { type: "open", panel: "settings" })).toBe(opened);
    expect(panelReducer(opened, { type: "close", panel: "settings" }).settings).toBe(false);
    expect(panelReducer(opened, { type: "toggle", panel: "today" }).today).toBe(true);
  });

  it("escape menutup lapisan sementara saja", () => {
    const state = { ...CLOSED_PANELS, command: true, library: true, notifications: true, assistantShortcut: true, settings: true };
    const next = panelReducer(state, { type: "escape" });
    expect(next).toMatchObject({ command: false, library: false, notifications: false, assistantShortcut: false, settings: true });
    expect(panelReducer(CLOSED_PANELS, { type: "escape" })).toBe(CLOSED_PANELS);
  });
});

describe("activityFeedReducer", () => {
  it("snapshot pertama melaporkan antrean, berikutnya hanya kenaikan", () => {
    let state = activityFeedReducer(EMPTY_ACTIVITY_FEED, { type: "snapshot", overview: overviewWithLeaves(2) });
    expect(state.history).toHaveLength(1);
    expect(state.popups).toHaveLength(1);
    state = activityFeedReducer(state, { type: "snapshot", overview: overviewWithLeaves(2) });
    expect(state.history).toHaveLength(1);
    state = activityFeedReducer(state, { type: "snapshot", overview: overviewWithLeaves(5) });
    expect(state.history).toHaveLength(2);
    expect(state.history[0].text).toContain("3");
  });

  it("popup dibatasi dan bisa ditutup; clear hanya mengosongkan riwayat", () => {
    let state = EMPTY_ACTIVITY_FEED;
    for (let cuti = 1; cuti <= MAX_POPUPS + 2; cuti++) {
      state = activityFeedReducer(state, { type: "snapshot", overview: overviewWithLeaves(cuti) });
    }
    expect(state.popups).toHaveLength(MAX_POPUPS);
    const dismissed = activityFeedReducer(state, { type: "dismiss", id: state.popups[0].id });
    expect(dismissed.popups).toHaveLength(MAX_POPUPS - 1);
    const cleared = activityFeedReducer(state, { type: "clear" });
    expect(cleared.history).toEqual([]);
    expect(cleared.popups).toHaveLength(MAX_POPUPS);
  });
});

describe("modules", () => {
  it("tamu diarahkan ke login, pengguna masuk ke dashboard", () => {
    const pos = DESKTOP_MODULES.find((m) => m.name === "POS")!;
    expect(moduleHref(pos, false)).toBe("/login?redirect=/dashboard/pos&module=pos");
    expect(moduleHref(pos, true)).toBe("/dashboard/pos");
  });

  it("filterModules mencocokkan nama atau subjudul", () => {
    expect(filterModules(DESKTOP_MODULES, "  ")).toBe(DESKTOP_MODULES);
    expect(filterModules(DESKTOP_MODULES, "loyalty").map((m) => m.name)).toEqual(["CRM"]);
  });
});

describe("format", () => {
  it("formatRupiah ringkas", () => {
    expect(formatRupiah(950)).toBe("Rp 950");
    expect(formatRupiah(12_500)).toBe("Rp 13 rb");
    expect(formatRupiah(2_500_000)).toBe("Rp 2,5 jt");
    expect(formatRupiah(1_250_000_000)).toBe("Rp 1,25 M");
  });

  it("deltaPct tanpa pembanding → null", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(80, 100)).toBe(-20);
    expect(deltaPct(10, 0)).toBeNull();
  });

  it("formatTanggalPendek", () => {
    expect(formatTanggalPendek("2026-03-31")).toBe("31 Mar 26");
  });

  it("buildMonthCells menyisipkan kotak kosong sebelum tanggal 1", () => {
    // 1 Oktober 2026 jatuh pada Kamis (indeks 4).
    const cells = buildMonthCells(new Date(2026, 9, 15));
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, 1]);
    expect(cells.at(-1)).toBe(31);
  });
});

describe("wa-recipients", () => {
  it("normalisasi, duplikat, dan batas jumlah", () => {
    expect(addWaRecipient([], "0812-3456-7890", 5)).toEqual({ ok: true, list: ["6281234567890"] });
    expect(addWaRecipient(["6281234567890"], "081234567890", 5)).toEqual({ ok: false, error: "Nomor sudah terdaftar" });
    expect(addWaRecipient(["6281111111111"], "081234567890", 1)).toEqual({ ok: false, error: "Maksimal 1 nomor" });
    expect(addWaRecipient([], "abc", 5).ok).toBe(false);
  });

  it("parseBoundedInt", () => {
    expect(parseBoundedInt("1.500.000", 0, Infinity, 0)).toBe(1_500_000);
    expect(parseBoundedInt("", 0, Infinity, 0)).toBe(0);
    expect(parseBoundedInt("150", 1, 99, 80)).toBe(80);
    expect(parseBoundedInt("7", 0, 23, 0)).toBe(7);
  });
});
