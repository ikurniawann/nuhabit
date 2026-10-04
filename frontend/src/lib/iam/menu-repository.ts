import { iamDbQuery, iamDbQueryOne } from "./pg-client";

export type IamMenuRow = {
  id: string;
  parent_id: string | null;
  code: string;
  menu_name: string;
  description: string | null;
  route_path: string | null;
  module: string | null;
  menu_type: string;
  icon: string | null;
  order_number: number;
  level: number;
  is_active: boolean;
  is_visible: boolean;
  open_in_new_tab: boolean;
  permission_context: { actions: string[] } | null;
  created_at: string;
  updated_at: string | null;
  version: number;
};

const MENU_COLUMNS = `
  id, parent_id, code, menu_name, description, route_path, module,
  menu_type, icon, order_number, level, is_active, is_visible,
  open_in_new_tab, permission_context, created_at, updated_at, version
`;

export async function listIamMenusFromDb(): Promise<IamMenuRow[]> {
  return iamDbQuery<IamMenuRow>(
    `SELECT ${MENU_COLUMNS}
     FROM iam.menus
     WHERE deleted_at IS NULL
     ORDER BY level ASC, order_number ASC, menu_name ASC`
  );
}

export async function getIamMenuFromDb(id: string): Promise<IamMenuRow | null> {
  return iamDbQueryOne<IamMenuRow>(
    `SELECT ${MENU_COLUMNS}
     FROM iam.menus
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
}

export async function createIamMenuInDb(
  payload: Record<string, unknown>,
  createdBy: string
): Promise<string> {
  const row = await iamDbQueryOne<{ id: string }>(
    `INSERT INTO iam.menus (
      parent_id, code, menu_name, description, route_path, module,
      menu_type, icon, order_number, is_visible, is_active,
      open_in_new_tab, permission_context, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
    RETURNING id`,
    [
      payload.parentId ?? null,
      payload.code,
      payload.menuName,
      payload.description ?? null,
      payload.routePath ?? null,
      payload.module ?? null,
      payload.menuType ?? "sidebar",
      payload.icon ?? null,
      payload.orderNumber ?? 0,
      payload.isVisible ?? true,
      payload.isActive ?? true,
      payload.openInNewTab ?? false,
      JSON.stringify(payload.permissionContext ?? { actions: ["read"] }),
      createdBy,
    ]
  );

  if (!row) throw new Error("Gagal membuat menu");
  return row.id;
}

export async function updateIamMenuInDb(
  id: string,
  payload: Record<string, unknown>,
  updatedBy: string
): Promise<boolean> {
  const row = await iamDbQueryOne<{ id: string }>(
    `UPDATE iam.menus SET
      parent_id = CASE WHEN $2::boolean THEN $3::uuid ELSE parent_id END,
      code = COALESCE($4, code),
      menu_name = COALESCE($5, menu_name),
      description = CASE WHEN $6::boolean THEN $7 ELSE description END,
      route_path = CASE WHEN $8::boolean THEN $9 ELSE route_path END,
      module = CASE WHEN $10::boolean THEN $11 ELSE module END,
      menu_type = COALESCE($12, menu_type),
      icon = CASE WHEN $13::boolean THEN $14 ELSE icon END,
      order_number = COALESCE($15, order_number),
      is_visible = COALESCE($16, is_visible),
      is_active = COALESCE($17, is_active),
      open_in_new_tab = COALESCE($18, open_in_new_tab),
      permission_context = COALESCE($19::jsonb, permission_context),
      updated_by = $20,
      updated_at = now()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id`,
    [
      id,
      payload.parentId !== undefined,
      payload.parentId ?? null,
      payload.code ?? null,
      payload.menuName ?? null,
      payload.description !== undefined,
      payload.description ?? null,
      payload.routePath !== undefined,
      payload.routePath ?? null,
      payload.module !== undefined,
      payload.module ?? null,
      payload.menuType ?? null,
      payload.icon !== undefined,
      payload.icon ?? null,
      payload.orderNumber ?? null,
      payload.isVisible ?? null,
      payload.isActive ?? null,
      payload.openInNewTab ?? null,
      payload.permissionContext ? JSON.stringify(payload.permissionContext) : null,
      updatedBy,
    ]
  );

  return Boolean(row);
}

export async function deleteIamMenuInDb(id: string, deletedBy: string): Promise<boolean> {
  const row = await iamDbQueryOne<{ id: string }>(
    `UPDATE iam.menus SET
      deleted_at = now(),
      deleted_by = $2,
      is_active = false,
      updated_at = now(),
      updated_by = $2
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id`,
    [id, deletedBy]
  );

  return Boolean(row);
}
