import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Switch } from "./switch";

/** Regression: axe aria-toggle-field-name, switch tanpa nama aksesibel. */
describe("Switch", () => {
  test("memakai aria-label sebagai nama", () => {
    render(<Switch checked aria-label="Aktifkan KPI kehadiran" />);

    expect(screen.getByRole("switch", { name: "Aktifkan KPI kehadiran" })).toBeChecked();
  });

  test("memakai teks terlihat lewat aria-labelledby", () => {
    render(
      <>
        <p id="campaign-auto">Kirim otomatis</p>
        <Switch checked={false} aria-labelledby="campaign-auto" />
      </>
    );

    expect(screen.getByRole("switch", { name: "Kirim otomatis" })).not.toBeChecked();
  });
});
