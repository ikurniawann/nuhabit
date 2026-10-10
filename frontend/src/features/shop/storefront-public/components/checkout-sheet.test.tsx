import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addCartLine } from "@/lib/shop/storefront-cart";
import type { AppliedPromo, PickupBranch, ShopMember, StorefrontSettings } from "@/lib/shop/types";
import { CheckoutSheet } from "./checkout-sheet";
import { FreeShippingBar } from "./cart-drawer";

const tee = { id: "p1", name: "Tee", price: 100_000 };
const cart = addCartLine([], tee, null, 2);
const settings: StorefrontSettings = { pickupEnabled: true, freeShippingThreshold: null, lowStockThreshold: 3, whatsappNumber: null };
const branches: PickupBranch[] = [
  { id: "b1", name: "Dago", address: "Jl. Dago 1", city: "Bandung", phone: "0811" },
  { id: "b2", name: "Kemang", address: "Jl. Kemang 2", city: "Jakarta", phone: "" },
];
const member: ShopMember = { name: "Budi", phone: "0812", email: "budi@example.com", arkBalance: 250_000, lastAddress: null };

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };

function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSheet(props: Partial<Parameters<typeof CheckoutSheet>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPromoChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <CheckoutSheet
        open
        slug="store"
        cart={cart}
        note=""
        settings={settings}
        branches={branches}
        promo={null}
        onPromoChange={onPromoChange}
        onPaid={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
  return { ...utils, onPromoChange };
}

describe("CheckoutSheet", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("pickup hides the address fields and marks shipping as free pickup", async () => {
    stubFetch((url) => (url.endsWith("/me") ? { body: { success: true, data: null } } : { body: { success: true, data: [] } }));
    renderSheet();
    expect(screen.getByLabelText("Destination area")).toBeInTheDocument();
    expect(screen.getByText("Choose a delivery area")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Pick up at a branch" }));
    expect(screen.queryByLabelText("Destination area")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Full address")).not.toBeInTheDocument();
    expect(screen.getByText("Free pickup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Dago/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Pay Now/ })).toBeEnabled();
    await waitFor(() => expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument());
  });

  it("the pickup toggle stays hidden when the store does not offer pickup", () => {
    stubFetch(() => ({ body: { success: true, data: null } }));
    renderSheet({ settings: { ...settings, pickupEnabled: false } });
    expect(screen.queryByRole("radio", { name: "Pick up at a branch" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full address")).toBeInTheDocument();
  });

  it("applies a promo through the preview endpoint and shows the 422 message for a bad code", async () => {
    const promo: AppliedPromo = { code: "WELCOME", discountAmount: 40_000, label: "40k off your first order" };
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith("/me")) return { body: { success: true, data: null } };
      if (url.endsWith("/promo/preview")) {
        const { code } = JSON.parse(String(init?.body)) as { code: string };
        return code === "WELCOME"
          ? { body: { success: true, data: promo } }
          : { status: 422, body: { success: false, error: "This code has expired" } };
      }
      return { body: { success: true, data: [] } };
    });
    const { onPromoChange, rerender } = renderSheet();

    fireEvent.change(screen.getByRole("textbox", { name: "Promo code" }), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("This code has expired")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Promo code" }), { target: { value: "welcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onPromoChange).toHaveBeenCalledWith(promo));
    const previewCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/promo/preview"));
    expect(JSON.parse(String(previewCall?.[1]?.body))).toEqual({
      code: "NOPE",
      lines: [{ productId: "p1", skuId: null, quantity: 2 }],
    });

    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <CheckoutSheet open slug="store" cart={cart} note="" settings={settings} branches={branches} promo={promo} onPromoChange={onPromoChange} onPaid={vi.fn()} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    expect(screen.getByText("Discount (WELCOME)")).toBeInTheDocument();
    expect(screen.getByText("-Rp40.000")).toBeInTheDocument();
  });

  it("offers ARK Coin only when the member balance covers the total, and prefills the member", async () => {
    stubFetch((url) => (url.endsWith("/me") ? { body: { success: true, data: member } } : { body: { success: true, data: [] } }));
    renderSheet();
    expect(await screen.findByRole("radio", { name: /ARK Coin/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Budi");
    expect(screen.getByLabelText("Email (optional)")).toHaveValue("budi@example.com");
    expect(screen.getByText(/Balance Rp250.000/)).toBeInTheDocument();
  });

  it("hides ARK Coin for a short balance and for guests", async () => {
    stubFetch((url) => (url.endsWith("/me") ? { body: { success: true, data: { ...member, arkBalance: 100_000 } } } : { body: { success: true, data: [] } }));
    renderSheet();
    expect(await screen.findByText(/does not cover this order/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /ARK Coin/ })).not.toBeInTheDocument();
  });

  it("submits a pickup order and saves the contact for next time", async () => {
    window.localStorage.setItem("shop-checkout-contact", JSON.stringify({ name: "Sari", phone: "0813 999 888", email: "", address: "", area: null }));
    const fetchMock = stubFetch((url) => {
      if (url.endsWith("/me")) return { body: { success: true, data: null } };
      if (url.endsWith("/checkout")) return { body: { success: true, data: { invoice_url: "https://invoice.test/abc" } } };
      return { body: { success: true, data: [] } };
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost", assign });
    const onPaid = vi.fn();
    renderSheet({ onPaid });
    expect(screen.getByLabelText("Name")).toHaveValue("Sari");

    fireEvent.click(screen.getByRole("radio", { name: "Pick up at a branch" }));
    fireEvent.click(screen.getByRole("radio", { name: /Kemang/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Now/ }));
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://invoice.test/abc"));
    expect(onPaid).toHaveBeenCalled();
    const checkoutCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/checkout"));
    expect(JSON.parse(String(checkoutCall?.[1]?.body))).toMatchObject({
      customer: { name: "Sari", phone: "0813 999 888", email: null },
      delivery: { method: "pickup", branchId: "b2" },
      payment: { method: "xendit" },
    });
    expect(JSON.parse(window.localStorage.getItem("shop-checkout-contact") ?? "")).toMatchObject({ name: "Sari" });
  });
});

describe("FreeShippingBar", () => {
  it("renders the copy and the progress ratio", () => {
    render(<FreeShippingBar text="Rp60.000 away from free shipping" ratio={0.8} unlocked={false} />);
    expect(screen.getByText("Rp60.000 away from free shipping")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
  });
});
