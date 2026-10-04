import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";

// GET /api/analytics/brands - Brand comparison data for bar and pie charts
export async function GET(request: Request) {
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  const brand_id = searchParams.get("brand_id");
  const period = searchParams.get("period") || "3month";

  // Calculate date range based on period
  const now = new Date();
  const startDate = new Date();
  
  switch (period) {
    case "week":
      startDate.setDate(now.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(now.getMonth() - 1);
      break;
    case "3month":
      startDate.setMonth(now.getMonth() - 3);
      break;
    case "6month":
      startDate.setMonth(now.getMonth() - 6);
      break;
    default:
      startDate.setMonth(now.getMonth() - 3);
  }

  // Get all active brands first
  const { data: brands, error: brandsError } = await db
    .from("brands")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (brandsError) {
    return NextResponse.json({ error: brandsError.message }, { status: 400 });
  }

  // Build query for candidates
  let query = db
    .from("candidates")
    .select("brand_id, status")
    .gte("created_at", startDate.toISOString());

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data: candidates, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Aggregate by brand
  const brandStats: Record<string, { applicants: number; active: number; hired: number; in_pool: number }> = {};
  
  brands.forEach((brand) => {
    brandStats[brand.id] = { applicants: 0, active: 0, hired: 0, in_pool: 0 };
  });

  candidates.forEach((candidate) => {
    if (candidate.brand_id && brandStats[candidate.brand_id] !== undefined) {
      brandStats[candidate.brand_id].applicants += 1;
      
      if (candidate.status !== "hired" && candidate.status !== "rejected" && candidate.status !== "archived") {
        brandStats[candidate.brand_id].active += 1;
      }
      if (candidate.status === "hired") {
        brandStats[candidate.brand_id].hired += 1;
      }
      if (candidate.status === "talent_pool") {
        brandStats[candidate.brand_id].in_pool += 1;
      }
    }
  });

  // Transform to barData
  const barData = brands
    .filter((brand) => !brand_id || brand.id === brand_id)
    .map((brand) => ({
      brand: brand.name,
      applicants: brandStats[brand.id]?.applicants || 0,
      active: brandStats[brand.id]?.active || 0,
      hired: brandStats[brand.id]?.hired || 0,
      in_pool: brandStats[brand.id]?.in_pool || 0,
    }))
    .filter((item) => item.applicants > 0);

  // Transform to pieData (only hired counts)
  const pieData = barData.map((item) => ({
    name: item.brand,
    value: item.hired,
  }));

  return NextResponse.json({ barData, pieData });
}