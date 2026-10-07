export interface PublicBranch {
  slug: string;
  name: string;
}

/** Branches from GET /api/public/site/branches: a plain list or under `branches`. */
export async function fetchPublicBranches(): Promise<PublicBranch[]> {
  const res = await fetch("/api/public/site/branches", { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: PublicBranch[] | { branches?: PublicBranch[] };
  };
  if (!res.ok || !json.success || !json.data) return [];
  const list = Array.isArray(json.data) ? json.data : (json.data.branches ?? []);
  return list.filter((b) => typeof b.slug === "string" && typeof b.name === "string");
}
