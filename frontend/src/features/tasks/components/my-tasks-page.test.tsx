import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyTasksPage } from "./my-tasks-page";
import { expectAxeClean, item, mockApi, Providers, TODAY } from "./test-helpers";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

describe("MyTasksPage", () => {
  it("lists overdue rows first, then today's, review and approved, and is axe clean", async () => {
    mockApi([
      item({ title: "Rapat pagi", occurrence_date: TODAY }),
      item({ title: "Laporan kemarin", occurrence_date: "2026-10-25", overdue: true, priority: "urgent" }),
      item({ title: "Tunggu kepala", status: "done", review_required: true }),
      item({ title: "Sudah beres", status: "approved" }),
    ]);
    const { container } = render(
      <Providers>
        <MyTasksPage />
      </Providers>
    );
    await screen.findByText("Laporan kemarin");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Terlambat · 1", "Hari ini · 1", "Menunggu review · 1", "Selesai · 1"]);
    expect(screen.getByText("Mendesak")).toBeInTheDocument();
    expect(screen.getByText("2 terbuka, 1 terlambat, 1 menunggu review, 1 selesai.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Papan tim" })).toHaveAttribute("href", "/dashboard/tasks/team");
    await expectAxeClean(container);
  });

  it("adds a personal task from the quick capture box and clears it", async () => {
    const calls = mockApi([]);
    render(
      <Providers>
        <MyTasksPage />
      </Providers>
    );
    const input = await screen.findByLabelText("Tambah tugas");
    fireEvent.change(input, { target: { value: "Kirim laporan stok besok !!" } });
    expect(screen.getByText("jatuh tempo 2026-10-27 · prioritas urgent")).toBeInTheDocument();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      title: "Kirim laporan stok",
      recurrence: "once",
      weekly_day: null,
      monthly_day: null,
      due_date: "2026-10-27",
      priority: "urgent",
      assignee_employee_id: "e-alice",
      department_id: "d-ops",
      subtasks: [],
    });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("marks a task done from its checkbox", async () => {
    const calls = mockApi([item({ occurrence_id: "o-1", title: "Centang aku" })]);
    render(
      <Providers>
        <MyTasksPage />
      </Providers>
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: "Selesaikan Centang aku" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/hris/dept-tasks/occurrences/o-1")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ action: "done" });
  });
});
