import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

/**
 * Regression: Base UI me-render value MENTAH (kode/UUID) di trigger kalau
 * Root tidak diberi `items`. Wrapper Select harus menderivasi items dari
 * children supaya label item terpilih yang tampil.
 */
describe("Select", () => {
  test("menampilkan label item terpilih, bukan value mentah", () => {
    // Arrange
    const uuid = "90bbc9f3-323e-4a0b-96a0-0e3a5c5fe1b5";

    // Act
    render(
      <Select value={uuid}>
        <SelectTrigger>
          <SelectValue placeholder="Pilih Outlet" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={uuid}>Sulu Bandung</SelectItem>
          <SelectItem value="lain">Outlet Lain</SelectItem>
        </SelectContent>
      </Select>
    );

    // Assert
    expect(screen.getByText("Sulu Bandung")).toBeInTheDocument();
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });

  test("menampilkan placeholder saat belum ada value", () => {
    render(
      <Select value={null}>
        <SelectTrigger>
          <SelectValue placeholder="Pilih Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="applied">Applied</SelectItem>
        </SelectContent>
      </Select>
    );

    expect(screen.getByText("Pilih Status")).toBeInTheDocument();
  });

  test("item di dalam SelectGroup tetap terderivasi labelnya", () => {
    render(
      <Select value="hired">
        <SelectTrigger>
          <SelectValue placeholder="Pilih Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="applied">Applied</SelectItem>
            <SelectItem value="hired">Diterima</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );

    expect(screen.getByText("Diterima")).toBeInTheDocument();
  });

  test("items eksplisit dari caller tidak ditimpa", () => {
    render(
      <Select value="a" items={{ a: "Label Custom" }}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Label Children</SelectItem>
        </SelectContent>
      </Select>
    );

    expect(screen.getByText("Label Custom")).toBeInTheDocument();
  });
});
