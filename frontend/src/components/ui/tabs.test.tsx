import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * Regression: seluruh utility layout Tabs memakai konvensi atribut boolean
 * (`data-horizontal:flex-col`, `group-data-horizontal/tabs:h-8`,
 * `group-data-vertical/tabs:flex-col`, garis bawah `after:*`), yang di CSS
 * jadi selector `[data-horizontal]` / `[data-vertical]`. Base UI hanya
 * merender `data-orientation="horizontal"`, jadi tanpa atribut boleannya
 * SEMUA aturan itu tidak match: root tetap flex-row → daftar tab tampil di
 * SAMPING panel, bukan di atasnya.
 */
describe("Tabs", () => {
  const renderTabs = (orientation?: "horizontal" | "vertical") =>
    render(
      <Tabs defaultValue="a" orientation={orientation}>
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Isi A</TabsContent>
      </Tabs>
    );

  test("root menandai orientasi horizontal dengan atribut boolean data-horizontal", () => {
    // Arrange & Act
    const { container } = renderTabs();

    // Assert
    const root = container.querySelector("[data-slot=tabs]");
    expect(root?.hasAttribute("data-horizontal")).toBe(true);
    expect(root?.hasAttribute("data-vertical")).toBe(false);
  });

  test("root menandai orientasi vertical dengan atribut boolean data-vertical", () => {
    // Arrange & Act
    const { container } = renderTabs("vertical");

    // Assert
    const root = container.querySelector("[data-slot=tabs]");
    expect(root?.hasAttribute("data-vertical")).toBe(true);
    expect(root?.hasAttribute("data-horizontal")).toBe(false);
  });

  test("tetap merender data-orientation dan isi tab terpilih", () => {
    // Arrange & Act
    const { container } = renderTabs();

    // Assert
    const root = container.querySelector("[data-slot=tabs]");
    expect(root?.getAttribute("data-orientation")).toBe("horizontal");
    // getByText melempar kalau elemennya tidak ada.
    expect(screen.getByText("Tab A").textContent).toBe("Tab A");
    expect(screen.getByText("Isi A").textContent).toBe("Isi A");
  });
});
