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
  test("keeps submit disabled until the values are valid, then sends E.164 and the consents", async () => {
    window.dataLayer = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { lead_id: "lead-1", branch_name: "NüHabit Kemang" } }), { status: 200 }),
    );
    render(<TrialForm branches={branches} sourcePath="/locations/kemang" />);

    const submit = screen.getByRole("button", { name: /Request a free trial/ });
    expect(submit).toBeDisabled();
    expect(screen.getByText(CONSENT_EMAIL_TEXT)).toBeInTheDocument();
    expect(window.dataLayer).toEqual([{ event: "trial_open", branch: null }]);

    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "kemang" } });
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("WhatsApp number"), { target: { value: "0812 3456 7890" } });
    fireEvent.click(screen.getByRole("switch", { name: CONSENT_EMAIL_TEXT }));
    expect(submit).toBeEnabled();
    expect(window.dataLayer).toContainEqual({ event: "studio_select", branch: "kemang" });

    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The NüHabit Kemang team will contact you"));

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

  test("shows a server error and keeps the form editable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Branch not found" }), { status: 404 }),
    );
    render(<TrialForm branches={branches} defaultBranch="bsd" />);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("WhatsApp number"), { target: { value: "81234567890" } });
    fireEvent.click(screen.getByRole("button", { name: /Request a free trial/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Branch not found"));
    expect(screen.getByRole("button", { name: /Request a free trial/ })).toBeEnabled();
  });

  test("reads the branch list from the API when no branches prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: branches }), { status: 200 }),
    );
    render(<TrialForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "NüHabit BSD" })).toBeInTheDocument());
  });
});
