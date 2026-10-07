import { describe, expect, it } from "vitest";
import { flattenModuleNavLinks } from "@/lib/iam/get-user-menus";
import type { NavItem } from "@/lib/iam/types";

describe("flattenModuleNavLinks", () => {
  it("flattens group nodes and skips placeholder hrefs", () => {
    const items: NavItem[] = [
      {
        href: "#",
        label: "Operasional",
        icon: "shopping",
        children: [
          {
            href: "/dashboard/pos/cashier-new",
            label: "Kasir",
            icon: "shopping",
          },
          {
            href: "/dashboard/pos/restaurant",
            label: "Restaurant",
            icon: "clipboard",
          },
        ],
      },
      {
        href: "#",
        label: "Laporan",
        icon: "chart",
        children: [
          {
            href: "/dashboard/pos",
            label: "Dashboard",
            icon: "home",
          },
        ],
      },
    ];

    expect(flattenModuleNavLinks(items)).toEqual([
      {
        href: "/dashboard/pos/cashier-new",
        label: "Kasir",
        icon: "shopping",
      },
      {
        href: "/dashboard/pos/restaurant",
        label: "Restaurant",
        icon: "clipboard",
      },
      {
        href: "/dashboard/pos",
        label: "Dashboard",
        icon: "home",
      },
    ]);
  });
});
