import { describe, expect, it } from "vitest";
import {
  getGrantChecked,
  permissionPayload,
  setGrantWithDescendants,
  toggleAction,
  visibleMenuItems,
} from "./permission-tree";
import type { RoleMenuPermission } from "./types";

function perm(menuId: string, parentId: string | null, extra: Partial<RoleMenuPermission> = {}): RoleMenuPermission {
  return {
    menuId,
    menuCode: `code.${menuId}`,
    menuName: `Menu ${menuId}`,
    menuType: "sidebar",
    parentId,
    level: parentId ? 1 : 0,
    orderNumber: 0,
    availableActions: ["read", "create"],
    grantedActions: [],
    isGranted: false,
    ...extra,
  };
}

const perms = [perm("root", null), perm("a", "root"), perm("b", "root"), perm("other", null)];
const draftOf = (list: RoleMenuPermission[]) => new Map(list.map((p) => [p.menuId, p]));

describe("setGrantWithDescendants", () => {
  it("grant menyebar ke semua turunan dengan aksi pertama", () => {
    const next = setGrantWithDescendants(draftOf(perms), "root", true);
    expect(["root", "a", "b", "other"].map((id) => next.get(id)?.isGranted)).toEqual([true, true, true, false]);
    expect(next.get("a")?.grantedActions).toEqual(["read"]);
    expect(setGrantWithDescendants(next, "root", false).get("b")?.grantedActions).toEqual([]);
  });
});

describe("getGrantChecked", () => {
  it("parent tercentang bila semua anak tercentang", () => {
    const draft = draftOf([perm("root", null), perm("a", "root", { isGranted: true }), perm("b", "root", { isGranted: true })]);
    const byParent = new Map([["root", [draft.get("a")!, draft.get("b")!]]]);
    expect(getGrantChecked("root", draft, byParent)).toBe(true);
  });
});

describe("toggleAction & payload", () => {
  it("aksi terakhir yang dilepas kembali ke read; menu tanpa grant tidak berubah", () => {
    const granted = perm("a", null, { isGranted: true, grantedActions: ["create"] });
    expect(toggleAction(granted, "create").grantedActions).toEqual(["read"]);
    expect(toggleAction(granted, "read").grantedActions).toEqual(["create", "read"]);
    expect(toggleAction(perm("b", null), "read").grantedActions).toEqual([]);
    expect(permissionPayload([granted, perm("b", null)])).toEqual([
      { menuId: "a", isGranted: true, grantedActions: ["create"] },
    ]);
  });
});

describe("visibleMenuItems", () => {
  it("hasil cari menyertakan leluhur", () => {
    expect(visibleMenuItems(perms, "menu a").map((m) => m.id)).toEqual(["root", "a"]);
    expect(visibleMenuItems(perms, "")).toHaveLength(4);
  });
});
