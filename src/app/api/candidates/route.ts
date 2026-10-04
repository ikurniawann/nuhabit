import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { candidateSchema, candidateFilterSchema } from "@/lib/validations/candidate";
import { createApiErrorResponse, RateLimitError } from "@/lib/errors/api-errors";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/candidates - List candidates with pagination
export async function GET(request: Request) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  try {
    const db = await createServerPgClient();
    
    // Rate limiting
    const clientIp = request.headers.get("x-forwarded-for") || "anonymous";
    const rateLimit = checkRateLimit(`candidates_get_${clientIp}`);
    
    if (!rateLimit.allowed) {
      throw new RateLimitError();
    }
    
    const { searchParams } = new URL(request.url);

    // Validate and parse query params
    const validationResult = candidateFilterSchema.safeParse({
      status: searchParams.get("status") || undefined,
      brand_id: searchParams.get("brand_id") || undefined,
      search: searchParams.get("search") || undefined,
      page: searchParams.get("page") || "1",
      limit: searchParams.get("limit") || "20",
    });

    if (!validationResult.success) {
      const errors = validationResult.error.issues;
      return NextResponse.json(
        { 
          error: { 
            message: errors[0]?.message || "Parameter tidak valid", 
            code: "VALIDATION_ERROR",
            details: errors 
          } 
        },
        { status: 400 }
      );
    }

    const { status, brand_id, search, page, limit } = validationResult.data;
    const offset = (page - 1) * limit;

    let query = db
      .from("candidates")
      .select("*, brands(name), positions(title)", { count: "exact" })
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (brand_id) query = query.eq("brand_id", brand_id);
    if (search) {
      // Sanitize search input
      const sanitizedSearch = search.replace(/[%_]/g, "\\$&");
      query = query.or(
        `full_name.ilike.%${sanitizedSearch}%,email.ilike.%${sanitizedSearch}%,phone.ilike.%${sanitizedSearch}%`
      );
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      const { error: errorResponse, status: errorStatus } = createApiErrorResponse(error);
      return NextResponse.json({ error: errorResponse }, { status: errorStatus });
    }

    const totalPages = count ? Math.ceil(count / limit) : 0;

    const response = NextResponse.json({
      data,
      meta: {
        total: count || 0,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });

    // Add rate limit headers
    const headers = getRateLimitHeaders(`candidates_get_${clientIp}`);
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
    
  } catch (error) {
    const { error: errorResponse, status: errorStatus } = createApiErrorResponse(error);
    return NextResponse.json({ error: errorResponse }, { status: errorStatus });
  }
}

// POST /api/candidates - Create candidate with validation
export async function POST(request: Request) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  try {
    const db = await createServerPgClient();
    
    // Rate limiting
    const clientIp = request.headers.get("x-forwarded-for") || "anonymous";
    const rateLimit = checkRateLimit(`candidates_post_${clientIp}`);
    
    if (!rateLimit.allowed) {
      throw new RateLimitError();
    }

    const body = await request.json();
    const { data: userData } = await db.auth.getUser();

    // Validate input
    const validationResult = candidateSchema.safeParse(body);
    
    if (!validationResult.success) {
      const errors = validationResult.error.issues;
      return NextResponse.json(
        { 
          error: { 
            message: errors[0]?.message || "Data tidak valid", 
            code: "VALIDATION_ERROR",
            details: errors 
          } 
        },
        { status: 400 }
      );
    }

    const validatedData = validationResult.data;

    const { data, error } = await db.from("candidates").insert({
      full_name: validatedData.full_name,
      email: validatedData.email,
      phone: validatedData.phone,
      domicile: validatedData.domicile,
      source: validatedData.source,
      position_id: validatedData.position_id || null,
      brand_id: validatedData.brand_id || null,
      notes: validatedData.notes || null,
      cv_url: validatedData.cv_url || null,
      photo_url: validatedData.photo_url || null,
      status: "applied",
      created_by: userData.user?.id || null,
    }).select().single();

    if (error) {
      const { error: errorResponse, status: errorStatus } = createApiErrorResponse(error);
      return NextResponse.json({ error: errorResponse }, { status: errorStatus });
    }

    const response = NextResponse.json({ 
      data, 
      message: "Kandidat berhasil ditambahkan" 
    }, { status: 201 });

    // Add rate limit headers
    const headers = getRateLimitHeaders(`candidates_post_${clientIp}`);
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
    
  } catch (error) {
    const { error: errorResponse, status: errorStatus } = createApiErrorResponse(error);
    return NextResponse.json({ error: errorResponse }, { status: errorStatus });
  }
}
