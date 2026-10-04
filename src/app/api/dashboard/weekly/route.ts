import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

// GET /api/dashboard/weekly - Get weekly candidate applications for chart
export async function GET(request: Request) {
  const guard = await requireIamGuard(READERS);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const brand_id = searchParams.get("brand_id");

  // Calculate the last 8 weeks (week ending Sunday)
  const weeks: { label: string; start: Date; end: Date }[] = [];
  const today = new Date();

  for (let i = 7; i >= 0; i--) {
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - (today.getDay()) - (i * 7));
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const label = `${monthNames[startDate.getMonth()]} ${startDate.getDate()}`;

    weeks.push({
      label,
      start: startDate,
      end: endDate,
    });
  }

  // Build query with optional brand_id filter
  let query = db
    .from("candidates")
    .select("created_at")
    .gte("created_at", weeks[0].start.toISOString())
    .lte("created_at", weeks[weeks.length - 1].end.toISOString());

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Count candidates per week
  const weeklyData = weeks.map((week, index) => {
    const count = data?.filter((candidate) => {
      const createdAt = new Date(candidate.created_at);
      return createdAt >= week.start && createdAt <= week.end;
    }).length ?? 0;

    return {
      week: `Week ${index + 1}`,
      date: week.start.toISOString().split("T")[0],
      label: week.label,
      count,
    };
  });

  return NextResponse.json(weeklyData);
}
