import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderDetail } from "../lib/queries-loyalty";
import { OrdersPage } from "./orders-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));

const orders = [
  { id: "s1", order_number: "SO-1", total_amount: 102_000, payment_method: "xendit", status: "pending", source: "shop", created_at: "2026-10-18T03:00:00Z" },
  { id: "s2", order_number: "SO-2", total_amount: 50_000, payment_method: "xendit", status: "ready_for_pickup", source: "shop", created_at: "2026-10-17T03:00:00Z" },
  { id: "p1", order_number: "POS-1", total_amount: 30_000, payment_method: "cash", status: "completed", source: "pos", created_at: "2026-10-16T03:00:00Z" },
];

const shopBase = {
  status: "pending",
  paid_at: null,
  shipping_cost: 12_000,
  invoice_url: "https://pay.example/inv-1",
  status_url: "/shop/order/tok-1",
  delivery: {
    method: "ship" as const,
    address: "Jl. Dago 1",
    area_label: "Coblong, Bandung",
    courier: "JNE REG",
    eta_text: "1 - 2 days",
    waybill: null,
    branch: null,
    ready_at: null,
  },
};

const header = { ordered_at: "2026-10-18T03:00:00Z", ark_coins_used: 0, venue_name: "NüHabit Apparel", payment_method: "xendit" };

const details: Record<string, OrderDetail> = {
  s1: {
    source: "shop",
    shop: shopBase,
    order: { ...header, order_number: "SO-1", total_amount: 102_000, discount_amount: 10_000, discount_reason: "LAUNCH", subtotal: 100_000 },
    items: [{ product_name: "Tee (L)", quantity: 2, unit_price: 50_000, discount_amount: 0, total_amount: 100_000 }],
    xp_earned: 0,
    ark_rate: 1,
  },
  s2: {
    source: "shop",
    shop: {
      ...shopBase,
      status: "ready_for_pickup",
      paid_at: "2026-10-17T03:05:00Z",
      shipping_cost: 0,
      invoice_url: null,
      status_url: "/shop/order/tok-2",
      delivery: { ...shopBase.delivery, method: "pickup", courier: null, eta_text: null, area_label: null, address: "Pickup at Dago",
        branch: { name: "Dago", address: "Jl. Dago 10", phone: null }, ready_at: "2026-10-17T06:00:00Z" },
    },
    order: { ...header, order_number: "SO-2", total_amount: 50_000, discount_amount: 0, discount_reason: null, subtotal: 50_000 },
    items: [{ product_name: "Cap", quantity: 1, unit_price: 50_000, discount_amount: 0, total_amount: 50_000 }],
    xp_earned: 0,
    ark_rate: 1,
  },
  p1: {
    source: "pos",
    shop: null,
    order: { ...header, order_number: "POS-1", payment_method: "cash", venue_name: "Dago", total_amount: 30_000, discount_amount: 0, discount_reason: null, subtotal: 30_000 },
    items: [{ product_name: "Latte", quantity: 1, unit_price: 30_000, discount_amount: 0, total_amount: 30_000 }],
    xp_earned: 30,
    ark_rate: 1,
  },
};

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace("/api/member-portal", "");
      let data: unknown = null;
      if (path === "/transactions") data = { wallet: [], orders };
      else if (path === "/visits") data = { visit_count: 0, venues: [] };
      else if (path.startsWith("/orders/")) data = details[path.slice("/orders/".length)];
      const status = path === "/me" ? 401 : 200;
      return new Response(JSON.stringify({ success: status === 200, data }), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrdersPage />
    </QueryClientProvider>,
  );
}

describe("OrdersPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists online shop orders with their source and status next to outlet receipts", async () => {
    stubApi();
    renderPage();
    const pending = await screen.findByRole("button", { name: /SO-1/ });
    expect(within(pending).getByText(/Online shop ·/)).toBeInTheDocument();
    expect(within(pending).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /SO-2/ })).getByText("Ready for pickup")).toBeInTheDocument();
    const outlet = screen.getByRole("button", { name: /POS-1/ });
    expect(within(outlet).getByText(/Outlet ·/)).toBeInTheDocument();
    expect(within(outlet).queryByText("Awaiting payment")).not.toBeInTheDocument();
  });

  it("opens a pending shipped order with its delivery, totals and the payment link", async () => {
    stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /SO-1/ }));
    const sheet = await screen.findByRole("dialog", { name: "SO-1" });
    expect(within(sheet).getByText("Online shop order")).toBeInTheDocument();
    await within(sheet).findByText("Ship to");
    expect(within(sheet).getByText("Jl. Dago 1, Coblong, Bandung")).toBeInTheDocument();
    expect(within(sheet).getByText("JNE REG · 1 - 2 days")).toBeInTheDocument();
    expect(within(sheet).getByText("2× Tee (L)")).toBeInTheDocument();
    expect(within(sheet).getByText("Shipping")).toBeInTheDocument();
    expect(within(sheet).getByText("Discount (LAUNCH)")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Pay now" })).toHaveAttribute("href", "https://pay.example/inv-1");
    expect(within(sheet).getByRole("link", { name: "Track order" })).toHaveAttribute("href", "/shop/order/tok-1");
  });

  it("shows the pickup branch and no payment link once the order is paid", async () => {
    stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /SO-2/ }));
    const sheet = await screen.findByRole("dialog", { name: "SO-2" });
    expect(await within(sheet).findByText("Pick up at Dago")).toBeInTheDocument();
    expect(within(sheet).getByText("Jl. Dago 10")).toBeInTheDocument();
    expect(within(sheet).getByText("Pickup")).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Pay now" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Track order" })).toHaveAttribute("href", "/shop/order/tok-2");
  });

  it("keeps the outlet receipt without shop sections", async () => {
    stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /POS-1/ }));
    const sheet = await screen.findByRole("dialog", { name: "POS-1" });
    expect(await within(sheet).findByText("1× Latte")).toBeInTheDocument();
    expect(within(sheet).getByText("Receipt")).toBeInTheDocument();
    expect(within(sheet).getByText("+30 XP")).toBeInTheDocument();
    expect(within(sheet).queryByText("Status")).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Track order" })).not.toBeInTheDocument();
  });
});
