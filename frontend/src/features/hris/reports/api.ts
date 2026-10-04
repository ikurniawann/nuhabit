import { apiGet } from "@/lib/api-client";
import type { HrisReport } from "@/lib/hris/hris-reports-csv";

export const fetchHRISReport = (month: number, year: number) =>
  apiGet<HrisReport>(`/api/hris/reports?month=${month}&year=${year}`);
