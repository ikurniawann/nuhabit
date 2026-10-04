import { z } from "zod";
import { ApiError } from "@/lib/api/auth";

/** Kolom yang boleh dipakai untuk urutan daftar karyawan di /api/users. */
const USER_LIST_SORT_COLUMNS = [
  "full_name",
  "nip",
  "email",
  "join_date",
  "employment_status",
  "created_at",
] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();
const booleanFlag = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const userListQuerySchema = z.object({
  // koma & kurung memecah ekspresi filter or() di query builder
  search: optionalText(100).transform((v) => v?.replace(/[,()]/g, " ").trim() || undefined),
  department_id: optionalText(64),
  employment_status: optionalText(32),
  is_active: booleanFlag,
  is_access_app: booleanFlag,
  role: optionalText(32),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sort_by: z.enum(USER_LIST_SORT_COLUMNS).default("full_name"),
  sort_order: z.enum(["asc", "desc"]).default("asc"),
});

export interface UserListQuery {
  search?: string;
  departmentId?: string;
  employmentStatus?: string;
  isActive?: boolean;
  isAccessApp?: boolean;
  role?: string;
  page: number;
  limit: number;
  sortBy: (typeof USER_LIST_SORT_COLUMNS)[number];
  sortOrder: "asc" | "desc";
}

/** Query string GET /api/users → parameter listUserEmployees; tidak valid → 400. */
export function parseUserListQuery(searchParams: URLSearchParams): UserListQuery {
  const raw = Object.fromEntries([...searchParams.entries()].filter(([, value]) => value !== ""));
  const parsed = userListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.badRequest("Parameter tidak valid", parsed.error.issues);
  }
  const q = parsed.data;
  return {
    search: q.search,
    departmentId: q.department_id || undefined,
    employmentStatus: q.employment_status || undefined,
    isActive: q.is_active,
    isAccessApp: q.is_access_app,
    role: q.role || undefined,
    page: q.page,
    limit: q.limit,
    sortBy: q.sort_by,
    sortOrder: q.sort_order,
  };
}
