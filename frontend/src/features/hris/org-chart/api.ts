import { apiGet } from "@/lib/api-client";
import type { OrgEmployee } from "@/lib/hris/org-chart";
import type { OrgDepartment } from "./types";

export const fetchOrgEmployees = () =>
  apiGet<{ data: OrgEmployee[] }>("/api/hris/employees?limit=200&is_active=true").then((res) => res.data || []);

export const fetchOrgDepartments = () =>
  apiGet<{ data: (OrgDepartment & { is_active: boolean })[] }>("/api/master/departments").then((res) =>
    (res.data ?? []).filter((d) => d.is_active)
  );
