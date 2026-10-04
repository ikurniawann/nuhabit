import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { uploadProductThumbnail } from "@/lib/ticketing/products-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const formData = await request.formData().catch(() => {
      throw ApiError.badRequest("Format unggahan tidak valid");
    });
    const url = await uploadProductThumbnail(ctx, id, formData.get("file"));
    return successResponse({ thumbnail_url: url }, "Thumbnail tersimpan");
  },
  "ticketing.products.thumbnail.POST"
);
