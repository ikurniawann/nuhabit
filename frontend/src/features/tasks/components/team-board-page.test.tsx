import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamBoardPage } from "./team-board-page";
import { expectAxeClean, item, mockApi, Providers } from "./tasks.test-util";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

describe("TeamBoardPage", () => {
  it("shows the head's department board with one column per status", async () => {
    const calls = mockApi([
      item({ title: "Belum mulai" }),
      item({ title: "Sedang jalan", status: "in_progress", progress: 40, assignee_name: "Bob", assignee_employee_id: "e-bob", last_note: "Rak A sudah" }),
      item({ title: "Tunggu review", status: "done", review_required: true }),
      item({ title: "Disetujui kemarin", status: "approved" }),
    ]);
    const { container } = render(
      <Providers>
        <TeamBoardPage />
      </Providers>
    );
    await screen.findByText("Belum mulai");
    const list = calls.find((c) => c.url.startsWith("/api/hris/dept-tasks/items?"));
    expect(list?.url).toContain("scope=team");
    expect(list?.url).toContain("department_id=d-ops");
    const doing = screen.getByRole("region", { name: /Dikerjakan/ });
    expect(within(doing).getByText("Sedang jalan")).toBeInTheDocument();
    expect(within(doing).getByText("PJ: Bob")).toBeInTheDocument();
    expect(within(doing).getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Ditolak/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Task baru" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Pemantauan" })).toBeInTheDocument();
    await expectAxeClean(container);
  });
});
