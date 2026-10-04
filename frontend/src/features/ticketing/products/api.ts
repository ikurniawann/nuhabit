import type {
  ChannelManagerItem,
  CreateDateValues,
  CreateTicketValues,
  LoketOption,
  TicketCategory,
  TicketProductDetail,
  TicketProductListItem,
  UpdateTicketValues,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const fetchCategories = (q: string) =>
  getJson<TicketCategory[]>(
    `/api/ticketing/categories${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    "Gagal memuat kategori"
  );

export const fetchProducts = (q: string) =>
  getJson<TicketProductListItem[]>(
    `/api/ticketing/products${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    "Gagal memuat daftar ticket"
  );

export const fetchProductDetail = (id: string) =>
  getJson<TicketProductDetail>(
    `/api/ticketing/products/${id}`,
    "Gagal memuat detail ticket"
  );

export const createProduct = (values: CreateTicketValues) =>
  sendJson<{ id: string; code: string }>(
    "/api/ticketing/products",
    "POST",
    values,
    "Gagal membuat ticket"
  );

export const updateProduct = (id: string, values: UpdateTicketValues) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}`,
    "PATCH",
    values,
    "Gagal menyimpan ticket"
  );

export const createProductDate = (id: string, values: CreateDateValues) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}/dates`,
    "POST",
    values,
    "Gagal menambah rentang tanggal"
  );

export const bulkUpdateProductDates = (
  id: string,
  values: { date_kind: string; add: string[]; remove: string[] }
) =>
  sendJson<{ added: number; removed: number }>(
    `/api/ticketing/products/${id}/dates/bulk`,
    "POST",
    values,
    "Gagal menyimpan kalender"
  );

export const deleteProductDate = (id: string, dateId: string) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}/dates/${dateId}`,
    "DELETE",
    undefined,
    "Gagal menghapus rentang tanggal"
  );

export const uploadThumbnail = async (id: string, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/ticketing/products/${id}/thumbnail`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) await parseError(res, "Gagal mengunggah thumbnail");
  const body = (await res.json()) as { data: { thumbnail_url: string } };
  return body.data;
};

export const fetchChannelManager = () =>
  getJson<ChannelManagerItem[]>(
    "/api/ticketing/channel-manager",
    "Gagal memuat channel manager"
  );

export const toggleProductChannel = (
  id: string,
  values: { channel_id: string; is_distributed: boolean }
) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}/channels`,
    "PATCH",
    values,
    "Gagal mengubah distribusi"
  );

export const saveChannelPrices = (
  id: string,
  values: {
    channel_id: string;
    prices: {
      variant_id: string;
      price_regular: number | null;
      price_high: number | null;
    }[];
  }
) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}/channel-prices`,
    "PUT",
    values,
    "Gagal menyimpan harga kanal"
  );

export const fetchLoketOptions = () =>
  getJson<LoketOption[]>(
    "/api/ticketing/products/loket-options",
    "Gagal memuat opsi ticket"
  );

export const saveBundleItems = (
  id: string,
  values: { items: { component_variant_id: string; qty: number }[] }
) =>
  sendJson<{ id: string }>(
    `/api/ticketing/products/${id}/bundle-items`,
    "PUT",
    values,
    "Gagal menyimpan komposisi paket"
  );
