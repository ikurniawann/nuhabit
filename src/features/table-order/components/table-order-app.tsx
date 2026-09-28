"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Coins,
  Loader2,
  MapPin,
  QrCode,
  Receipt,
  Search,
  Sparkles,
  UserRound,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { idrToArkDisplay } from "@/lib/pos/loyalty-settings";
import {
  buildCategories,
  filterProducts,
  formatRupiah,
  groupBySection,
  UNCATEGORIZED_ID,
  type SelectedModifier,
  type TableOrderProduct,
  type TableOrderVariant,
} from "@/lib/table-order/menu";
import { isOrderActive, type TableOrderPaymentMethod, type TableOrderType } from "@/lib/table-order/order-status";
import {
  addToCart,
  adjustCartQuantity,
  productQuantity,
  summarizeCart,
  type CartLine,
} from "@/lib/table-order/pricing";
import {
  ApiRequestError,
  createOrder,
  fetchCatalog,
  fetchMember,
  fetchOrder,
  fetchSession,
  type Catalog,
  type MemberProfile,
  type OrderData,
  type TableSession,
} from "../api";
import { readTableState, writeTableState } from "../storage";
import { BottomSheet } from "./sheet";
import { CartSheet } from "./cart-sheet";
import { MemberSheet } from "./member-sheet";
import { MenuItemRow } from "./menu-item-row";
import { OrderTracking } from "./order-tracking";
import { VariantSheet } from "./variant-sheet";

const HERO_IMAGE = "/bg-bcd.webp";

type View = "menu" | "tracking";

