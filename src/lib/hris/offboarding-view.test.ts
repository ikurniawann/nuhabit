import { describe, expect, it } from "vitest";
import {
  OFFBOARDING_CLEARANCES,
  isCleared,
  resignationTypeLabel,
  withAssetReturn,
} from "./offboarding-view";

const flags = {
  clearance_hrd: true,
  clearance_it: false,
  clearance_finance: true,
  clearance_manager: false,
};

describe("resignationTypeLabel", () => {
  it("maps known types to Indonesian labels", () => {
    expect(resignationTypeLabel("voluntary")).toBe("Mengundurkan Diri");
    expect(resignationTypeLabel("end_of_contract")).toBe("Akhir Kontrak");
  });

  it("falls back to the raw type", () => {
    expect(resignationTypeLabel("mutual")).toBe("mutual");
  });
});

describe("isCleared", () => {
  it("reads the clearance flag for each department", () => {
    expect(OFFBOARDING_CLEARANCES.map((c) => isCleared(flags, c.key))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe("withAssetReturn", () => {
  it("merges one asset into the existing status", () => {
    expect(withAssetReturn({ laptop: true }, "keys", false)).toEqual({
      laptop: true,
      keys: false,
    });
  });

  it("overrides an existing asset and handles missing status", () => {
    expect(withAssetReturn({ laptop: false }, "laptop", true)).toEqual({ laptop: true });
    expect(withAssetReturn(null, "phone", true)).toEqual({ phone: true });
  });

  it("does not mutate the input", () => {
    const current = { laptop: false };
    withAssetReturn(current, "laptop", true);
    expect(current).toEqual({ laptop: false });
  });
});
