import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PublicCrmForm } from "./public-crm-form";

const definition = {
  slug: "contact",
  title: "Get in touch",
  description: null,
  submit_label: "Send",
  success_message: "Thank you! We reply by email.",
  redirect_url: null,
  fields: [
    { key: "pic_name", label: "Name", type: "text", required: true, placeholder: null, help_text: null, options: [], width: 1 },
    { key: "pic_email", label: "Email", type: "email", required: true, placeholder: null, help_text: null, options: [], width: 1 },
    { key: "topic", label: "Topic", type: "select", required: false, placeholder: null, help_text: null, options: ["Classes", "Apparel"], width: 1 },
    { key: "agree", label: "Agree", type: "checkbox", required: false, placeholder: null, help_text: "I agree to be contacted", options: [], width: 1 },
  ],
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("PublicCrmForm", () => {
  test("loads the definition by slug, renders selects and checkboxes, then submits", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: definition }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { message: definition.success_message, redirect_url: null } }), { status: 200 }));
    const onSubmitted = vi.fn();
    renderWithQuery(<PublicCrmForm slug="contact" onSubmitted={onSubmitted} />);

    await waitFor(() => expect(screen.getByLabelText(/Name/)).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/public/crm/forms/contact");
    expect(screen.getByRole("option", { name: "Apparel" })).toBeInTheDocument();
    expect(screen.getByLabelText("I agree to be contacted")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Apparel" } });
    fireEvent.click(screen.getByLabelText("I agree to be contacted"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(definition.success_message));
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body).toMatchObject({ pic_name: "Ani", pic_email: "ani@example.test", topic: "Apparel", agree: true });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  test("shows an error for an unknown slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Form not found" }), { status: 404 }),
    );
    renderWithQuery(<PublicCrmForm slug="missing" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Form not found"));
  });
});
