import { describe, expect, it } from "vitest";
import type { MenuItem } from "@/lib/iam/menu-types";
import { buildParentOptions, defaultFormValues, effectiveModule, toPayload } from "./menu-form";

function menu(id: string, parentId: string | null, level: number, module: string | null = null): MenuItem {
  return {
    id,
    parentId,
    code: id,
    menuName: `Menu ${id}`,
    routePath: null,
    module,
    menuType: "sidebar",
    icon: null,
    orderNumber: 0,
    level,
    isActive: true,
    isVisible: true,
  };
}

const menus = [menu("hr", null, 0, "hris"), menu("hr-emp", "hr", 1), menu("hr-emp-x", "hr-emp", 2), menu("pos", null, 0)];

describe("menu form", () => {
  it("opsi parent membuang menu itu sendiri dan turunannya", () => {
    expect(buildParentOptions(menus, "hr-emp").map((o) => o.id)).toEqual(["hr", "pos"]);
  });

  it("module kosong mewarisi parent", () => {
    expect(effectiveModule({ ...defaultFormValues("hr"), module: "" }, menus)).toBe("hris");
    expect(effectiveModule({ ...defaultFormValues("hr"), module: "custom" }, menus)).toBe("custom");
    expect(effectiveModule(defaultFormValues(null), menus)).toBe("");
  });

  it("payload: string kosong jadi undefined, aksi minimal read", () => {
    const payload = toPayload({ ...defaultFormValues(null), menuName: " HR ", permissionActions: [] });
    expect(payload).toMatchObject({ menuName: "HR", description: undefined, permissionContext: { actions: ["read"] } });
  });
});