export function TableOrderApp({ tableCode }: { tableCode: string }) {
  const [session, setSession] = useState<TableSession | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [member, setMember] = useState<MemberProfile | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<TableOrderType>("dine_in");
  const [paymentMethod, setPaymentMethod] = useState<TableOrderPaymentMethod>("cashier");
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [variantProduct, setVariantProduct] = useState<TableOrderProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [menuJumpOpen, setMenuJumpOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<OrderData | null>(null);
  const [view, setView] = useState<View>("menu");
  const [toast, setToast] = useState<string | null>(null);

  const restored = useRef(false);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  // Saklar fitur loyalty dari server; absen (server lama) = aktif.
  const arkEnabled = session?.ark_enabled !== false;
  const xpEnabled = session?.xp_enabled !== false;
  // XP mati → nol-kan xp & minXp di satu tempat: chip +XP, kunci "Member ≥ X XP",
  // XP per baris keranjang, dan total XP ikut hilang tanpa menyentuh tiap komponen.
  const products = useMemo(() => {
    const list = catalog?.products ?? [];
    return xpEnabled ? list : list.map((p) => ({ ...p, xp: 0, minXp: 0 }));
  }, [catalog, xpEnabled]);
  const categories = useMemo(() => buildCategories(products), [products]);
  const filtered = useMemo(() => filterProducts(products, { query }), [products, query]);
  const sections = useMemo(() => groupBySection(filtered, categories), [filtered, categories]);
  const charges = useMemo(() => session?.billing.charges ?? [], [session]);
  const summary = useMemo(() => summarizeCart(cart, charges), [cart, charges]);
  const tableLabel = session?.table_label || tableCode;
  const brandName = session?.brand_name || "BCD Coffee";

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const reloadMember = useCallback(async () => {
    const profile = await fetchMember().catch(() => null);
    setMember(profile);
    if (!profile && paymentMethod === "ark_coin") setPaymentMethod("cashier");
  }, [paymentMethod]);

  // ARK Coin dimatikan setelah pelanggan memilihnya → jatuh ke "Bayar di kasir".
  // Nilai turunan (bukan setState di effect) supaya tak ada render berantai.
  const effectivePaymentMethod: TableOrderPaymentMethod =
    !arkEnabled && paymentMethod === "ark_coin" ? "cashier" : paymentMethod;

  const loadCatalog = useCallback(async () => {
    const next = await fetchCatalog();
    setCatalog(next);
    return next;
  }, []);

  // ---- muat sesi meja + katalog + state tersimpan --------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [sessionData, catalogData] = await Promise.all([fetchSession(tableCode), fetchCatalog()]);
        if (cancelled) return;
        setSession(sessionData);
        setCatalog(catalogData);
        if (sessionData.member_logged_in) {
          const profile = await fetchMember().catch(() => null);
          if (!cancelled) setMember(profile);
        }

        if (!restored.current) {
          restored.current = true;
          const stored = readTableState(tableCode);
          if (stored.orderType) setOrderType(stored.orderType);
          if (stored.cart?.length) {
            // Buang baris yang produknya sudah tidak dijual.
            const sellable = new Set(catalogData.products.map((product) => product.id));
            setCart(stored.cart.filter((line) => sellable.has(line.productId)));
          }
          if (stored.activeOrderId) {
            const order = await fetchOrder(stored.activeOrderId).catch(() => null);
            if (!cancelled && order) {
              setActiveOrder(order);
              if (isOrderActive(order.status) || order.payment_status === "unpaid") setView("tracking");
            }
          }
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Gagal memuat menu");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tableCode]);

  useEffect(() => {
    if (!restored.current) return;
    writeTableState(tableCode, { cart, orderType, activeOrderId: activeOrder?.id ?? null });
  }, [cart, orderType, activeOrder, tableCode]);

  // ---- scroll-spy kategori -------------------------------------------------
  useEffect(() => {
    if (view !== "menu" || sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory(visible.target.getAttribute("data-category"));
      },
      { rootMargin: "-140px 0px -60% 0px", threshold: 0 }
    );
    sectionRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections, view]);

  function scrollToCategory(id: string) {
    setActiveCategory(id);
    setMenuJumpOpen(false);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- keranjang -----------------------------------------------------------
  function isLocked(product: TableOrderProduct) {
    return product.minXp > 0 && (!member || member.total_xp < product.minXp);
  }

  function handleAdd(product: TableOrderProduct) {
    if (isLocked(product)) {
      setMemberOpen(true);
      return;
    }
    if (product.customizable) {
      setVariantProduct(product);
      return;
    }
    setCart((current) => addToCart(current, product));
    showToast(`${product.name} ditambahkan`);
  }

  function handleAddVariant(
    product: TableOrderProduct,
    variant: TableOrderVariant | null,
    quantity: number,
    modifiers: SelectedModifier[]
  ) {
    setCart((current) => addToCart(current, product, variant, quantity, modifiers));
    setVariantProduct(null);
    showToast(`${product.name} ditambahkan`);
  }

  function handleIncrement(product: TableOrderProduct) {
    if (product.customizable) {
      setVariantProduct(product);
      return;
    }
    setCart((current) => addToCart(current, product));
  }

  function handleDecrement(product: TableOrderProduct) {
    setCart((current) => {
      // Kurangi baris terakhir produk ini (varian apa pun).
      const line = [...current].reverse().find((item) => item.productId === product.id);
      return line ? adjustCartQuantity(current, line.cartId, -1) : current;
    });
  }

  // ---- kirim pesanan -------------------------------------------------------
  async function submitOrder() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setOrderError(null);
    try {
      const order = await createOrder({
        table_code: tableCode,
        order_type: orderType,
        payment_method: effectivePaymentMethod,
        items: cart.map((line) => ({
          product_id: line.productId,
          variant_id: line.variantId,
          // Keranjang lama di localStorage belum punya field ini.
          modifier_ids: line.modifierIds ?? [],
          quantity: line.quantity,
        })),
        customer_note: note.trim() || undefined,
        guest_name: guestName.trim() || undefined,
      });
      setActiveOrder(order);
      setCart([]);
      setNote("");
      setCartOpen(false);
      setView("tracking");
      window.scrollTo({ top: 0 });
      if (effectivePaymentMethod === "ark_coin") void reloadMember();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setMemberOpen(true);
      }
      if (error instanceof ApiRequestError && error.status === 409) {
        void loadCatalog();
      }
      setOrderError(error instanceof Error ? error.message : "Gagal mengirim pesanan");
    } finally {
      setSubmitting(false);
    }
  }

  function startNewOrder() {
    setView("menu");
    setOrderError(null);
    window.scrollTo({ top: 0 });
  }

  // ---- render --------------------------------------------------------------
  if (view === "tracking" && activeOrder) {
    return (
      <main className="min-h-dvh bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-md">
          <OrderTracking
            xpEnabled={xpEnabled}
            order={activeOrder}
            tableLabel={tableLabel}
            brandName={brandName}
            onOrderUpdate={setActiveOrder}
            onNewOrder={startNewOrder}
          />
        </div>
      </main>
    );
  }

  const emptyCatalog = !loading && !loadError && products.length === 0;

  return (
    <main className="min-h-dvh bg-gray-50 pb-28 text-gray-900">
      <div className="mx-auto max-w-md">
        {/* Hero */}
        <div className="relative h-52 overflow-hidden">
          <img src={HERO_IMAGE} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-gray-50" />
          <div className="absolute inset-x-4 top-4 flex items-center justify-between">
            <div className="flex size-11 items-center justify-center rounded-full bg-white/95 shadow">
              <img src="/logos/bcd-coffee-icon.png?v=bcd" alt={brandName} className="size-7 object-contain" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen((open) => !open);
                  setQuery("");
                }}
                className="flex size-11 items-center justify-center rounded-full bg-white/95 text-gray-800 shadow"
                aria-label="Cari menu"
              >
                {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
              </button>
              {activeOrder && (
                <button
                  type="button"
                  onClick={() => setView("tracking")}
                  className="flex size-11 items-center justify-center rounded-full bg-white/95 text-primary shadow"
                  aria-label="Pesanan saya"
                >
                  <Receipt className="size-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Kartu venue (menumpang hero) */}
        <div className="relative -mt-16 px-4">
          <div className="rounded-2xl bg-white p-4 shadow-lg shadow-black/5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold leading-snug text-gray-900">
                  {brandName} — Meja {tableLabel}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                    BUKA
                  </span>
                  {xpEnabled && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                        <Sparkles className="size-3.5 fill-amber-500 text-amber-500" /> Dapat XP
                      </span>
                    </>
                  )}
                  <span className="text-gray-300">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5 text-primary" />
                    {session?.table_area || "Antar ke meja"}
                  </span>
                </div>
                <div className="mt-1 text-xs font-semibold text-gray-700">
                  {session?.qris_available ? "Bayar QRIS / di kasir" : "Bayar di kasir"} · Est. 10–20 mnt
                </div>
              </div>
              <ChevronRight className="mt-1 size-5 shrink-0 text-gray-400" />
            </div>

            <div className="mt-3 grid grid-cols-2 rounded-full bg-gray-100 p-1 text-sm font-semibold">
              {(
                [
                  ["dine_in", "Makan di tempat"],
                  ["takeaway", "Bawa pulang"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrderType(value)}
                  className={`h-9 rounded-full transition ${
                    orderType === value ? "bg-primary text-white shadow" : "text-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 border-t border-dashed border-gray-200 pt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMemberOpen(true)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${
                    member ? "border-primary bg-primary/5 text-primary" : "border-primary text-primary"
                  }`}
                >
                  <UserRound className="size-4" />
                  {member ? member.name : "Masuk Member"}
                  {!member && xpEnabled && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-black text-white">
                      XP
                    </span>
                  )}
                </button>
                {member && arkEnabled && (
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-semibold text-gray-700">
                    <Coins className="size-4 text-amber-500" />
                    {idrToArkDisplay(member.ark_coin_balance, member.ark_rate)}
                  </span>
                )}
                {activeOrder && (
                  <button
                    type="button"
                    onClick={() => setView("tracking")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-semibold text-gray-700"
                  >
                    <Receipt className="size-4" />
                    Pesanan Saya
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Kartu info horizontal */}
        <div className="mt-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {xpEnabled && <InfoCard icon={Sparkles} title="Kumpulkan XP" subtitle="Tiap pesanan member" />}
          {session?.qris_available && <InfoCard icon={QrCode} title="Bayar QRIS" subtitle="Langsung dari meja" />}
          {arkEnabled && <InfoCard icon={Coins} title="ARK Coin" subtitle="Saldo member, langsung lunas" />}
          <InfoCard icon={UtensilsCrossed} title="Ke dapur otomatis" subtitle="Pesanan masuk KDS" />
        </div>

        {/* Sticky: pencarian + kategori */}
        <div className="sticky top-0 z-20 mt-4 bg-gray-50/95 backdrop-blur">
          {(searchOpen || query) && (
            <div className="px-4 pt-3">
              <div className="flex h-11 items-center gap-2 rounded-full bg-white px-4 shadow-sm ring-1 ring-gray-200">
                <Search className="size-4 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari menu…"
                  className="h-full flex-1 bg-transparent text-sm outline-none"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Bersihkan">
                    <X className="size-4 text-gray-400" />
                  </button>
                )}
              </div>
            </div>
          )}
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
              {categories.map((category) => {
                const active = activeCategory === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => scrollToCategory(category.id)}
                    className={`h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
                      active ? "bg-primary text-white shadow" : "bg-white text-gray-700 ring-1 ring-gray-200"
                    }`}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Daftar menu */}
        <div className="mt-1 bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-gray-500">
              <Loader2 className="size-5 animate-spin" /> Memuat menu…
            </div>
          ) : loadError ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-semibold text-red-700">{loadError}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 h-10 rounded-full bg-primary px-5 text-sm font-bold text-white"
              >
                Muat ulang
              </button>
            </div>
          ) : emptyCatalog ? (
            <EmptyCatalog meta={catalog?.meta} />
          ) : sections.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-500">
              Tidak ada menu yang cocok dengan “{query}”.
            </div>
          ) : (
            sections.map((section) => (
              <section
                key={section.category.id}
                data-category={section.category.id}
                ref={(element) => {
                  if (element) sectionRefs.current.set(section.category.id, element);
                  else sectionRefs.current.delete(section.category.id);
                }}
                className="scroll-mt-32"
              >
                <h2 className="px-4 pb-1 pt-5 text-lg font-bold text-gray-900">
                  {section.category.id === UNCATEGORIZED_ID ? "Lainnya" : section.category.name}
                </h2>
                {section.products.map((product) => (
                  <MenuItemRow
                    key={product.id}
                    product={product}
                    quantity={productQuantity(cart, product.id)}
                    locked={isLocked(product)}
                    onAdd={() => handleAdd(product)}
                    onIncrement={() => handleIncrement(product)}
                    onDecrement={() => handleDecrement(product)}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      </div>

      {/* Tombol "Menu" mengambang */}
      {categories.length > 1 && !cartOpen && (
        <button
          type="button"
          onClick={() => setMenuJumpOpen(true)}
          className={`fixed left-1/2 z-30 inline-flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-xl shadow-black/20 ${
            cart.length > 0 ? "bottom-24" : "bottom-6"
          }`}
        >
          <UtensilsCrossed className="size-4" /> Menu
        </button>
      )}

      {/* Bar keranjang */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mx-auto flex h-13 w-full max-w-md items-center justify-between rounded-2xl bg-primary px-4 py-3 text-left text-white shadow-lg shadow-black/10"
          >
            <span>
              <span className="block text-xs text-white/75">{summary.totalItems} item · Meja {tableLabel}</span>
              <span className="block text-base font-bold">{formatRupiah(summary.total)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-bold">
              Lihat keranjang <ChevronRight className="size-4" />
            </span>
          </button>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-40 flex justify-center px-4">
          <div className="rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">{toast}</div>
        </div>
      )}

      <VariantSheet product={variantProduct} onClose={() => setVariantProduct(null)} onAdd={handleAddVariant} />

      <CartSheet
        arkEnabled={arkEnabled}
        xpEnabled={xpEnabled}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        summary={summary}
        session={session}
        member={member}
        orderType={orderType}
        onOrderType={setOrderType}
        paymentMethod={effectivePaymentMethod}
        onPaymentMethod={setPaymentMethod}
        note={note}
        onNote={setNote}
        guestName={guestName}
        onGuestName={setGuestName}
        onQuantity={(cartId, delta) => setCart((current) => adjustCartQuantity(current, cartId, delta))}
        onOpenMember={() => setMemberOpen(true)}
        submitting={submitting}
        error={orderError}
        onSubmit={() => void submitOrder()}
      />

      <MemberSheet
        open={memberOpen}
        member={member}
        onClose={() => setMemberOpen(false)}
        onChanged={reloadMember}
        arkEnabled={arkEnabled}
        xpEnabled={xpEnabled}
      />

      <BottomSheet open={menuJumpOpen} onClose={() => setMenuJumpOpen(false)} title="Kategori menu">
        <ul className="divide-y divide-gray-100">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                onClick={() => scrollToCategory(category.id)}
                className="flex w-full items-center justify-between py-3 text-left"
              >
                <span className="text-sm font-semibold text-gray-900">{category.name}</span>
                <span className="text-xs text-gray-500">{category.count} menu</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </main>
  );
}

function InfoCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex w-56 shrink-0 items-center gap-3 rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-gray-100">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-gray-900">{title}</div>
        <div className="truncate text-xs text-gray-500">{subtitle}</div>
      </div>
    </div>
  );
}

function EmptyCatalog({ meta }: { meta?: Catalog["meta"] }) {
  const noProducts = !meta || meta.total_products === 0;
  return (
    <div className="px-6 py-14 text-center">
      <UtensilsCrossed className="mx-auto size-10 text-gray-300" />
      <p className="mt-3 text-sm font-bold text-gray-800">Menu belum tersedia</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        {noProducts
          ? "Belum ada produk di katalog POS. Admin: tambahkan produk di Dashboard → POS → Products (atau sinkron dari Items) lalu tandai tersedia."
          : `Semua ${meta.total_products} produk sedang ditandai tidak tersedia. Admin: aktifkan “Available” di Dashboard → POS → Products.`}
      </p>
    </div>
  );
}
