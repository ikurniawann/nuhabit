import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ScrollRegion } from "./scroll-region";

/**
 * Regression: axe scrollable-region-focusable. Tabel laporan yang lebih lebar
 * dari layar harus bisa difokus dan digeser dengan keyboard.
 */
describe("ScrollRegion", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockWidths = (scrollWidth: number, clientWidth: number) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
  };

  test("menjadi region bernama yang bisa difokus saat konten melebar", () => {
    mockWidths(900, 400);

    render(
      <ScrollRegion label="Tabel laporan laba">
        <table />
      </ScrollRegion>
    );

    const region = screen.getByRole("region", { name: "Tabel laporan laba" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  test("tidak menambah tab stop saat konten muat", () => {
    mockWidths(400, 400);

    const { container } = render(
      <ScrollRegion label="Tabel laporan laba">
        <table />
      </ScrollRegion>
    );

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("tabindex");
  });
});
