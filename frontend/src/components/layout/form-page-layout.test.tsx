import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "./form-page-layout";

describe("FormPageLayout", () => {
  it("renders full-width shell without max-width constraint", () => {
    const { container } = render(
      <FormPageLayout>
        <p>Form content</p>
      </FormPageLayout>
    );

    const shell = container.firstChild as HTMLElement;
    expect(shell.className).toContain("w-full");
    expect(shell.className).not.toContain("max-w-");
    expect(shell.className).not.toContain("mx-auto");
    expect(screen.getByText("Form content")).toBeInTheDocument();
  });

  it("renders header with title, description, and back action", () => {
    const onBack = vi.fn();

    render(
      <FormPageHeader
        title="Tambah Karyawan"
        description="Data kepegawaian"
        onBack={onBack}
      />
    );

    expect(screen.getByRole("heading", { name: "Tambah Karyawan" })).toBeInTheDocument();
    expect(screen.getByText("Data kepegawaian")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /kembali/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders body and footer sections", () => {
    render(
      <FormPageLayout>
        <FormPageBody>
          <input aria-label="nama" />
        </FormPageBody>
        <FormPageFooter>
          <button type="button">Simpan</button>
        </FormPageFooter>
      </FormPageLayout>
    );

    expect(screen.getByLabelText("nama")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan" })).toBeInTheDocument();
  });

  it("renders loading state", () => {
    const { container } = render(<FormPageLoading />);
    const loader = container.querySelector(".animate-spin");
    expect(loader).toBeTruthy();
  });
});
