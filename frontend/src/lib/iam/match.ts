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
