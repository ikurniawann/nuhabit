import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PaymentModal } from "./payment-modal";

vi.mock("@/features/pos/payment-methods", () => ({
  usePaymentMethods: () => ({ data: undefined }),
}));
vi.mock("@/lib/pos-api", () => ({ cancelCheckout: vi.fn(async () => ({ success: true })) }));
vi.mock("@/components/pos/QrisCard", () => ({ QrisCard: () => <div>QR</div> }));

const fmt = (v: number) => `Rp ${v}`;

function stubQrisFetch(paid: boolean) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === "/api/pos/qris") {
      return new Response(
        JSON.stringify({ data: { amount: 50000, qr_string: "000201", qr_id: "qr_1", reference_id: "ref_1" } }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ data: { paid } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderModal(overrides: Partial<Parameters<typeof PaymentModal>[0]> = {}) {
  const props: Parameters<typeof PaymentModal>[0] = {
    open: true,
    total: 50000,
    totalAfterArk: 50000,
    selectedCustomer: null,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    formatCurrency: fmt,
    formatArk: fmt,
    onTapNFC: vi.fn(),
    onPrepareOrderQris: vi.fn(async () => ({ order_id: "ord_1", order_number: "A-1" })),
    onAbandonOrderQris: vi.fn(async () => {}),
    ...overrides,
  };
  const view = render(<PaymentModal {...props} />);
  return { props, view };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("PaymentModal", () => {
  it("confirms an exact cash payment", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText("Uang Pas"));
    fireEvent.click(screen.getByText("Confirm payment"));
    expect(props.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ method: "cash", cashReceived: "50000", paymentMethodCode: "cash" })
    );
  });

  it("settles QRIS automatically once Xendit reports paid and keeps the order on close", async () => {
    const fetchMock = stubQrisFetch(true);
    const { props, view } = renderModal();
    fireEvent.click(screen.getByText("QRIS"));

    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1));
    expect(props.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ method: "qris", orderId: "ord_1", xenditQrId: "qr_1" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ order_id: "ord_1", amount: 50000 });

    view.rerender(<PaymentModal {...props} open={false} />);
    expect(props.onAbandonOrderQris).not.toHaveBeenCalled();
  });

  it("abandons the prepared order when the cashier picks another method", async () => {
    stubQrisFetch(false);
    const { props } = renderModal();
    fireEvent.click(screen.getByText("QRIS"));

    fireEvent.click(await screen.findByText("Pilih metode lain"));
    await waitFor(() => expect(props.onAbandonOrderQris).toHaveBeenCalledWith("ord_1"));
    expect(screen.getByText("Amount received")).toBeTruthy();
  });
});
