import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Combobox } from "./combobox";

const options = [{ value: "bdg", label: "Bandung" }];

describe("Combobox", () => {
  test("memakai aria-label sebagai nama trigger", () => {
    render(<Combobox aria-label="Filter kota" options={options} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Filter kota" })).toBeInTheDocument();
  });

  // Regression: axe nested-interactive, tombol hapus fokusable di dalam trigger.
  test("tombol hapus tidak membuat kontrol bersarang di dalam trigger", () => {
    const onChange = vi.fn();
    render(
      <Combobox aria-label="Kota" options={options} value="bdg" onChange={onChange} allowClear />
    );

    const trigger = screen.getByRole("button", { name: "Kota" });
    expect(trigger.querySelector("[tabindex], [role='button']")).toBeNull();

    fireEvent.click(screen.getByText("×"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
