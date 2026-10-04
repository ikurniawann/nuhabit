import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

type PrintJobPatchBody = {
  action?: 'mark_printing' | 'mark_printed' | 'mark_failed' | 'retry' | 'cancel';
  status?: string;
  error?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function resolveStatus(body: PrintJobPatchBody) {
  if (body.action === 'mark_printing') return 'printing';
  if (body.action === 'mark_printed') return 'printed';
  if (body.action === 'mark_failed') return 'failed';
  if (body.action === 'retry') return 'pending';
  if (body.action === 'cancel') return 'cancelled';

  const status = String(body.status || '').trim().toLowerCase();
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
  return Boolean(workerToken && requestToken && workerToken === requestToken);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorized = await authorizePrintQueueRequest(request);
  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PrintJobPatchBody;
    const status = resolveStatus(body);

    if (!status) {
      return NextResponse.json({ success: false, error: 'Invalid print job status' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const updatePayload: Record<string, string | number | null> = {
      status,
      updated_at: now,
    };

    if (status === 'printing') {
      updatePayload.attempts = 1;
      updatePayload.last_error = null;
    }
    if (status === 'printed') {
      updatePayload.printed_at = now;
      updatePayload.last_error = null;
    }
    if (status === 'failed') {
      updatePayload.last_error = body.error || 'Print failed';
    }
    if (body.action === 'retry') {
      updatePayload.printed_at = null;
      updatePayload.last_error = null;
      updatePayload.requested_at = now;
    }

    const db = createPgClient();
    const { data: currentJob } = await db
      .from('pos_print_jobs')
      .select('attempts')
      .eq('id', id)
      .maybeSingle();

    if (status === 'printing') {
      updatePayload.attempts = Number(currentJob?.attempts || 0) + 1;
    }

    const { data, error } = await db
      .from('pos_print_jobs')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error updating print job:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
