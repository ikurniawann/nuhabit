import type { ApiUser } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import type { DataroomNode } from "@/lib/dataroom/nodes";

/**
 * Akses folder Dataroom per departemen (owner 2026-09-05).
 * - Super admin: lihat & atur semuanya.
 * - User lain: departemen dari hris.employees (user_id). Folder tanpa
 *   konfigurasi terbuka; folder terkonfigurasi hanya untuk departemen yang
 *   terdaftar, dan aturan itu diwariskan ke seluruh isi folder.
 */

export interface DataroomActor {
  userId: string;
  isAdmin: boolean;
  departmentId: string | null;
  departmentName: string | null;
}

export interface DepartmentRef { id: string; name: string }

/**
 * Tabel konfigurasi departemen datang dari migration
 * `20260905110000_dataroom_folder_departments.sql`. Bila sebuah instance belum
 * dimigrasi, Dataroom TIDAK boleh mati total — modul kembali ke perilaku
 * sebelum fitur ini ada: semua folder terbuka untuk pengguna menu Dataroom.
 */
const MISSING_TABLE = "42P01";
const MIGRATION_HINT =
  "[dataroom] tabel dataroom.folder_departments belum ada — jalankan migration " +
  "20260905110000_dataroom_folder_departments.sql. Akses per departemen nonaktif sementara.";
let migrationWarned = false;

function isMissingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === MISSING_TABLE;
}

/** SELECT ke folder_departments yang aman bila tabelnya belum ada. */
async function selectConfigs<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    return await query<T>(sql, params);
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    if (!migrationWarned) {
      migrationWarned = true;
      console.warn(MIGRATION_HINT);
    }
    return [];
  }
}

export function isDataroomAdminRole(role: string | null | undefined): boolean {
  return role === "super_admin";
}

/**
 * Pure: node boleh diakses bila SETIAP konfigurasi di jalurnya (root → node)
 * memuat departemen user. Daftar kosong/null = tidak dibatasi.
 */
export function evaluateAccess(
  chain: readonly (readonly string[] | null | undefined)[],
  departmentId: string | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  for (const allowed of chain) {
    if (!allowed || allowed.length === 0) continue;
    if (!departmentId || !allowed.includes(departmentId)) return false;
  }
  return true;
}

export async function resolveActor(user: ApiUser): Promise<DataroomActor> {
  const isAdmin = isDataroomAdminRole(user.role);
  const row = await queryOne<{ department_id: string | null; department_name: string | null }>(
    `SELECT e.department_id, d.name AS department_name
     FROM hris.employees e LEFT JOIN hris.departments d ON d.id = e.department_id
     WHERE e.user_id = $1 ORDER BY e.created_at DESC NULLS LAST LIMIT 1`,
    [user.id]
  ).catch(() => null);
  return {
    userId: user.id,
    isAdmin,
    departmentId: row?.department_id ?? null,
    departmentName: row?.department_name ?? null,
  };
}

export async function listDepartments(): Promise<DepartmentRef[]> {
  return query<DepartmentRef>(
    `SELECT id, name FROM hris.departments WHERE COALESCE(is_active, true) ORDER BY name`
  );
}

/** Departemen terkonfigurasi per node (hanya node yang punya konfigurasi). */
export async function getDepartmentsForNodes(nodeIds: string[]): Promise<Map<string, DepartmentRef[]>> {
  const map = new Map<string, DepartmentRef[]>();
  if (nodeIds.length === 0) return map;
  const rows = await selectConfigs<{ node_id: string; id: string; name: string }>(
    `SELECT fd.node_id, d.id, d.name
     FROM dataroom.folder_departments fd JOIN hris.departments d ON d.id = fd.department_id
     WHERE fd.node_id = ANY($1::uuid[]) ORDER BY d.name`,
    [nodeIds]
  );
  for (const r of rows) {
    const list = map.get(r.node_id) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.node_id, list);
  }
  return map;
}

export async function setNodeDepartments(nodeId: string, departmentIds: string[], userId: string): Promise<void> {
  try {
    await query(`DELETE FROM dataroom.folder_departments WHERE node_id = $1`, [nodeId]);
    if (departmentIds.length > 0) {
      await query(
        `INSERT INTO dataroom.folder_departments (node_id, department_id, created_by)
         SELECT $1, d.id, $3 FROM hris.departments d WHERE d.id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [nodeId, departmentIds, userId]
      );
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    throw new Error(
      "Pengaturan akses departemen belum aktif di server ini. Jalankan migration " +
        "20260905110000_dataroom_folder_departments.sql lebih dahulu."
    );
  }
}

/**
 * Resolver akses: memuat semua folder (id, parent) + konfigurasinya sekali,
 * lalu cek O(kedalaman) per node tanpa query tambahan.
 */
export interface AccessResolver {
  actor: DataroomActor;
  /** Node boleh diakses (file dicek lewat folder induknya). */
  allows: (node: Pick<DataroomNode, "id" | "parent_id" | "kind">) => boolean;
  /** Folder id boleh diakses (null = root, selalu boleh). */
  allowsFolder: (folderId: string | null) => boolean;
  /** Departemen terkonfigurasi langsung pada node. */
  configured: (nodeId: string) => string[];
}

export async function createAccessResolver(actor: DataroomActor): Promise<AccessResolver> {
  const parentOf = new Map<string, string | null>();
  const configs = new Map<string, string[]>();
  if (!actor.isAdmin) {
    const folders = await query<{ id: string; parent_id: string | null }>(
      `SELECT id, parent_id FROM dataroom.nodes WHERE kind = 'folder'`
    );
    for (const f of folders) parentOf.set(f.id, f.parent_id);
  }
  const rows = await selectConfigs<{ node_id: string; department_id: string }>(
    `SELECT node_id, department_id FROM dataroom.folder_departments`,
    []
  );
  for (const r of rows) {
    const list = configs.get(r.node_id) ?? [];
    list.push(r.department_id);
    configs.set(r.node_id, list);
  }
  const chainFor = (folderId: string | null): string[][] => {
    const chain: string[][] = [];
    let cur = folderId;
    let guard = 0;
    while (cur && guard < 200) {
      const c = configs.get(cur);
      if (c) chain.push(c);
      cur = parentOf.get(cur) ?? null;
      guard += 1;
    }
    return chain;
  };
  const allowsFolder = (folderId: string | null) =>
    actor.isAdmin || folderId === null || evaluateAccess(chainFor(folderId), actor.departmentId, false);
  return {
    actor,
    allowsFolder,
    allows: (node) => allowsFolder(node.kind === "folder" ? node.id : node.parent_id),
    configured: (nodeId) => configs.get(nodeId) ?? [],
  };
}
