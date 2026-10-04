const POS_PREFIX = "/dashboard/pos";

export function buildTopupCardPath(card: string) {
  return `/dashboard/pos/topup?card=${encodeURIComponent(card.trim())}`;
}

export function isPosPath(pathname: string) {
  return pathname === POS_PREFIX || pathname.startsWith(`${POS_PREFIX}/`);
}

export function shouldRedirectNfcScan(input: {
  pathname: string;
  paymentNfcActive: boolean;
}) {
  if (input.paymentNfcActive) return false;
  return isPosPath(input.pathname);
}
