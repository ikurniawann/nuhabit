import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { bundleItemsSchema, saveBundleItems } from "@/lib/ticketing/product-sales-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const PUT = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const { items } = await validateBody(request, bundleItemsSchema);
    await saveBundleItems(ctx, id, items);
    return successResponse({ id }, "Komposisi paket tersimpan");
  },
  "ticketing.products.bundle-items.PUT"
);
