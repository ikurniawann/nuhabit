import { NextRequest } from "next/server";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { arriveDeliverySchema } from "@/lib/purchasing/delivery-schemas";
import { markDeliveryArrived } from "@/lib/purchasing/delivery-service";

// POST /api/purchasing/delivery/:id/arrive — body opsional `{ notes }`
export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const { notes } = arriveDeliverySchema.parse(await request.json().catch(() => ({})));
    const result = await markDeliveryArrived(await createServerPgClient(), id, user.id, notes);
    return successResponse(result, `Barang arrived — GRN ${result.grn.nomor_grn} berhasil dibuat`);
  },
  "purchasing.delivery.arrive"
);
