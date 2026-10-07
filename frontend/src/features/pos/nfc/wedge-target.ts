/**
 * Keyboard-wedge NFC must not treat typing in normal fields (product search,
 * promo, etc.) as a card scan. Opt-in with data-pos-nfc-wedge="allow".
 */
export function shouldIgnoreWedgeKeydown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  if (target.closest('[data-pos-nfc-wedge="allow"]')) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']"
    )
  );
}
