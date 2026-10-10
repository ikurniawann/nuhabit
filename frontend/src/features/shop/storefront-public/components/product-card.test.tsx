import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { formatRupiah } from "@/lib/format";
import { catalogProduct, catalogSku } from "@/test/shop-fixtures";
import { ProductCard } from "./product-card";

const actions = () => ({ onSelect: vi.fn(), isSaved: vi.fn(() => false), onToggleSaved: vi.fn(), onQuickAdd: vi.fn() });

describe("ProductCard", () => {
  it("shows the effective price, the struck-through original, the percent and the stock badges", () => {
    const product = catalogProduct({
      id: "tee",
      name: "Sale Tee",
      price: 80_000,
      compareAtPrice: 100_000,
      salePercent: 20,
      saleUntil: "2026-10-20T16:59:59Z",
      lowStock: true,
      backInStock: true,
      rating: { average: 4.5, count: 12 },
    });
    render(<ProductCard product={product} actions={actions()} />);
    expect(screen.getByText(formatRupiah(80_000))).toBeInTheDocument();
    expect(screen.getByText(formatRupiah(100_000)).tagName).toBe("S");
    expect(screen.getByText("-20%")).toBeInTheDocument();
    expect(screen.getByText("Sale ends Oct 20, 2026")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("Back in stock")).toBeInTheDocument();
    expect(screen.getByLabelText("Rated 4.5 out of 5 from 12 reviews")).toBeInTheDocument();
  });

  it("quick-adds a single-SKU product on one tap", () => {
    const product = catalogProduct({ id: "cap", name: "Cap" });
    const handlers = actions();
    render(<ProductCard product={product} actions={handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Cap to cart" }));
    expect(handlers.onQuickAdd).toHaveBeenCalledWith(product, null);
    expect(screen.queryByRole("group", { name: "Sizes for Cap" })).not.toBeInTheDocument();
  });

  it("opens an inline size row for a variant product and adds the chosen size", () => {
    const small = catalogSku({ id: "s", name: "S", stock: 0 });
    const medium = catalogSku({ id: "m", name: "M", price: 120_000, compareAtPrice: 150_000 });
    const product = catalogProduct({ id: "shirt", name: "Shirt", price: 150_000, skus: [small, medium] });
    const handlers = actions();
    render(<ProductCard product={product} actions={handlers} />);
    expect(screen.getByText(`From ${formatRupiah(120_000)}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Shirt to cart" }));
    const row = screen.getByRole("group", { name: "Sizes for Shirt" });
    expect(row).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "S" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(handlers.onQuickAdd).toHaveBeenCalledWith(product, medium);
    expect(screen.queryByRole("group", { name: "Sizes for Shirt" })).not.toBeInTheDocument();
  });

  it("toggles the heart without opening the product", () => {
    const product = catalogProduct({ id: "cap", name: "Cap" });
    const handlers = actions();
    render(<ProductCard product={product} actions={handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Cap" }));
    expect(handlers.onToggleSaved).toHaveBeenCalledWith(product);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });
});
