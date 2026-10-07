export type CardCustomer = {
  id: string;
  phone: string;
  name?: string | null;
  nfc_uid?: string | null;
};

export function findCustomerByCard<T extends CardCustomer>(
  customers: T[],
  card: string
): T | null {
  const trimmed = card.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  return (
    customers.find(
      (c) =>
        c.nfc_uid?.trim().toUpperCase() === upper ||
        c.id === trimmed ||
        c.phone === trimmed
    ) ?? null
  );
}
