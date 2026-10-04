import { createPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";
import { normalizeBusinessScopePayload } from "@/lib/configuration/business-scope";
import { ApiError } from "@/lib/api/auth";
import { EMAIL_IN_USE_MESSAGE, emailConflictOr } from "./email-conflict";
import type { CreateUserEmployeeInput, UpdateUserEmployeeInput } from "./schemas";
import {
  resolveDefaultWarehouseId,
  resolveSavedWarehouseIds,
} from "./stall-assignment";
import { mapEmployeeUserRow, type EmployeeUserRow } from "./user-mapper";
import {
  clearUserWarehouses,
  loadUserWarehouses,
  loadUserWarehousesBatch,
  syncUserWarehouses,
} from "./user-warehouses";
import { syncIamPrimaryRole } from "@/lib/iam/sync-user-role";
import { randomBytes } from "node:crypto";

const EMPLOYEE_SELECT = `
  *,
  department:departments (id, name, code),
  section:sections (id, name, code),
  job_title:positions (id, title, department),
  manager:employees!reporting_to (id, full_name, nip)
`;

async function listAuthUsers() {
  const db = createPgClient();
  const users = [];
  let page = 1;

  while (page < 20) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 100) break;
    page += 1;
  }

  return users;
}

async function enrichWithAppUser(row: EmployeeUserRow): Promise<EmployeeUserRow> {
  if (!row.user_id) return { ...row, app_user: null };

  const db = createPgClient();
  const { data: profile } = await db
    .from("users")
    .select(
      `id, role, status, brand_id, business_scope, holding_id, company_id, branch_id,
       can_switch_stall, can_central_checkout, default_warehouse_id,
       user_approval_permissions(*)`
    )
    .eq("id", row.user_id)
    .maybeSingle();

  if (!profile) return { ...row, app_user: null };

  const scopeNames: {
    holding?: { id: string; name: string } | null;
    company?: { id: string; name: string } | null;
    branch?: { id: string; name: string } | null;
  } = {};

  if (profile.holding_id) {
    scopeNames.holding = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM configuration.holdings WHERE id = $1`,
      [profile.holding_id]
    );
  }
  if (profile.company_id) {
    scopeNames.company = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM configuration.companies WHERE id = $1`,
      [profile.company_id]
    );
  }
  if (profile.branch_id) {
    scopeNames.branch = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM configuration.branches WHERE id = $1`,
      [profile.branch_id]
    );
  }

  const authUsers = await listAuthUsers();
  const auth = authUsers.find((u) => u.id === row.user_id);

  return {
    ...row,
    app_user: {
      ...profile,
      holding: scopeNames.holding ?? null,
      company: scopeNames.company ?? null,
      branch: scopeNames.branch ?? null,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
    },
  };
}

export async function listUserEmployees(params: {
  search?: string;
  departmentId?: string;
  employmentStatus?: string;
  isActive?: boolean;
  isAccessApp?: boolean;
  role?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const db = createPgClient();
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const sortBy = params.sortBy ?? "full_name";
  const sortOrder = params.sortOrder ?? "asc";

  let query = db.from("employees").select(EMPLOYEE_SELECT, { count: "exact" });

  if (params.search) {
    query = query.or(
      `full_name.ilike.%${params.search}%,email.ilike.%${params.search}%,nip.ilike.%${params.search}%`
    );
  }
  if (params.departmentId) query = query.eq("department_id", params.departmentId);
  if (params.employmentStatus) query = query.eq("employment_status", params.employmentStatus);
  if (params.isActive !== undefined) query = query.eq("is_active", params.isActive);
  if (params.isAccessApp !== undefined) query = query.eq("is_access_app", params.isAccessApp);

  query = query.order(sortBy, { ascending: sortOrder === "asc" });

  const from = (page - 1) * limit;
  const { data, error, count } = await query.range(from, from + limit - 1);

  if (error) throw error;

  let rows = (data ?? []) as EmployeeUserRow[];

  if (params.role) {
    const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const { data: profiles } = await db
        .from("users")
        .select("id, role")
        .in("id", userIds)
        .eq("role", params.role);
      const allowed = new Set(
        (profiles ?? []).map((p: { id: string }) => p.id)
      );
      rows = rows.filter((r) => r.user_id && allowed.has(r.user_id));
    } else {
      rows = [];
    }
  }

  const enriched = await Promise.all(rows.map((row) => enrichWithAppUser(row)));

  const userIds = enriched
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  const warehouseMap = await loadUserWarehousesBatch(userIds);

  const withWarehouses = enriched.map((row) => {
    if (!row.user_id || !row.app_user) return row;
    return {
      ...row,
      app_user: {
        ...row.app_user,
        user_warehouses: warehouseMap.get(row.user_id) ?? [],
      },
    };
  });

  return {
    data: withWarehouses.map(mapEmployeeUserRow),
    total: count ?? 0,
    page,
    perPage: limit,
  };
}

export async function getUserEmployeeById(id: string) {
  const db = createPgClient();
  const { data, error } = await db
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const enriched = await enrichWithAppUser(data as EmployeeUserRow);
  if (enriched.user_id && enriched.app_user) {
    enriched.app_user.user_warehouses = await loadUserWarehouses(enriched.user_id);
  }
  return mapEmployeeUserRow(enriched);
}

async function generateNip(db: DbClient) {
  const year = new Date().getFullYear();
  let seq = 1;

  while (seq < 100000) {
    const nip = `EMP-${year}-${String(seq).padStart(5, "0")}`;
    const { data: existing } = await db
      .from("employees")
      .select("id")
      .eq("nip", nip)
      .maybeSingle();
    if (!existing) return nip;
    seq += 1;
  }

  throw new Error("Unable to generate a unique employee ID");
}

function stallProfileFields(input: {
  warehouse_ids?: string[];
  default_warehouse_id?: string | null;
  can_switch_stall?: boolean;
  can_central_checkout?: boolean;
}) {
  const defaultId = resolveDefaultWarehouseId({
    defaultWarehouseId: input.default_warehouse_id,
    warehouseIds: input.warehouse_ids,
  });
  const canSwitchStall =
    input.can_central_checkout === true || input.can_switch_stall === true;
  return {
    default_warehouse_id: defaultId,
    can_central_checkout: input.can_central_checkout === true,
    can_switch_stall: canSwitchStall,
    warehouse_ids: resolveSavedWarehouseIds({
      defaultWarehouseId: defaultId,
      warehouseIds: input.warehouse_ids,
      canSwitchStall,
    }),
  };
}

function buildUserProfileFields(input: {
  role: string;
  brand_id?: string | null;
  business_scope?: CreateUserEmployeeInput["business_scope"];
  holding_id?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
}) {
  const scope =
    input.role === "super_admin"
      ? normalizeBusinessScopePayload(null)
      : normalizeBusinessScopePayload(
          input.business_scope ?? null,
          input.holding_id,
          input.company_id,
          input.branch_id
        );

  return {
    brand_id: null,
    ...scope,
  };
}

async function provisionAppAccount(
  db: DbClient,
  actorId: string,
  employeeId: string,
  input: {
    email: string;
    full_name: string;
    password: string;
    role: string;
    brand_id?: string | null;
    business_scope?: CreateUserEmployeeInput["business_scope"];
    holding_id?: string | null;
    company_id?: string | null;
    branch_id?: string | null;
    account_status?: "active" | "inactive";
    approval_permissions?: CreateUserEmployeeInput["approval_permissions"];
    warehouse_ids?: string[];
    default_warehouse_id?: string | null;
    can_switch_stall?: boolean;
    can_central_checkout?: boolean;
  }
) {
  let authUserId: string | null = null;

  try {
    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
      app_metadata: { role: input.role },
    });

    if (authError) throw emailConflictOr(authError);
    if (!authData.user) throw new Error("Failed to create auth user");
    authUserId = authData.user.id;

    const status = input.account_status ?? "active";
    const scopeFields = buildUserProfileFields(input);
    const stall = stallProfileFields(input);
    const { error: profileError } = await db.from("users").insert({
      id: authUserId,
      full_name: input.full_name,
      email: input.email,
      role: input.role,
      status,
      can_switch_stall: stall.can_switch_stall,
      can_central_checkout: stall.can_central_checkout,
      default_warehouse_id: stall.default_warehouse_id,
      ...scopeFields,
    });

    if (profileError) throw emailConflictOr(profileError);

    if (status === "inactive") {
      await db.auth.admin.updateUserById(
        authUserId,
        { ban_duration: "876000h" } as Parameters<typeof db.auth.admin.updateUserById>[1]
      );
    }

    const activePermissions =
      input.approval_permissions?.filter((permission) => permission.is_active) ?? [];

    if (activePermissions.length > 0) {
      const { error: permissionError } = await db.from("user_approval_permissions").insert(
        activePermissions.map((permission) => ({
          user_id: authUserId,
          module: permission.module,
          workflow: permission.workflow,
          approval_level: permission.approval_level,
          approval_limit: permission.approval_limit ?? null,
          is_active: true,
          created_by: actorId,
          updated_by: actorId,
        }))
      );
      if (permissionError) throw permissionError;
    }

    const { error: linkError } = await db
      .from("employees")
      .update({
        user_id: authUserId,
        is_access_app: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId);

    if (linkError) throw linkError;

    if (input.warehouse_ids !== undefined || input.default_warehouse_id !== undefined) {
      await syncUserWarehouses(
        db,
        authUserId,
        stall.warehouse_ids,
        input.branch_id ?? null
      );
    }

    await syncIamPrimaryRole(authUserId, input.role, actorId);

    await db.from("admin_user_audit_logs").insert({
      actor_id: actorId,
      target_user_id: authUserId,
      action: "create_user",
      details: { employee_id: employeeId, email: input.email, role: input.role },
    });

    return authUserId;
  } catch (error) {
    if (authUserId) {
      await db.auth.admin.deleteUser(authUserId);
    }
    throw error;
  }
}

async function syncAppAccount(
  db: DbClient,
  actorId: string,
  userId: string,
  input: UpdateUserEmployeeInput & { email?: string; full_name?: string }
) {
  const authUpdates: Record<string, unknown> = {};
  if (input.email) authUpdates.email = input.email;
  if (input.full_name) authUpdates.user_metadata = { full_name: input.full_name };
  if (input.role) authUpdates.app_metadata = { role: input.role };
  if (input.account_status) {
    authUpdates.ban_duration = input.account_status === "inactive" ? "876000h" : "none";
  }

  if (Object.keys(authUpdates).length > 0) {
    const { error: authError } = await db.auth.admin.updateUserById(
      userId,
      authUpdates as Parameters<typeof db.auth.admin.updateUserById>[1]
    );
    if (authError) throw emailConflictOr(authError);
  }

  if (input.password) {
    const { error: pwdError } = await db.auth.admin.updateUserById(userId, {
      password: input.password,
    });
    if (pwdError) throw new Error(pwdError.message);
  }

  const profileUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.email) profileUpdates.email = input.email;
  if (input.full_name) profileUpdates.full_name = input.full_name;
  if (input.role) profileUpdates.role = input.role;
  if (input.brand_id !== undefined) profileUpdates.brand_id = null;

  if (
    input.business_scope !== undefined ||
    input.holding_id !== undefined ||
    input.company_id !== undefined ||
    input.branch_id !== undefined ||
    input.role !== undefined
  ) {
    const { data: existingProfile } = await db
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    const scopeFields = buildUserProfileFields({
      role: input.role ?? existingProfile?.role ?? "admin",
      business_scope: input.business_scope,
      holding_id: input.holding_id,
      company_id: input.company_id,
      branch_id: input.branch_id,
    });
    Object.assign(profileUpdates, scopeFields);
  }

  if (input.account_status) profileUpdates.status = input.account_status;
  if (input.can_switch_stall !== undefined) {
    profileUpdates.can_switch_stall = input.can_switch_stall === true;
  }
  if (input.can_central_checkout !== undefined) {
    profileUpdates.can_central_checkout = input.can_central_checkout === true;
  }
  if (input.can_central_checkout === true) {
    profileUpdates.can_switch_stall = true;
  }

  const shouldSyncStalls =
    input.warehouse_ids !== undefined || input.default_warehouse_id !== undefined;
  const stall = shouldSyncStalls ? stallProfileFields(input) : null;
  if (stall) {
    profileUpdates.default_warehouse_id = stall.default_warehouse_id;
    if (input.can_switch_stall === undefined) {
      profileUpdates.can_switch_stall = stall.can_switch_stall;
    }
    if (input.can_central_checkout === undefined) {
      profileUpdates.can_central_checkout = stall.can_central_checkout;
    }
    if (stall.can_central_checkout) {
      profileUpdates.can_switch_stall = true;
    }
  }

  if (Object.keys(profileUpdates).length > 1) {
    const { error: profileError } = await db
      .from("users")
      .update(profileUpdates)
      .eq("id", userId);
    if (profileError) throw emailConflictOr(profileError);
  }

  if (input.approval_permissions) {
    await db
      .from("user_approval_permissions")
      .update({ is_active: false, updated_by: actorId, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    const activePermissions = input.approval_permissions.filter((p) => p.is_active);
    if (activePermissions.length > 0) {
      const { error: insertError } = await db.from("user_approval_permissions").insert(
        activePermissions.map((permission) => ({
          user_id: userId,
          module: permission.module,
          workflow: permission.workflow,
          approval_level: permission.approval_level,
          approval_limit: permission.approval_limit ?? null,
          is_active: true,
          created_by: actorId,
          updated_by: actorId,
        }))
      );
      if (insertError) throw insertError;
    }
  }

  if (stall) {
    const { data: profile } = await db
      .from("users")
      .select("branch_id")
      .eq("id", userId)
      .maybeSingle();

    const branchId =
      input.branch_id !== undefined ? input.branch_id : profile?.branch_id ?? null;

    await syncUserWarehouses(db, userId, stall.warehouse_ids, branchId);
  }

  if (input.role) {
    await syncIamPrimaryRole(userId, input.role, actorId);
  }

  await db.from("admin_user_audit_logs").insert({
    actor_id: actorId,
    target_user_id: userId,
    action: "update_user",
    details: { fields: Object.keys(input) },
  });
}

async function revokeAppAccount(
  db: DbClient,
  actorId: string,
  employeeId: string,
  userId: string
) {
  await db.auth.admin.updateUserById(
    userId,
    { ban_duration: "876000h" } as Parameters<typeof db.auth.admin.updateUserById>[1]
  );

  await db
    .from("users")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", userId);

  await db
    .from("employees")
    .update({
      is_access_app: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employeeId);

  await clearUserWarehouses(db, userId);

  await db.from("admin_user_audit_logs").insert({
    actor_id: actorId,
    target_user_id: userId,
    action: "revoke_app_access",
    details: { employee_id: employeeId },
  });
}

export async function createUserEmployee(
  actorId: string,
  input: CreateUserEmployeeInput
) {
  const db = createPgClient();

  const { data: existingEmail } = await db
    .from("employees")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();
  if (existingEmail) throw ApiError.conflict(EMAIL_IN_USE_MESSAGE);

  const nip = input.nip?.trim() ? input.nip.trim() : await generateNip(db);

  const { data: employee, error } = await db
    .from("employees")
    .insert({
      nip,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone || "",
      join_date: input.join_date,
      employment_status: input.employment_status,
      is_access_app: input.is_access_app,
      department_id: input.department_id ?? null,
      section_id: input.section_id ?? null,
      job_title_id: input.job_title_id ?? null,
      reporting_to: input.reporting_to ?? null,
      ktp: input.ktp ?? null,
      npwp: input.npwp ?? null,
      birth_date: input.birth_date ?? null,
      gender: input.gender ?? null,
      marital_status: input.marital_status ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postal_code: input.postal_code ?? null,
      bank_name: input.bank_name ?? null,
      bank_account: input.bank_account ?? null,
      bpjs_tk: input.bpjs_tk ?? null,
      bpjs_kesehatan: input.bpjs_kesehatan ?? null,
      emergency_contact_name: input.emergency_contact_name ?? null,
      emergency_contact_phone: input.emergency_contact_phone ?? null,
      emergency_contact_relationship: input.emergency_contact_relationship ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (error) throw emailConflictOr(error);

  if (input.is_access_app && input.password && input.role) {
    await provisionAppAccount(db, actorId, employee.id, {
      email: input.email,
      full_name: input.full_name,
      password: input.password,
      role: input.role,
      business_scope: input.business_scope,
      holding_id: input.holding_id,
      company_id: input.company_id,
      branch_id: input.branch_id,
      account_status: input.account_status,
      approval_permissions: input.approval_permissions,
      warehouse_ids: input.warehouse_ids,
      default_warehouse_id: input.default_warehouse_id,
      can_switch_stall: input.can_switch_stall,
      can_central_checkout: input.can_central_checkout,
    });
  }

  const created = await getUserEmployeeById(employee.id);
  if (!created) throw new Error("Failed to load employee data");
  return created;
}

export async function updateUserEmployee(
  actorId: string,
  id: string,
  input: UpdateUserEmployeeInput
) {
  const db = createPgClient();

  const { data: existing, error: fetchError } = await db
    .from("employees")
    .select("id, user_id, is_access_app, email, full_name")
    .eq("id", id)
    .single();

  if (fetchError || !existing) throw new Error("Employee not found");

  if (input.email && input.email !== existing.email) {
    const { data: dup } = await db
      .from("employees")
      .select("id")
      .eq("email", input.email)
      .neq("id", id)
      .maybeSingle();
    if (dup) throw ApiError.conflict(EMAIL_IN_USE_MESSAGE);
  }

  const employeePatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const fields = [
    "full_name",
    "email",
    "phone",
    "join_date",
    "end_date",
    "employment_status",
    "is_active",
    "department_id",
    "section_id",
    "job_title_id",
    "reporting_to",
    "ktp",
    "npwp",
    "birth_date",
    "gender",
    "marital_status",
    "address",
    "city",
    "province",
    "postal_code",
    "bank_name",
    "bank_account",
    "bpjs_tk",
    "bpjs_kesehatan",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relationship",
    "notes",
    "nip",
  ] as const;

  for (const field of fields) {
    if (input[field] !== undefined) {
      employeePatch[field] = field === "phone" ? input[field] || "" : input[field];
    }
  }

  if (input.is_access_app !== undefined) {
    employeePatch.is_access_app = input.is_access_app;
  }

  const { error: updateError } = await db
    .from("employees")
    .update(employeePatch)
    .eq("id", id);

  if (updateError) throw emailConflictOr(updateError);

  const wantsAccess = input.is_access_app ?? existing.is_access_app;
  const email = input.email ?? existing.email;
  const fullName = input.full_name ?? existing.full_name;

  if (wantsAccess && !existing.user_id) {
    if (!input.password || !input.role) {
      throw new Error("Password and role are required to enable app access");
    }
    await provisionAppAccount(db, actorId, id, {
      email,
      full_name: fullName,
      password: input.password,
      role: input.role,
      business_scope: input.business_scope,
      holding_id: input.holding_id,
      company_id: input.company_id,
      branch_id: input.branch_id,
      account_status: input.account_status,
      approval_permissions: input.approval_permissions,
      warehouse_ids: input.warehouse_ids,
      default_warehouse_id: input.default_warehouse_id,
      can_switch_stall: input.can_switch_stall,
      can_central_checkout: input.can_central_checkout,
    });
  } else if (existing.user_id && wantsAccess) {
    await syncAppAccount(db, actorId, existing.user_id, {
      ...input,
      email,
      full_name: fullName,
    });
  } else if (existing.user_id && input.is_access_app === false) {
    await revokeAppAccount(db, actorId, id, existing.user_id);
  }

  const updated = await getUserEmployeeById(id);
  if (!updated) throw new Error("Failed to load employee data");
  return updated;
}

export async function resetUserEmployeePassword(userId: string) {
  const db = createPgClient();
  // Password sementara harus dari PRNG kriptografis (audit 2026-09-17):
  // Math.random() tidak boleh dipakai untuk secret. ~72 bit entropi (12 char
  // base64url) + prefiks/suffiks agar lolos aturan kompleksitas.
  const tempPassword = `Arkiv${randomBytes(9).toString("base64url").slice(0, 12)}!`;

  const { error } = await db.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });

  if (error) throw new Error(error.message);

  return { message: "Password reset successfully", tempPassword };
}
