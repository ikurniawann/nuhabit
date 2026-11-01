import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { poDetailFigures } from "@/lib/purchasing/po-ui-detail";
import type { PurchaseOrderWithStats } from "@/types/purchasing";
import { POPaymentCard } from "./po-payment-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const po = {
  id: "po-1",
  payment_status: "unpaid",
  paid_amount: 0,
  payable_amount: 1000,
  gross_payable_amount: 1000,
  outstanding_amount: 1000,
} as unknown as PurchaseOrderWithStats;

const invoice = (fields: Record<string, unknown>) => ({
  id: "inv-1",
  invoice_no: "AP-20261001-0001",
  invoice_date: "2026-10-01",
  due_date: "2026-10-31",
  grn_number: "GRN-1",
  total_amount: 600,
  allocated_amount: 0,
  outstanding_amount: 600,
  status: "POSTED",
  ...fields,
});

function stubFetch(invoices: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/accounting/ap/invoices")) return json({ data: invoices, meta: { total: invoices.length } });
    if (url === "/api/accounting/ap/payments" && init?.method === "POST") return json({ success: true, data: { id: "pay-1" } }, 201);
    return json({ success: true, data: { terms: [], payments: [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <POPaymentCard po={po} figures={poDetailFigures(po)} />
    </QueryClientProvider>
  );
}

describe("POPaymentCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("disables Bayar and points to the GRN while the PO has no AP invoice", async () => {
    const fetchMock = stubFetch([]);
    renderCard();

    expect(await screen.findByText(/Belum ada invoice AP untuk PO ini/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buka Penerimaan Barang (GRN)" })).toHaveAttribute(
      "href",
      "/dashboard/raw-material/purchasing/grn"
    );
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled();
    const listUrl = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.startsWith("/api/accounting/ap/invoices"));
    const query = new URL(listUrl!, "http://x").searchParams;
    expect([query.get("purchase_order_id"), query.get("status")]).toEqual(["po-1", "POSTED"]);
  });

  it("says when every AP invoice is already paid", async () => {
    stubFetch([invoice({ allocated_amount: 600, outstanding_amount: 0 })]);
    renderCard();

    expect(await screen.findByText(/Invoice AP yang ada sudah lunas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bayar" })).toBeDisabled();
  });

  it("pays the open AP invoice through Accounts Payable", async () => {
    const fetchMock = stubFetch([invoice({})]);
    renderCard();

    const pay = await screen.findByRole("button", { name: "Bayar" });
    await waitFor(() => expect(pay).toBeEnabled());
    expect(screen.queryByText(/Belum ada invoice AP/)).not.toBeInTheDocument();
    fireEvent.click(pay);
    fireEvent.click(await screen.findByRole("button", { name: "Simpan Pembayaran" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pelunasan berhasil dicatat"));
    const post = fetchMock.mock.calls.find(([url, init]) => url === "/api/accounting/ap/payments" && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ invoice_id: "inv-1", amount: 600, method: "bank_transfer" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/payments") && String(url).includes("/po/"))).toBe(false);
  });
});
