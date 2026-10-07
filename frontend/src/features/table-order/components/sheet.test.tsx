// Bug QA 2026-09-12: setelah memilih menu (sheet varian) halaman tidak bisa
// di-scroll kembali ke atas — kunci scroll body harus pulih SEPENUHNYA saat
// sheet ditutup, termasuk posisi scroll, dan tidak re-lock saat induk re-render.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BottomSheet, lockPageScroll } from "./sheet";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.removeAttribute("style");
});

describe("lockPageScroll", () => {
  it("mengunci body dgn position fixed pada posisi scroll saat ini dan memulihkannya", () => {
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const unlock = lockPageScroll();
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-480px");
    expect(document.body.style.overflow).toBe("hidden");

    unlock();
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 480);
  });
});

describe("BottomSheet", () => {
  it("melepas kunci scroll saat ditutup dan tidak re-lock saat onClose berganti identitas", () => {
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const { rerender } = render(
      <BottomSheet open onClose={() => undefined}>
        isi
      </BottomSheet>
    );
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-300px");

    // Induk re-render dgn callback baru (identitas berubah) → kunci tetap, top tidak berubah.
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    rerender(
      <BottomSheet open onClose={() => undefined}>
        isi
      </BottomSheet>
    );
    expect(document.body.style.top).toBe("-300px");
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(
      <BottomSheet open={false} onClose={() => undefined}>
        isi
      </BottomSheet>
    );
    expect(document.body.style.position).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 300);
  });

  it("unmount (mis. sheet varian dibuang setelah 'Tambah') juga memulihkan scroll", () => {
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { unmount } = render(
      <BottomSheet open onClose={() => undefined}>
        isi
      </BottomSheet>
    );
    unmount();
    expect(document.body.style.position).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 120);
  });
});
