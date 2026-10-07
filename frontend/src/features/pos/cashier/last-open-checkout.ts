/**
 * Checkout open bill terakhir di tab ini: "Order" berikutnya menambah item ke
 * checkout itu. Disimpan di sessionStorage; bila diblokir, cadangan di memori.
 */

const LAST_OPEN_CHECKOUT_KEY = "pos:lastOpenCheckoutId";
let memoryFallback: string | null = null;

export function readLastOpenCheckoutId(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_OPEN_CHECKOUT_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export function writeLastOpenCheckoutId(id: string | null) {
  memoryFallback = id;
  try {
    if (id) window.sessionStorage.setItem(LAST_OPEN_CHECKOUT_KEY, id);
    else window.sessionStorage.removeItem(LAST_OPEN_CHECKOUT_KEY);
  } catch {
    // sessionStorage diblokir: cadangan memori sudah diisi.
  }
}
