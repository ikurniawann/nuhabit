import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PublicCrmForm } from "./public-crm-form";

const definition = {
  slug: "contact",
  title: "Hubungi kami",
  description: null,
  submit_label: "Kirim",
  success_message: "Terima kasih! Kami membalas lewat email.",
  redirect_url: null,
  fields: [
    { key: "pic_name", label: "Nama", type: "text", required: true, placeholder: null, help_text: null, options: [], width: 1 },
    { key: "pic_email", label: "Email", type: "email", required: true, placeholder: null, help_text: null, options: [], width: 1 },
    { key: "topic", label: "Topik", type: "select", required: false, placeholder: null, help_text: null, options: ["Kelas", "Apparel"], width: 1 },
    { key: "agree", label: "Setuju", type: "checkbox", required: false, placeholder: null, help_text: "Saya setuju dihubungi", options: [], width: 1 },
  ],
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("PublicCrmForm", () => {
  test("mengambil definisi lewat slug, merender pilihan dan centang, lalu mengirim", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: definition }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { message: definition.success_message, redirect_url: null } }), { status: 200 }));
    const onSubmitted = vi.fn();
    renderWithQuery(<PublicCrmForm slug="contact" onSubmitted={onSubmitted} />);

    await waitFor(() => expect(screen.getByLabelText(/Nama/)).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/public/crm/forms/contact");
    expect(screen.getByRole("option", { name: "Apparel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Saya setuju dihubungi")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Nama/), { target: { value: "Ani" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "ani@example.test" } });
    fireEvent.change(screen.getByLabelText("Topik"), { target: { value: "Apparel" } });
    fireEvent.click(screen.getByLabelText("Saya setuju dihubungi"));
    fireEvent.click(screen.getByRole("button", { name: "Kirim" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(definition.success_message));
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body).toMatchObject({ pic_name: "Ani", pic_email: "ani@example.test", topic: "Apparel", agree: true });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  test("slug tak dikenal menampilkan galat", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "Form tidak ditemukan" }), { status: 404 }),
    );
    renderWithQuery(<PublicCrmForm slug="tidak-ada" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Form tidak ditemukan"));
  });
});
