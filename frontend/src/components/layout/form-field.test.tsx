import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormFieldLabel } from "./form-field";

/**
 * Regression: axe melaporkan input dan select tanpa nama karena
 * FormFieldLabel dirender tanpa `htmlFor`. Label harus terikat ke kontrolnya
 * lewat pasangan `htmlFor` dan `id`.
 */
describe("FormFieldLabel", () => {
  test("memberi nama ke Input lewat htmlFor", () => {
    render(
      <>
        <FormFieldLabel htmlFor="fy-code" required>
          Kode
        </FormFieldLabel>
        <Input id="fy-code" />
      </>
    );

    expect(screen.getByLabelText(/Kode/)).toBe(screen.getByRole("textbox"));
  });

  test("memberi nama ke trigger Select", () => {
    render(
      <>
        <FormFieldLabel htmlFor="coa-type">Tipe akun</FormFieldLabel>
        <Select value="asset">
          <SelectTrigger id="coa-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asset">Aset</SelectItem>
          </SelectContent>
        </Select>
      </>
    );

    expect(screen.getByRole("combobox", { name: "Tipe akun" })).toBeInTheDocument();
  });

  test("memberi nama ke Combobox", () => {
    render(
      <>
        <FormFieldLabel htmlFor="table-floor">Lantai</FormFieldLabel>
        <Combobox
          id="table-floor"
          options={[{ value: "1", label: "Lantai 1" }]}
          value="1"
          onChange={() => {}}
        />
      </>
    );

    expect(screen.getByRole("button", { name: "Lantai" })).toHaveAttribute("id", "table-floor");
  });
});
