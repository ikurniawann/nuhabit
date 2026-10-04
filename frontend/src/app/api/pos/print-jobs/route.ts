import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

type PrintJobPayload = {
  order_id?: string;
  station?: string;
  job_type?: string;
  payload?: Record<string, unknown>;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function normalizeStation(value?: string) {
  const station = String(value || '').trim().toLowerCase();
  if (['kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth'].includes(station)) {
    return station;
  }
  return 'kitchen';
}

function normalizeStatus(value?: string | null) {
  const status = String(value || '').trim().toLowerCase();
  if (['pending', 'printing', 'printed', 'failed', 'cancelled'].includes(status)) {
    return status;
  }
  return null;
}

async function authorizePrintQueueRequest(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (sessionUserId) return true;

  const workerToken = process.env.POS_PRINT_WORKER_TOKEN?.trim();
  const requestToken = request.headers.get('x-pos-print-worker-token')?.trim();
  if (!workerToken || !requestToken) return false;
  // Bandingkan waktu-konstan supaya token worker tidak bisa ditebak per karakter.
  const expected = Buffer.from(workerToken);
  const given = Buffer.from(requestToken);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: NextRequest) {
  const authorized = await authorizePrintQueueRequest(request);
  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const status = normalizeStatus(searchParams.get('status'));
    const station = searchParams.get('station');
    const limit = Math.min(Number(searchParams.get('limit') || 100) || 100, 250);

    let query = db
      .from('pos_print_jobs')
      .select(`
        *,
        order:pos_orders (
          order_number,
          order_type,
          table_id,
          ordered_at,
          status,
          payment_status
        )
      `)
      .order('requested_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (station && station !== 'all') query = query.eq('station', normalizeStation(station));

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: unknown) {
    console.error('Error fetching print jobs:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authorized = await authorizePrintQueueRequest(request);
  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PrintJobPayload;
    if (!body.order_id) {
      return NextResponse.json({ success: false, error: 'order_id is required' }, { status: 400 });
    }

    const db = createPgClient();
    const station = normalizeStation(body.station);
    const jobType = body.job_type || (station === 'bar' ? 'bar_ticket' : 'kitchen_ticket');

    const { data, error } = await db
      .from('pos_print_jobs')
      .insert({
        order_id: body.order_id,
        station,
        job_type: jobType,
        status: 'pending',
        payload: body.payload || {},
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating print job:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
