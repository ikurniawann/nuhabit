import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectAxeClean, LETTERHEAD } from "@/features/documents/documents.test-util";
import { formatRupiah } from "@/lib/format";
import type { Quotation } from "../types";
import { QuotationDocumentPage } from "./quotation-document-page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DEAL = {
  id: "d1",
  company_id: "c1",
  branch_id: "b1",
  title: "Gathering Akhir Tahun",
  event_type: "gathering",
  event_date: "2026-12-01",
  org_name: "PT Maju",
  pic_name: "Budi",
  pic_title: "HRD",
  pic_phone: "6281234",
  pic_email: null,
  owner_name: "Rina",
  company_name: "PT Venue",
  branch_name: "Cabang Dago",
};

const SENT: Quotation = {
  id: "q1",
  deal_id: "d1",
  company_id: "c1",
  branch_id: "b1",
  quote_number: "QT-2610-0001",
  status: "terkirim",
  use_ppn: true,
  ppn_persen: "11",
  subtotal: "1000000",
  discount_percent: "0",
  discount_nominal: "0",
  approval_status: "none",
  version: 2,
  ppn_nominal: "110000",
  total: "1110000",
  notes: "Termasuk sound system",
  valid_until: "2026-11-15",
  stock_deducted_at: null,
  bom_status: null,
  created_at: "2026-10-05T03:00:00Z",
  items: [{ id: "i1", item_type: "bebas", product_id: null, description: "Sewa venue", qty: "1", unit_price: "1000000", line_total: "1000000" }],
  terms: [],
};

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data, message: "Quotation QT-2610-0002 dibuat" }), { status });

function mockApi() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  // The product combobox (cmdk) measures its list.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      if (url === "/api/sales-funnel/deals/d1") return ok(DEAL);
      if (url.startsWith("/api/sales-funnel/deals?") || url === "/api/sales-funnel/deals") return ok([DEAL]);
      if (url === "/api/settings/letterhead?company_id=c1") return ok(LETTERHEAD);
      if (url === "/api/sales-funnel/products") return ok([{ id: "p1", name: "Paket Makan", base_price: "20000" }]);
      if (url === "/api/sales-funnel/quotations/q1") return ok(SENT);
      if (method === "POST" && url === "/api/sales-funnel/deals/d1/quotations") return ok({ id: "q-new" }, 201);
      return ok(null, 404);
    })
  );
  return calls;
}

function renderPage(props: { dealId?: string; quotationId?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuotationDocumentPage {...props} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("QuotationDocumentPage", () => {
  it("builds a draft on the document sheet and saves it with the form totals", async () => {
    const calls = mockApi();
    const { container } = renderPage({ dealId: "d1" });

    const sheet = await screen.findByRole("article", { name: "Dokumen quotation" });
    expect(await within(sheet).findByText("PT NüHabit Indonesia")).toBeInTheDocument();
    expect(await within(sheet).findByText("PT Maju")).toBeInTheDocument();
    expect(within(sheet).getByText("Budi, HRD")).toBeInTheDocument();
    expect(within(sheet).getByText("Otomatis setelah disimpan")).toBeInTheDocument();

    const saveDraft = screen.getByRole("button", { name: "Simpan draft" });
    expect(saveDraft).toBeDisabled();
    expect(screen.getByText("1 baris belum lengkap, isi atau hapus dulu.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Deskripsi baris 1"), { target: { value: "Sewa venue" } });
    fireEvent.change(screen.getByLabelText("Harga baris 1"), { target: { value: "1000000" } });

    // Catalog product: picking it fills the description and the price.
    fireEvent.click(screen.getByRole("button", { name: /Tambah produk/ }));
    fireEvent.click(screen.getByRole("button", { name: "Produk baris 2" }));
    fireEvent.click(await screen.findByText("Paket Makan"));
    fireEvent.change(screen.getByLabelText("Qty baris 2"), { target: { value: "10" } });

    const summary = screen.getByRole("region", { name: "Ringkasan harga" });
    // 1.000.000 + 10 x 20.000, PPN 11%
    expect(within(summary).getByText(formatRupiah(1200000))).toBeInTheDocument();
    expect(within(summary).getByText(formatRupiah(132000))).toBeInTheDocument();
    expect(within(summary).getByText(formatRupiah(1332000))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Diskon (%)"), { target: { value: "15" } });
    expect(screen.getByText("Diskon di atas 10% butuh persetujuan admin.")).toBeInTheDocument();
    // 1.200.000 - 180.000 = 1.020.000; PPN 112.200
    expect(within(summary).getByText(formatRupiah(1132200))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Berlaku s.d."), { target: { value: "2026-11-30" } });
    await expectAxeClean(container);

    fireEvent.click(saveDraft);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/sales-funnel/pipeline/quotations/q-new"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      use_ppn: true,
      ppn_persen: 11,
      discount_percent: 15,
      notes: null,
      valid_until: "2026-11-30",
      items: [
        { item_type: "bebas", product_id: null, description: "Sewa venue", qty: 1, unit_price: 1000000 },
        { item_type: "produk", product_id: "p1", description: "Paket Makan", qty: 10, unit_price: 20000 },
      ],
      terms: [],
    });
  });

  it("asks for valid payment terms before saving", async () => {
    mockApi();
    renderPage({ dealId: "d1" });
    fireEvent.change(await screen.findByLabelText("Deskripsi baris 1"), { target: { value: "Sewa venue" } });
    fireEvent.click(screen.getByRole("button", { name: /Pakai termin/ }));
    fireEvent.change(screen.getByLabelText("Persen termin 2"), { target: { value: "40" } });
    expect(screen.getByText("Total 90%, harus 100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan draft" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Persen termin 2"), { target: { value: "50" } });
    expect(screen.getByText("Total 100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan draft" })).toBeEnabled();
  });

  it("shows a sent quotation read-only with the same layout, PDF and revision", async () => {
    mockApi();
    const { container } = renderPage({ quotationId: "q1" });

    expect(await screen.findByRole("heading", { level: 1, name: "Quotation QT-2610-0001" })).toBeInTheDocument();
    const sheet = screen.getByRole("article", { name: "Dokumen quotation" });
    expect(within(sheet).getByText("QT-2610-0001")).toBeInTheDocument();
    expect(within(sheet).getByText("Sewa venue")).toBeInTheDocument();
    expect(within(sheet).getByText("Termasuk sound system")).toBeInTheDocument();
    expect(within(sheet).queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("Terkirim")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lihat PDF/ })).toHaveAttribute("href", "/api/sales-funnel/quotations/q1/pdf");
    expect(screen.getByRole("button", { name: /Buat revisi/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simpan draft" })).toBeNull();
    await waitFor(() => expect(within(sheet).getByText("PT Maju")).toBeInTheDocument());
    await expectAxeClean(container);
  });
});
