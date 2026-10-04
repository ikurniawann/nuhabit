import { describe, expect, it } from "vitest";
import { buildNavBreadcrumbs } from "@/lib/iam/nav-breadcrumbs";
import type { NavItem } from "@/lib/iam/types";

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Beranda", icon: "home" },
  {
    href: "#",
    label: "User Management",
    icon: "users",
    children: [
      {
        href: "/dashboard/settings/menus",
        label: "Menu Configuration",
        icon: "sitemap",
      },
      {
        href: "/dashboard/employees",
        label: "Users",
        icon: "users",
      },
    ],
  },
];

describe("buildNavBreadcrumbs", () => {
  it("returns home only on dashboard root", () => {
    expect(buildNavBreadcrumbs(navItems, "/dashboard")).toEqual([{ label: "Beranda" }]);
  });

  it("builds nested trail from IAM nav tree", () => {
    expect(buildNavBreadcrumbs(navItems, "/dashboard/settings/menus")).toEqual([
      { label: "Beranda", href: "/dashboard" },
      { label: "User Management" },
      { label: "Menu Configuration" },
    ]);
  });

  it("appends detail segment for deeper paths", () => {
    expect(buildNavBreadcrumbs(navItems, "/dashboard/settings/menus/new")).toEqual([
      { label: "Beranda", href: "/dashboard" },
      { label: "User Management" },
      { label: "Menu Configuration", href: "/dashboard/settings/menus" },
      { label: "New" },
    ]);
  });

  it("prefers the specific page over a prefix match in a sibling group", () => {
    const crm: NavItem[] = [
      {
        href: "/dashboard/crm",
        label: "CRM",
        icon: "star",
        children: [
          {
            href: "#",
            label: "Overview",
            icon: "chart",
            children: [{ href: "/dashboard/crm", label: "Dashboard", icon: "chart" }],
          },
          {
            href: "#",
            label: "Engagement",
            icon: "megaphone",
            children: [{ href: "/dashboard/crm/challenges", label: "Challenge", icon: "star" }],
          },
        ],
      },
    ];
    expect(buildNavBreadcrumbs(crm, "/dashboard/crm/challenges").map((c) => c.label)).toEqual([
      "Beranda",
      "CRM",
      "Engagement",
      "Challenge",
    ]);
  });
});

