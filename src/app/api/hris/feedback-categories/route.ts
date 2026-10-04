import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackCategorySchema } from "@/lib/hris/feedback-schemas";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();

    const { data, error } = await db
      .from('feedback_categories')
      .select(`
        *,
        criteria:feedback_criteria(id, name, description, display_order)
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching feedback categories:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
    const db = createPgClient();
    const parsed = feedbackCategorySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid', details: parsed.error.issues }, { status: 400 });
    }

    const { data, error } = await db
      .from('feedback_categories')
      .insert(parsed.data)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error creating feedback category:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
