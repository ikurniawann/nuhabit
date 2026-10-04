import type { CustomFieldDef, CustomFieldObject } from "@/lib/crm/custom-fields";

export async function fetchCustomFieldDefs(object: CustomFieldObject): Promise<CustomFieldDef[]> {
  const res = await fetch(`/api/sales-funnel/custom-fields?object=${object}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { data: CustomFieldDef[] };
  return body.data;
}
