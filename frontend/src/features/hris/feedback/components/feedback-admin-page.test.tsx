import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { cycle, expectAxeClean, mockFetch, Providers } from "../feedback.test-util";
import type { FeedbackApproval, FeedbackSummary } from "../types";
import { FeedbackAdminPage } from "./feedback-admin-page";
import { FeedbackApprovalsTab } from "./feedback-approvals-tab";
import { FeedbackResultsTab } from "./feedback-results-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function approval(over: Partial<FeedbackApproval> = {}): FeedbackApproval {
  return {
    id: "a-1",
    cycle_id: "c-1",
    employee_id: "e-1",
    reviewer_id: "e-1",
    relationship_type: "self",
    status: "submitted",
    due_date: null,
    submitted_at: "2026-10-20T03:00:00.000Z",
    approved_at: null,
    manager_comments: null,
    rejection_reason: null,
    employee: { id: "e-1", full_name: "Sari" },
    reviewer: { id: "e-1", full_name: "Sari" },
    cycle: { id: "c-1", name: "Review Q4 2026", period_label: "Q4 2026" },
    responses: [
      { id: "r-1", rating: 4, comments: "Rapi", criteria: { name: "Memenuhi komitmen", category: { name: "Accountability" } } },
      { id: "r-2", rating: 5, comments: null, criteria: { name: "Mendengarkan aktif", category: { name: "Communication" } } },
    ],
    ...over,
  };
}

function renderWith(ui: ReactElement) {
  return render(<Providers>{ui}</Providers>);
}

describe("FeedbackAdminPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows cycle progress and creates a cycle after validating the weights", async () => {
    const calls = mockFetch({
      "GET /api/hris/feedback-cycles": { data: [cycle()] },
      "POST /api/hris/feedback-cycles": { data: cycle({ id: "c-2" }) },
    });
    const { container } = renderWith(<FeedbackAdminPage />);
    expect(await screen.findByText("Review Q4 2026")).toBeInTheDocument();
    expect(screen.getByText("1/4 (25%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progres Review Q4 2026" })).toHaveAttribute("aria-valuenow", "25");
    await expectAxeClean(container);

    fireEvent.click(screen.getByRole("button", { name: "Siklus Baru" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nama siklus"), { target: { value: "Review 2027" } });
    fireEvent.change(within(dialog).getByLabelText("Label periode"), { target: { value: "2027" } });
    fireEvent.change(within(dialog).getByLabelText("Tanggal mulai"), { target: { value: "2027-01-01" } });
    fireEvent.change(within(dialog).getByLabelText("Tanggal selesai"), { target: { value: "2027-12-31" } });
    fireEvent.change(within(dialog).getByLabelText("Bobot KPI (%)"), { target: { value: "60" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    expect(toast.error).toHaveBeenCalledWith("Bobot KPI dan Feedback 360° harus berjumlah 100");
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Bobot Feedback 360° (%)"), { target: { value: "40" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "Anonim" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Review 2027",
      period_label: "2027",
      start_date: "2027-01-01",
      end_date: "2027-12-31",
      status: "draft",
      kpi_weight: 60,
      feedback_weight: 40,
      is_anonymous: false,
      allow_self_assessment: true,
      require_manager_review: true,
    });
  });
});

describe("FeedbackApprovalsTab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("approves the selected self-assessments in bulk and needs a reason to send one back", async () => {
    const calls = mockFetch({
      "GET /api/hris/feedback-approvals": {
        data: [approval(), approval({ id: "a-2", employee: { id: "e-2", full_name: "Tono" } })],
        stats: { total: 2, pending: 2, approved: 0, rejected: 0 },
      },
      "POST /api/hris/feedback-approvals": { message: "ok" },
    });
    const { container } = renderWith(<FeedbackApprovalsTab />);
    expect(await screen.findByText("Sari")).toBeInTheDocument();
    expect(screen.getAllByText("4.50")).toHaveLength(2);
    expect(calls[0].url).toBe("/api/hris/feedback-approvals?status=submitted&limit=100");
    await expectAxeClean(container);

    fireEvent.click(screen.getAllByRole("button", { name: "2 jawaban" })[0]);
    expect(screen.getByText("Memenuhi komitmen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Pilih Sari" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pilih Tono" }));
    fireEvent.click(screen.getByRole("button", { name: "Setujui 2 terpilih" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Setujui" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "approve", assignment_ids: ["a-1", "a-2"] });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Kembalikan" })[0]);
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Kembalikan" }));
    expect(toast.error).toHaveBeenCalledWith("Alasan pengembalian wajib diisi");
    fireEvent.change(within(dialog).getByLabelText("Alasan pengembalian"), { target: { value: "Tambah contoh" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kembalikan" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1].body).toEqual({
      action: "reject",
      assignment_ids: ["a-1"],
      rejection_reason: "Tambah contoh",
    });
  });
});

describe("FeedbackResultsTab", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ranks employees by final score with category scores and grades", async () => {
    const summary = (id: string, name: string, final: string | null, grade: string | null): FeedbackSummary => ({
      id,
      cycle_id: "c-1",
      employee_id: id,
      leadership_score: "100.00",
      communication_score: "80.00",
      collaboration_score: "60.00",
      accountability_score: null,
      problem_solving_score: "80.00",
      overall_360_score: "80.00",
      kpi_score: final ? "90.00" : null,
      final_score: final,
      final_grade: grade,
      is_locked: id === "s-1",
      employee: { id, full_name: name, department: { name: "Ops" } },
    });
    const calls = mockFetch({
      "GET /api/hris/feedback-summaries": {
        data: [summary("s-2", "Tanpa KPI", null, null), summary("s-1", "Sari", "87.00", "B")],
      },
    });
    const { container } = renderWith(<FeedbackResultsTab cycles={[cycle()]} cycleId="c-1" onCycleChange={() => {}} />);
    expect(await screen.findByText("Sari")).toBeInTheDocument();
    expect(calls[0].url).toBe("/api/hris/feedback-summaries?cycle_id=c-1&limit=500");
    expect(screen.getByText(/KPI × 70% \+ 360° × 30%/)).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Sari")).toBeInTheDocument();
    expect(within(rows[0]).getByText("87.0")).toBeInTheDocument();
    expect(within(rows[0]).getByText("B")).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText("Terkunci")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Tanpa KPI")).toBeInTheDocument();
    await expectAxeClean(container);
  });
});
