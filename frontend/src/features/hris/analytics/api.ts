import { apiGet } from "@/lib/api-client";
import {
  buildAnalyticsView,
  type AnalyticsBrandsResponse,
  type AnalyticsOverviewResponse,
  type AnalyticsSourcesResponse,
  type AnalyticsView,
} from "@/lib/recruitment/analytics-view";

export async function fetchAnalyticsView(brandFilter: string, period: string): Promise<AnalyticsView> {
  const qs = new URLSearchParams({ period });
  if (brandFilter !== "all") qs.set("brand_id", brandFilter);
  const [overview, sources, brands] = await Promise.all([
    apiGet<AnalyticsOverviewResponse>(`/api/analytics/overview?${qs}`),
    apiGet<AnalyticsSourcesResponse>(`/api/analytics/sources?${qs}`),
    apiGet<AnalyticsBrandsResponse>(`/api/analytics/brands?${qs}`),
  ]);
  return buildAnalyticsView(overview, sources, brands, new Date());
}
