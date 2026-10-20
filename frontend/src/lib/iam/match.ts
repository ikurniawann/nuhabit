/** Pure IAM matchers — aman di client dan server (tanpa akses DB). */

export function hasIamMenuCode(grantedCodes: readonly string[], code: string): boolean {
  return grantedCodes.includes(code);
}

/** True bila user punya menu exact atau anak di bawah prefix (mis. `items.product`). */
export function hasAnyIamMenuPrefix(
  grantedCodes: readonly string[],
  prefixes: readonly string[]
): boolean {
  return grantedCodes.some((code) =>
    prefixes.some((prefix) => code === prefix || code.startsWith(`${prefix}.`))
  );
}

/**
 * Versi objek dari hasGrantedAction untuk data yang dikirim server ke klien
 * (`{ [menuCode]: actions[] }`). Aturannya sama dengan guard Go: menu exact
 * atau turunannya, salah satu prefix cukup.
 */
export function canAct(
  grantedActions: Readonly<Record<string, readonly string[]>>,
  menus: string | readonly string[],
  action: string
): boolean {
  const prefixes = typeof menus === "string" ? [menus] : menus;
  return Object.entries(grantedActions).some(
    ([code, actions]) => actions.includes(action) && hasAnyIamMenuPrefix([code], prefixes)
  );
}

/** True bila salah satu menu di bawah prefix punya action (create/update/delete/approve). */
export function hasGrantedAction(
  grantedActions: ReadonlyMap<string, readonly string[]>,
  prefixes: readonly string[],
  action: string
): boolean {
  for (const [code, actions] of grantedActions) {
    if (!hasAnyIamMenuPrefix([code], prefixes)) continue;
    if (actions.includes(action)) return true;
  }
  return false;
}
