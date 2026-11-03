import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { catalogProduct } from "@/test/shop-fixtures";
import { StoreQuickSearch } from "./store-quick-search";

const products = Array.from({ length: 8 }, (_, i) => catalogProduct({ id: `tee-${i}`, name: `Tee ${i}` }));

function setup() {
  const onSelect = vi.fn();
  const onSeeAll = vi.fn();
  render(<StoreQuickSearch products={products} onSelect={onSelect} onSeeAll={onSeeAll} />);
  const input = screen.getByRole("combobox", { name: "Quick search" });
  return { onSelect, onSeeAll, input };
}

describe("StoreQuickSearch", () => {
  it("opens the product under the arrow keys", () => {
    const { onSelect, input } = setup();
    fireEvent.change(input, { target: { value: "tee" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(products[1]);
  });

  it("offers every match past the first six", () => {
    const { onSeeAll, input } = setup();
    fireEvent.change(input, { target: { value: "tee" } });
    expect(screen.getAllByRole("option")).toHaveLength(7);
    fireEvent.click(screen.getByRole("option", { name: "See all 8 results" }));
    expect(onSeeAll).toHaveBeenCalledWith("tee");
  });

  it("says when nothing matches", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText(/No products match/)).toBeTruthy();
  });

  it("takes focus from the slash key, but not while typing elsewhere", () => {
    const { input } = setup();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(input);
    input.blur();
    const other = document.createElement("textarea");
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
