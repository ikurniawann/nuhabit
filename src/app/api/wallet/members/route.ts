import { IAM } from "@/lib/iam/prefixes";
import { ok, walletRoute } from "@/lib/wallet/route";
import { searchMembers } from "@/lib/wallet/server";

/** GET ?q= — cari member (nama/telepon) beserta saldonya. */
export const GET = walletRoute(IAM.posWallet, "Gagal mencari member", async (_user, request: Request) =>
  ok(await searchMembers(new URL(request.url).searchParams.get("q") ?? ""))
);
