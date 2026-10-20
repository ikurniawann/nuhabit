import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ID } from "../lib/i18n";
import { setLang } from "../lib/lang";
import { StatusBadge, statusLabel } from "./status-badge";

describe("status badge", () => {
  beforeEach(() => setLang("id"));

  it("maps known codes to labels with an Indonesian translation", () => {
    for (const code of ["CONFIRMED", "WAITLIST", "CHECKED_IN", "ACTIVE", "ALLOWED", "DENIED", "REGISTRATION_OPEN", "RACED"]) {
      expect(ID[statusLabel(code)], code).toBeTruthy();
    }
  });

  it("shows unknown codes and ready-made labels as they are", () => {
    expect(statusLabel("SOME_NEW_STATE")).toBe("SOME NEW STATE");
    expect(statusLabel("Disetujui")).toBe("Disetujui");
  });

  it("renders the translated label in the current language", () => {
    const { rerender } = render(<StatusBadge status="CHECKED_IN" />);
    expect(screen.getByText("Sudah check-in")).toBeInTheDocument();
    setLang("en");
    rerender(<StatusBadge status="CHECKED_IN" />);
    expect(screen.getByText("Checked in")).toBeInTheDocument();
  });
});
