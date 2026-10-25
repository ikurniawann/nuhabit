import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Document, Update } from "../api";
import { InvestorDocumentsPage } from "./documents-page";
import { InvestorProgressPage } from "./progress-page";

const update: Update = {
  id: "u1",
  title: "Cabang kedua dibuka",
  body: "Kemang buka 1 April.\nTarget 300 member di kuartal pertama.",
  status: "published",
  published_at: "2031-03-20T03:00:00.000Z",
  updated_at: "2031-03-20T03:00:00.000Z",
  attachments: [{ id: "a1", name: "rencana.pdf", mime: "application/pdf", size_bytes: 320 * 1024, url: "/api/files/investor-updates/x.pdf", created_at: "2031-03-20T03:00:00.000Z" }],
};
const document_: Document = { ...update.attachments[0], update_id: "u1", update_title: update.title, published_at: update.published_at! };

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../api")>();
  return {
    ...mod,
    investorApi: {
      ...mod.investorApi,
      updates: vi.fn(async () => [update]),
      documents: vi.fn(async () => [document_]),
    },
  };
});

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pelanggaran WCAG 2 A/AA berdampak serius atau kritis. */
async function seriousViolations(container: HTMLElement) {
  const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`);
}

describe("halaman investor", () => {
  afterEach(() => vi.clearAllMocks());

  test("Progres menampilkan update terbit beserta lampiran, bebas pelanggaran axe", async () => {
    const { container } = render(wrap(<InvestorProgressPage />));
    expect(await screen.findByRole("heading", { name: "Cabang kedua dibuka" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /rencana\.pdf/ })).toHaveAttribute("href", "/api/files/investor-updates/x.pdf");
    expect(screen.getByText(/300 member/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  test("Dokumen mendaftar lampiran dengan tautan unduh bernama, bebas pelanggaran axe", async () => {
    const { container } = render(wrap(<InvestorDocumentsPage />));
    expect(await screen.findByRole("table", { name: "Dokumen investor" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unduh rencana.pdf" })).toBeInTheDocument();
    expect(screen.getByText("320 KB")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});
