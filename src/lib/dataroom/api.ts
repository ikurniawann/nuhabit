import { NextRequest, NextResponse } from "next/server";
import type { ApiUser } from "@/lib/api/auth";
import { resolveRoleIds } from "@/lib/iam/get-user-menus";
import { hasGrantedAction, loadGrantedMenuActions } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";
import { isPreviewable, mustForceAttachment } from "@/lib/dataroom/config";
import type { DataroomNode } from "@/lib/dataroom/nodes";
import { getNode, isSameOrDescendant } from "@/lib/dataroom/nodes";
import { openDataroomStream, readDataroomFile } from "@/lib/dataroom/storage";
import { applyWatermark } from "@/lib/dataroom/watermark";
import {
  findShareByToken, getSession, isShareActive, pendingSteps, sessionCookieName,
  type DataroomShare, type ShareSession,
} from "@/lib/dataroom/shares";

export interface DataroomPermissions { create: boolean; update: boolean; delete: boolean }

export async function getDataroomPermissions(user: ApiUser): Promise<DataroomPermissions> {
  const roleIds = await resolveRoleIds(user.id, user.role);
  const granted = await loadGrantedMenuActions(roleIds);
  return {
    create: hasGrantedAction(granted, IAM.dataroom, "create"),
    update: hasGrantedAction(granted, IAM.dataroom, "update"),
    delete: hasGrantedAction(granted, IAM.dataroom, "delete"),
  };
}

/** Content-Disposition dengan nama file UTF-8 (RFC 5987) + fallback ASCII. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Sajikan file node: stream bila tanpa watermark; bila watermark aktif dan tipe
 * mendukung, baca penuh → tanam teks → kirim. Inline hanya untuk gambar/PDF.
 */
export async function serveNodeFile(
  node: DataroomNode,
  opts: { inline: boolean; watermarkText?: string | null }
): Promise<NextResponse> {
  if (node.kind !== "file" || !node.storage_path) {
    return NextResponse.json({ success: false, error: "File tidak ditemukan" }, { status: 404 });
  }
  const mime = node.mime || "application/octet-stream";
  const inline = opts.inline && isPreviewable(mime) && !mustForceAttachment(mime);
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(node.name, inline),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (opts.watermarkText) {
    const raw = await readDataroomFile(node.storage_path);
    if (!raw) return NextResponse.json({ success: false, error: "File tidak ditemukan" }, { status: 404 });
    let out: Buffer = raw;
    try {
      out = (await applyWatermark(raw, mime, opts.watermarkText)) ?? raw;
    } catch (err) {
      console.warn("[dataroom] watermark gagal, kirim asli:", err instanceof Error ? err.message : err);
    }
    headers["Content-Length"] = String(out.length);
    return new NextResponse(new Uint8Array(out), { headers });
  }

  const opened = await openDataroomStream(node.storage_path);
  if (!opened) return NextResponse.json({ success: false, error: "File tidak ditemukan" }, { status: 404 });
  headers["Content-Length"] = String(opened.size);
  return new NextResponse(opened.stream, { headers });
}

// ── Konteks link berbagi (publik) ──────────────────────────────────────────

export type ShareContext =
  | { ok: false; status: number; error: string }
  | {
      ok: true; share: DataroomShare; root: DataroomNode; session: ShareSession | null;
      steps: { needEmail: boolean; needPin: boolean }; verified: boolean;
    };

export async function resolveShareContext(request: NextRequest, token: string): Promise<ShareContext> {
  const share = await findShareByToken(token);
  if (!share) return { ok: false, status: 404, error: "Link tidak ditemukan" };
  if (!isShareActive(share)) {
    return { ok: false, status: 410, error: share.revoked_at ? "Link sudah dicabut oleh pemilik" : "Link sudah kedaluwarsa" };
  }
  const root = await getNode(share.node_id);
  if (!root) return { ok: false, status: 404, error: "Berkas sudah dihapus" };
  const session = await getSession(share.id, request.cookies.get(sessionCookieName(share.token))?.value);
  const steps = pendingSteps(share, session);
  return { ok: true, share, root, session, steps, verified: !steps.needEmail && !steps.needPin };
}

/** Node yang diminta harus root share itu sendiri atau turunannya. */
export async function nodeWithinShare(nodeId: string, share: DataroomShare): Promise<DataroomNode | null> {
  const node = await getNode(nodeId);
  if (!node) return null;
  return (await isSameOrDescendant(node.id, share.node_id)) ? node : null;
}

export function publicNode(node: DataroomNode) {
  return {
    id: node.id, parent_id: node.parent_id, kind: node.kind, name: node.name,
    mime: node.mime, size_bytes: node.size_bytes, updated_at: node.updated_at,
  };
}
