import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CONSENT_EMAIL_TEXT } from "./consent";
import { TrialForm } from "./trial-form";

const branches = [
  { slug: "kemang", name: "NüHabit Kemang" },
  { slug: "bsd", name: "NüHabit BSD" },
];

afterEach(() => {
  vi.restoreAllMocks();
  window.dataLayer = undefined;
});

describe("TrialForm", () => {
  test("tombol kirim mati sampai isian valid, lalu mengirim E.164 dan persetujuan", async () => {
    window.dataLayer = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { lead_id: "lead-1", branch_name: "NüHabit Kemang" } }), { status: 200 }),
    );
    render(<TrialForm branches={branches} sourcePath="/locations/kemang" />);

    const submit = screen.getByRole("button", { name: /Ajukan coba gratis/ });
    expect(submit).toBeDisabled();
    expect(screen.getByText(CONSENT_EMAIL_TEXT)).toBeInTheDocument();
    expect(window.dataLayer).toEqual([{ event: "trial_open", branch: null }]);

    fireEvent.change(screen.getByLabelText("Cabang"), { target: { value: "kemang" } });
    fireEvent.change(screen.getByLabelText("Nama depan"), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "0812 3456 7890" } });
    fireEvent.click(screen.getByRole("switch", { name: CONSENT_EMAIL_TEXT }));
    expect(submit).toBeEnabled();
    expect(window.dataLayer).toContainEqual({ event: "studio_select", branch: "kemang" });

    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tim NüHabit Kemang akan menghubungi"));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/public/site/trial");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      branch_slug: "kemang",
      first_name: "Ani",
      email: "ani@example.test",
      phone: "+6281234567890",
      consent_email: true,
      consent_sms: false,
      source_path: "/locations/kemang",
      website_url: "",
    });
    expect(typeof body.form_started_at).toBe("number");
    expect(window.dataLayer).toContainEqual({ event: "lead_submit", form: "trial", branch: "kemang", lead_id: "lead-1" });
  });

  test("galat server tampil dan form tetap bisa diisi", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Cabang tidak ditemukan" }), { status: 404 }),
    );
    render(<TrialForm branches={branches} defaultBranch="bsd" />);
    fireEvent.change(screen.getByLabelText("Nama depan"), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "81234567890" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajukan coba gratis/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Cabang tidak ditemukan"));
    expect(screen.getByRole("button", { name: /Ajukan coba gratis/ })).toBeEnabled();
  });

  test("tanpa prop branches, daftar cabang diambil dari API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: branches }), { status: 200 }),
    );
    render(<TrialForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "NüHabit BSD" })).toBeInTheDocument());
  });
});
