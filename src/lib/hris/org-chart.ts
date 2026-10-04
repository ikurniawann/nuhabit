/** Karyawan untuk bagan organisasi (subset kolom direktori /api/hris/employees). */
export interface OrgEmployee {
  id: string;
  full_name: string;
  photo_url?: string | null;
  employment_status?: string | null;
  department_id?: string | null;
  reporting_to?: string | null;
  job_title?: { title: string } | null;
}

export type OrgNode = OrgEmployee & { direct_reports: OrgNode[] };

/**
 * Pohon atasan-bawahan dalam satu kelompok karyawan. Akar = karyawan tanpa
 * atasan, atau yang atasannya di luar kelompok (mis. departemen lain).
 */
export function buildOrgTree(employees: OrgEmployee[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>(employees.map((e) => [e.id, { ...e, direct_reports: [] }]));
  const roots: OrgNode[] = [];
  for (const e of employees) {
    const node = nodes.get(e.id)!;
    const parent = e.reporting_to ? nodes.get(e.reporting_to) : undefined;
    if (parent) parent.direct_reports.push(node);
    else roots.push(node);
  }
  return roots;
}
