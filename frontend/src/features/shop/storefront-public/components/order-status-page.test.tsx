import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicOrderStatus } from "@/lib/shop/types";
import { ShopOrderStatusPage } from "./order-status-page";

const order: PublicOrderStatus = {
  storefrontSlug: "store",
  order_number: "SO-1",
  status: "paid",
  customer_name: "Budi",
  shipping_area_label: "Bandung",
  shipping_address: "Jl. Dago 1",
  courier: "JNE REG",
  subtotal: 200_000,
  shipping_cost: 10_000,
  total: 210_000,
  invoice_url: null,
  waybill: null,
  paid_at: "2026-10-10T03:00:00Z",
  created_at: "2026-10-10T02:00:00Z",
  items: [
    { productId: "p1", name: "Tee", quantity: 1, unit_price: 100_000, total: 100_000, reviewable: true },
    { productId: "p2", name: "Cap", quantity: 1, unit_price: 100_000, total: 100_000, reviewable: false },
  ],
  delivery: { method: "ship", branch: null, readyAt: null },
  discountAmount: 0,
  promoCode: null,
  paymentMethod: "xendit",
  etaText: null,
  whatsappUrl: null,
};

function stubFetch(onReview: (body: unknown) => { status?: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = url.endsWith("/reviews") ? onReview(JSON.parse(String(init?.body))) : { body: { success: true, data: order } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShopOrderStatusPage token="tok-1" />
    </QueryClientProvider>
  );
}

describe("ShopOrderStatusPage reviews", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers Rate this item only for reviewable items and shows the pending notice after sending", async () => {
    const onReview = vi.fn(() => ({ body: { success: true } }));
    const fetchMock = stubFetch(onReview);
    renderPage();
    const rate = await screen.findByRole("button", { name: "Rate this item" });
    expect(screen.getAllByRole("button", { name: "Rate this item" })).toHaveLength(1);

    fireEvent.click(rate);
    expect(screen.getByRole("button", { name: "Send review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.change(screen.getByPlaceholderText(/What did you think/), { target: { value: "Great fit" } });
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));

    await waitFor(() => expect(screen.getByText(/Thanks for your review/)).toBeInTheDocument());
    expect(onReview).toHaveBeenCalledWith({ orderToken: "tok-1", productId: "p1", rating: 4, comment: "Great fit" });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/public/shop/store/reviews")).toBe(true);
    expect(screen.queryByRole("button", { name: "Rate this item" })).not.toBeInTheDocument();
  });

  it("shows the store's message when the review is refused", async () => {
    stubFetch(() => ({ status: 403, body: { success: false, error: "Sign in to review this item" } }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rate this item" }));
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(screen.getByText("Sign in to review this item")).toBeInTheDocument());
  });
});
