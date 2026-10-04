import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /member/sw.js — service worker portal member (sumber:
 * public/member-assets/sw.js). Disajikan lewat route ini, bukan langsung dari
 * public/, karena butuh header Service-Worker-Allowed: berkas di
 * /member-assets/ hanya boleh mengendalikan /member-assets/, sedangkan portal
 * butuh scope /member. Path /member/... juga lolos proxy host member.
 */
export async function GET() {
  try {
    const source = await readFile(path.join(process.cwd(), "public", "member-assets", "sw.js"), "utf8");
    return new Response(source, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Service-Worker-Allowed": "/member",
      },
    });
  } catch (error) {
    console.error("[member-portal] service worker tidak terbaca:", error);
    return new Response("// service worker tidak tersedia", { status: 404 });
  }
}
