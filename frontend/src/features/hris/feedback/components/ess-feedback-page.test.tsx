import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { detail, expectAxeClean, mockFetch, Providers } from "../feedback.test-util";
import { EssFeedbackPage } from "./ess-feedback-page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = (over: Record<string, unknown> = {}) => {
  const { categories: _c, responses: _r, editable: _e, ...rest } = detail();
  return { ...rest, ...over };
};

function renderPage(routes: Record<string, unknown>) {
  const calls = mockFetch(routes);
  const view = render(
    <Providers>
      <EssFeedbackPage />
    </Providers>
  );
  return { calls, ...view };
}

describe("EssFeedbackPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists my reviews, opens one, keeps submit off until every criterion is rated, then sends the answers", async () => {
    const { calls, container } = renderPage({
      "GET /api/hris/me/feedback-360": {
        data: [item(), item({ id: "a-2", relationship_type: "self", status: "submitted", answered: 3 })],
        criteria_total: 3,
      },
      "GET /api/hris/me/feedback-360/a-1": { data: detail() },
      "PUT /api/hris/me/feedback-360/a-1": { message: "Penilaian terkirim", data: { id: "a-1", status: "submitted" } },
    });

    expect(await screen.findByText("1 penilaian menunggu Anda.")).toBeInTheDocument();
    expect(screen.getByText("1/3 kriteria")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buka penilaian Penilaian diri" })).toBeInTheDocument();
    await expectAxeClean(container);

    fireEvent.click(screen.getByRole("button", { name: "Buka penilaian Budi" }));
    expect(await screen.findByRole("heading", { name: "Budi" })).toBeInTheDocument();
    expect(screen.getByText(/Nama Anda tidak ditampilkan/)).toBeInTheDocument();
    const menetapkan = screen.getByRole("group", { name: "Menetapkan arah" });
    expect(menetapkan.querySelector<HTMLInputElement>('input[value="4"]')?.checked).toBe(true);
    expect(screen.getByText("1 dari 3 kriteria dinilai")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Kirim Penilaian" });
    expect(submit).toBeDisabled();

    const motivate = screen.getByRole("group", { name: "Memotivasi" });
    fireEvent.click(motivate.querySelector('input[value="5"]') as HTMLInputElement);
    fireEvent.click(screen.getByRole("group", { name: "Mendengarkan" }).querySelector('input[value="3"]') as HTMLInputElement);
    fireEvent.change(screen.getByLabelText("Catatan untuk Mendengarkan"), { target: { value: " Sabar " } });
    expect(screen.getByText("3 dari 3 kriteria dinilai")).toBeInTheDocument();
    await expectAxeClean(container);

    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      submit: true,
      responses: [
        { criteria_id: "cr-1", rating: 4, comments: "Jelas" },
        { criteria_id: "cr-2", rating: 5, comments: null },
        { criteria_id: "cr-3", rating: 3, comments: "Sabar" },
      ],
    });
    // Terkirim: kembali ke daftar.
    expect(await screen.findByText("1 penilaian menunggu Anda.")).toBeInTheDocument();
  });

  it("shows the HR rejection reason and locks a submitted review", async () => {
    renderPage({
      "GET /api/hris/me/feedback-360": { data: [item({ status: "rejected" }), item({ id: "a-2", status: "submitted" })], criteria_total: 3 },
      "GET /api/hris/me/feedback-360/a-1": { data: detail({ status: "rejected", rejection_reason: "Lengkapi catatan" }) },
      "GET /api/hris/me/feedback-360/a-2": { data: detail({ id: "a-2", status: "submitted", editable: false }) },
    });
    const cards = await screen.findAllByRole("button", { name: "Buka penilaian Budi" });
    fireEvent.click(cards[0]);
    expect(await screen.findByText(/Dikembalikan HR: Lengkapi catatan/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan Draf" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Kembali ke daftar" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Buka penilaian Budi" }))[1]);
    expect(await screen.findByText("Penilaian ini sudah dikirim dan tidak bisa diubah lagi.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kirim Penilaian" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Menetapkan arah" })).toBeDisabled();
  });

  it("explains when nothing is assigned", async () => {
    renderPage({ "GET /api/hris/me/feedback-360": { data: [], criteria_total: 15 } });
    expect(await screen.findByText("Belum ada penilaian yang ditugaskan kepada Anda di siklus aktif.")).toBeInTheDocument();
  });
});
