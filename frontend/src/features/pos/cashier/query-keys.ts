export const cashierQueryKeys = {
  all: ["pos", "cashier"] as const,
  tables: () => ["pos", "cashier", "tables"] as const,
  order: (orderId: string) => ["pos", "cashier", "order", orderId] as const,
  checkout: (checkoutId: string) => ["pos", "cashier", "checkout", checkoutId] as const,
  favorites: (customerId: string) => ["pos", "cashier", "favorites", customerId] as const,
  // Di luar prefix `all`: invalidasi setelah bayar tidak boleh memuat ulang katalog.
  catalog: () => ["pos", "cashier-catalog"] as const,
  customers: () => ["pos", "cashier-customers"] as const,
  activeStall: () => ["pos", "cashier-active-stall"] as const,
};
