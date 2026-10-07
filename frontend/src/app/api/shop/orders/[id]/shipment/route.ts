// EPIC-039 Fase E — buat pengiriman (provider / resi manual) utk order paid/packing.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from '@/lib/api/auth';
import { apiHandler } from '@/lib/api/handler';
import { IAM } from '@/lib/iam/prefixes';
import { assertOrderId } from '@/lib/shop/orders';
import { createOrderShipment, shipmentBodySchema } from '@/lib/shop/order-shipment';

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.shop);
    const { id } = await params;
    assertOrderId(id);

    const parsed = shipmentBodySchema.safeParse(await request.json());
    if (!parsed.success) throw ApiError.badRequest('Payload tidak valid');

    const data = await createOrderShipment(id, parsed.data, user.id);
    return NextResponse.json({ success: true, data }, { status: 201 });
  },
  'shop.orders.shipment.POST'
);
