/**
 * POS IndexedDB — Offline-capable storage for products, customers, and pending orders
 * Uses native IndexedDB with promises (no external deps)
 */

import type { CreateOrderRequest, Product, ProductModifier, ProductVariant, SplitBillRequest } from "@/lib/pos-api";

const DB_NAME = 'arkiv-pos-db';
const DB_VERSION = 1;

const STORES = {
  products: 'products',
  customers: 'customers',
  offlineQueue: 'offline_queue',
  lastSync: 'last_sync',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORES.products)) {
        db.createObjectStore(STORES.products, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.customers)) {
        db.createObjectStore(STORES.customers, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.offlineQueue)) {
        const qs = db.createObjectStore(STORES.offlineQueue, { keyPath: 'queueId', autoIncrement: true });
        qs.createIndex('status', 'status', { unique: false });
        qs.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.lastSync)) {
        db.createObjectStore(STORES.lastSync, { keyPath: 'key' });
      }
    };
  });
  return dbPromise;
}

async function getStore(storeName: string, mode: IDBTransactionMode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ─── PRODUCTS ───
export interface OffProduct {
  id: string;
  name: string;
  sku: string;
  base_price: number;
  is_active: boolean;
  is_available: boolean;
  image_url?: string;
  category?: { name: string };
  variants?: ProductVariant[];
  modifiers?: ProductModifier[];
  xp?: number;
  station?: string;
  product_kind?: Product["product_kind"];
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  stall_warehouse_id?: string | null;
  stall_code?: string | null;
  stall_name?: string | null;
}

export type OffCatalogActiveMode = "unset" | "all" | "stall";

export interface OffCatalogMeta {
  active_mode?: OffCatalogActiveMode | null;
}

const CATALOG_META_KEY = "products_meta";

export async function cacheProducts(products: OffProduct[]) {
  const store = await getStore(STORES.products, 'readwrite');
  products.forEach((p) => store.put(p));
  return new Promise<void>((resolve, reject) => {
    const tx = store.transaction;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedProducts(): Promise<OffProduct[]> {
  const store = await getStore(STORES.products);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as OffProduct[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedProduct(id: string): Promise<OffProduct | undefined> {
  const store = await getStore(STORES.products);
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as OffProduct | undefined);
    request.onerror = () => reject(request.error);
  });
}

function parseCachedActiveMode(value: unknown): OffCatalogActiveMode | null {
  if (value === "unset" || value === "all" || value === "stall") return value;
  return null;
}

export async function cacheCatalogMeta(meta: OffCatalogMeta) {
  const store = await getStore(STORES.lastSync, "readwrite");
  return new Promise<void>((resolve, reject) => {
    const request = store.put({
      key: CATALOG_META_KEY,
      timestamp: new Date().toISOString(),
      active_mode: meta.active_mode ?? null,
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedCatalogMeta(): Promise<OffCatalogMeta | null> {
  const store = await getStore(STORES.lastSync);
  return new Promise((resolve, reject) => {
    const request = store.get(CATALOG_META_KEY);
    request.onsuccess = () => {
      const res = request.result as { active_mode?: unknown } | undefined;
      if (!res) {
        resolve(null);
        return;
      }
      resolve({ active_mode: parseCachedActiveMode(res.active_mode) });
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── CUSTOMERS ───
export interface OffCustomer {
  id: string;
  name?: string;
  phone: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
  total_spent: number;
  visit_count: number;
  discount?: number;
}

export async function cacheCustomers(customers: OffCustomer[]) {
  const store = await getStore(STORES.customers, 'readwrite');
  customers.forEach((c) => store.put(c));
  return new Promise<void>((resolve, reject) => {
    const tx = store.transaction;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedCustomers(search?: string): Promise<OffCustomer[]> {
  const store = await getStore(STORES.customers);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      let all = request.result as OffCustomer[];
      if (search) {
        const s = search.toLowerCase();
        all = all.filter(
          (c) =>
            (c.name && c.name.toLowerCase().includes(s)) ||
            c.phone.toLowerCase().includes(s) ||
            c.id.toLowerCase() === s
        );
      }
      resolve(all);
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── OFFLINE ORDER QUEUE ───
export interface OfflineOrderRequest {
  queueId?: number;
  status: 'pending' | 'syncing' | 'failed' | 'completed';
  createdAt: string;
  errorMessage?: string;
  orderPayload: OfflineOrderPayload;
  retryCount: number;
}

/** Payload order yang ditunda saat offline; `_offlineType` memilih endpoint saat sinkron. */
export type OfflineOrderPayload =
  | (CreateOrderRequest & { _offlineType?: "order" })
  | (SplitBillRequest & { _offlineType: "split" });

export async function queueOfflineOrder(orderPayload: OfflineOrderPayload): Promise<number> {
  const store = await getStore(STORES.offlineQueue, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.add({
      status: 'pending',
      createdAt: new Date().toISOString(),
      orderPayload,
      retryCount: 0,
    });
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
}

export async function getOfflineQueue(): Promise<OfflineOrderRequest[]> {
  const store = await getStore(STORES.offlineQueue);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as OfflineOrderRequest[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingQueue(): Promise<OfflineOrderRequest[]> {
  const store = await getStore(STORES.offlineQueue);
  return new Promise((resolve, reject) => {
    const index = store.index('status');
    const request = index.getAll('pending');
    request.onsuccess = () => resolve(request.result as OfflineOrderRequest[]);
    request.onerror = () => reject(request.error);
  });
}

export async function updateQueueItem(item: OfflineOrderRequest) {
  const store = await getStore(STORES.offlineQueue, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function removeFromQueue(queueId: number) {
  const store = await getStore(STORES.offlineQueue, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const request = store.delete(queueId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearQueue() {
  const store = await getStore(STORES.offlineQueue, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ─── LAST SYNC TIMESTAMP ───
export async function setLastSyncTimestamp(key: string, ts?: string) {
  const store = await getStore(STORES.lastSync, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const request = store.put({ key, timestamp: ts || new Date().toISOString() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getLastSyncTimestamp(key: string): Promise<string | undefined> {
  const store = await getStore(STORES.lastSync);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => {
      const res = request.result;
      resolve(res?.timestamp);
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── BULK CACHING HELPERS ───
export async function warmCache(products: OffProduct[], customers: OffCustomer[]) {
  await Promise.all([cacheProducts(products), cacheCustomers(customers), setLastSyncTimestamp('warm_cache')]);
}

export async function hasWarmCache(): Promise<boolean> {
  const [p, c, ts] = await Promise.all([
    getCachedProducts(),
    getCachedCustomers(),
    getLastSyncTimestamp('warm_cache'),
  ]);
  return p.length > 0 && c.length > 0 && !!ts;
}
