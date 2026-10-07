import { query, queryOne } from "@/lib/db";
import { sanitizeNodeName } from "@/lib/dataroom/config";

/** Node Dataroom: folder atau file (pohon via parent_id, root = NULL). */
export interface DataroomNode {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  mime: string | null;
  size_bytes: number;
  storage_path: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = `id, parent_id, kind, name, mime, size_bytes::text AS size_bytes, storage_path,
  created_by, created_by_name, created_at, updated_at`;

function normalize(row: Record<string, unknown>): DataroomNode {
  return { ...(row as unknown as DataroomNode), size_bytes: Number(row.size_bytes) || 0 };
}

export async function getNode(id: string): Promise<DataroomNode | null> {
  const row = await queryOne(`SELECT ${COLS} FROM dataroom.nodes WHERE id = $1`, [id]);
  return row ? normalize(row) : null;
}

export async function listChildren(parentId: string | null): Promise<DataroomNode[]> {
  const rows = parentId
    ? await query(`SELECT ${COLS} FROM dataroom.nodes WHERE parent_id = $1
                   ORDER BY (kind = 'folder') DESC, lower(name), created_at`, [parentId])
    : await query(`SELECT ${COLS} FROM dataroom.nodes WHERE parent_id IS NULL
                   ORDER BY (kind = 'folder') DESC, lower(name), created_at`);
  return rows.map(normalize);
}

/** Jejak dari root → node (termasuk node itu sendiri). */
export async function getAncestors(id: string): Promise<{ id: string; name: string; parent_id: string | null }[]> {
  const rows = await query<{ id: string; name: string; parent_id: string | null; depth: number }>(
    `WITH RECURSIVE up AS (
       SELECT id, name, parent_id, 0 AS depth FROM dataroom.nodes WHERE id = $1
       UNION ALL
       SELECT n.id, n.name, n.parent_id, up.depth + 1 FROM dataroom.nodes n JOIN up ON n.id = up.parent_id
     )
     SELECT id, name, parent_id, depth FROM up ORDER BY depth DESC`,
    [id]
  );
  return rows.map(({ id, name, parent_id }) => ({ id, name, parent_id }));
}

/** true bila `nodeId` == `ancestorId` atau berada di bawahnya. */
export async function isSameOrDescendant(nodeId: string, ancestorId: string): Promise<boolean> {
  if (nodeId === ancestorId) return true;
  const row = await queryOne<{ ok: boolean }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM dataroom.nodes WHERE id = $1
       UNION ALL
       SELECT n.id, n.parent_id FROM dataroom.nodes n JOIN up ON n.id = up.parent_id
     )
     SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS ok`,
    [nodeId, ancestorId]
  );
  return Boolean(row?.ok);
}

export async function usedBytes(): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM dataroom.nodes WHERE kind = 'file'`
  );
  return Number(row?.total) || 0;
}

export async function listAllFolders(): Promise<{ id: string; parent_id: string | null; name: string }[]> {
  return query(`SELECT id, parent_id, name FROM dataroom.nodes WHERE kind = 'folder' ORDER BY lower(name)`);
}

export async function createFolder(input: {
  parentId: string | null; name: string; userId: string | null; userName: string | null;
}): Promise<DataroomNode> {
  const row = await queryOne(
    `INSERT INTO dataroom.nodes (parent_id, kind, name, created_by, created_by_name)
     VALUES ($1, 'folder', $2, $3, $4) RETURNING ${COLS}`,
    [input.parentId, sanitizeNodeName(input.name), input.userId, input.userName]
  );
  return normalize(row as Record<string, unknown>);
}

export async function createFileNode(input: {
  parentId: string | null; name: string; mime: string; sizeBytes: number; storagePath: string;
  userId: string | null; userName: string | null;
}): Promise<DataroomNode> {
  const row = await queryOne(
    `INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path, created_by, created_by_name)
     VALUES ($1, 'file', $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
    [input.parentId, sanitizeNodeName(input.name), input.mime, input.sizeBytes, input.storagePath, input.userId, input.userName]
  );
  return normalize(row as Record<string, unknown>);
}

export async function renameNode(id: string, name: string): Promise<DataroomNode | null> {
  const row = await queryOne(
    `UPDATE dataroom.nodes SET name = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
    [id, sanitizeNodeName(name)]
  );
  return row ? normalize(row) : null;
}

export async function moveNode(id: string, newParentId: string | null): Promise<DataroomNode | null> {
  const row = await queryOne(
    `UPDATE dataroom.nodes SET parent_id = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
    [id, newParentId]
  );
  return row ? normalize(row) : null;
}

/** Semua file di bawah node (termasuk node bila file) — untuk hapus & hitung. */
export async function collectSubtreeFiles(id: string): Promise<{ id: string; storage_path: string | null; size_bytes: number }[]> {
  const rows = await query<{ id: string; storage_path: string | null; size_bytes: string }>(
    `WITH RECURSIVE down AS (
       SELECT id, kind, storage_path, size_bytes FROM dataroom.nodes WHERE id = $1
       UNION ALL
       SELECT n.id, n.kind, n.storage_path, n.size_bytes FROM dataroom.nodes n JOIN down ON n.parent_id = down.id
     )
     SELECT id, storage_path, size_bytes::text AS size_bytes FROM down WHERE kind = 'file'`,
    [id]
  );
  return rows.map((r) => ({ ...r, size_bytes: Number(r.size_bytes) || 0 }));
}

/** Hapus node (cascade ke anak); kembalikan path file yang harus di-unlink. */
export async function deleteNodeCascade(id: string): Promise<string[]> {
  const files = await collectSubtreeFiles(id);
  await query(`DELETE FROM dataroom.nodes WHERE id = $1`, [id]);
  return files.map((f) => f.storage_path).filter((p): p is string => Boolean(p));
}
