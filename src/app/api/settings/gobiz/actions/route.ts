import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { SETTING_KEYS, setSetting } from "@/lib/settings/app-settings";
import { generateWebhookToken, gobizWebhookUrl } from "@/lib/gobiz/config";
import { GobizApiError } from "@/lib/gobiz/client";
import {
  GobizNotConfiguredError,
  registerGobizWebhooks,
  syncCatalogToGobiz,
  testGobizConnection,
} from "@/lib/gobiz/service";

/**
 * POST /api/settings/gobiz/actions {action}
 *   test              — ambil token OAuth2 (validasi kredensial)
 *   register_webhooks — daftarkan URL webhook utk semua event gofood.*
 *   sync_catalog      — push katalog POS ke GoFood (full replace)
 *   regenerate_token  — token webhook baru (perlu daftar ulang webhook)
 */

const schema = z.object({
  action: z.enum(["test", "register_webhooks", "sync_catalog", "regenerate_token"]),
});

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Aksi tidak valid" }, { status: 400 });

    switch (parsed.data.action) {
      case "test":
        return NextResponse.json({ success: true, data: await testGobizConnection() });
      case "register_webhooks":
        return NextResponse.json({ success: true, data: await registerGobizWebhooks(appOrigin(request)) });
      case "sync_catalog":
        return NextResponse.json({ success: true, data: await syncCatalogToGobiz(appOrigin(request)) });
      case "regenerate_token": {
        const token = generateWebhookToken();
        await setSetting(SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN, token);
        return NextResponse.json({ success: true, data: { webhook_url: gobizWebhookUrl(appOrigin(request), token) } });
      }
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof GobizNotConfiguredError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof GobizApiError) {
      return NextResponse.json(
        { success: false, error: `GoBiz: ${error.message}`, status: error.status, detail: error.body },
        { status: 502 }
      );
    }
    console.error("[settings/gobiz/actions] failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
