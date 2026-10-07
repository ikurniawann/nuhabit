import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
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

async function runAction(action: z.infer<typeof schema>["action"], origin: string) {
  switch (action) {
    case "test":
      return testGobizConnection();
    case "register_webhooks":
      return registerGobizWebhooks(origin);
    case "sync_catalog":
      return syncCatalogToGobiz(origin);
    case "regenerate_token": {
      const token = generateWebhookToken();
      await setSetting(SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN, token);
      return { webhook_url: gobizWebhookUrl(origin, token) };
    }
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw ApiError.badRequest("Aksi tidak valid");

  try {
    return NextResponse.json({ success: true, data: await runAction(parsed.data.action, appOrigin(request)) });
  } catch (error) {
    if (error instanceof GobizNotConfiguredError) throw ApiError.badRequest(error.message);
    if (error instanceof GobizApiError) {
      // Status + body GoBiz ikut dikirim supaya admin bisa diagnosa di UI.
      return NextResponse.json(
        { success: false, error: `GoBiz: ${error.message}`, status: error.status, detail: error.body },
        { status: 502 }
      );
    }
    throw error;
  }
}, "POST /api/settings/gobiz/actions");
