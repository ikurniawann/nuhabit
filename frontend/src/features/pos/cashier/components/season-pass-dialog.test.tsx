import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SeasonPassDialog } from "./season-pass-dialog";
import type { SeasonPassDiscount } from "../cashier-session";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog(active: SeasonPassDiscount | null = null) {
  const handlers = { onApply: vi.fn(), onClear: vi.fn(), onClose: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SeasonPassDialog open active={active} {...handlers} />
    </QueryClientProvider>
  );
  return handlers;
}

function scan(code: string) {
  fireEvent.change(screen.getByLabelText("Kode pass"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Cek pass" }));
}

describe("SeasonPassDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies the discount of an active pass", async () => {
    const fetchMock = stubFetch({
      success: true,
      data: {
        found: true,
        pass_code: "SP-0042",
        holder_name: "Budi",
        product_name: "Season Pass 2026",
        discount_percent: 15,
        valid_until: null,
      },
    });
    const handlers = renderDialog();
    scan(" SP-0042 ");

    const apply = await screen.findByRole("button", { name: "Pakai diskon 15%" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pos/pass-lookup?code=SP-0042");
    expect(screen.getByText("Season Pass 2026")).toBeInTheDocument();
    expect(screen.getByText("Tanpa batas")).toBeInTheDocument();
    fireEvent.click(apply);
    expect(handlers.onApply).toHaveBeenCalledWith({ holderName: "Budi", discountPercent: 15 });
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("shows why a pass grants no discount", async () => {
    stubFetch({ success: true, data: { found: false, reason: "Pass di luar masa berlaku", pass_code: "SP-1" } });
    renderDialog();
    scan("SP-1");
    expect(await screen.findByText("Pass di luar masa berlaku")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pakai diskon" })).toBeDisabled();
  });

  it("releases the active pass", async () => {
    const handlers = renderDialog({ holderName: "Ani", discountPercent: 10 });
    expect(screen.getByText("Pass aktif: Ani (10%)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lepas pass" }));
    await waitFor(() => expect(handlers.onClear).toHaveBeenCalled());
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
