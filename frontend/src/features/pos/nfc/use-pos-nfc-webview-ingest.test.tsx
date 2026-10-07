import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePosNfcWebViewIngest } from "./use-pos-nfc-webview-ingest";

describe("usePosNfcWebViewIngest", () => {
  beforeEach(() => {
    delete window.arkivNfc;
    delete window.nfc;
    delete window.__posMockEmitNfcScan;
    delete window.__posMockOpenScanDialog;
    delete window.__posMockPendingScans;
  });

  it("receives Arkiv WebView custom events", () => {
    const onCard = vi.fn();
    renderHook(() => usePosNfcWebViewIngest(onCard));

    act(() => {
      window.dispatchEvent(new CustomEvent("arkiv-nfc-scan", { detail: { uid: "04A1B2C3" } }));
    });

    expect(onCard).toHaveBeenCalledWith("04A1B2C3");
  });

  it("receives POS mock alias calls", () => {
    const onCard = vi.fn();
    renderHook(() => usePosNfcWebViewIngest(onCard));

    act(() => {
      window.__posMockOpenScanDialog?.("04A1B2C3");
    });

    expect(onCard).toHaveBeenCalledWith("04A1B2C3");
  });

  it("drains pending POS mock scans once on mount", () => {
    window.__posMockPendingScans = ["04A1B2C3"];
    const onCard = vi.fn();

    renderHook(() => usePosNfcWebViewIngest(onCard));

    expect(onCard).toHaveBeenCalledWith("04A1B2C3");
    expect(window.__posMockPendingScans).toEqual([]);
  });
});
