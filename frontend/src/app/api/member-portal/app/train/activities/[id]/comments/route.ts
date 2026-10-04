import { addComment } from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  commentSchema,
  parseBody,
  uuidParam,
  type IdCtx,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** POST — tambah komentar pada aktivitas yang boleh dilihat. */
export const POST = athleteRoute(
  "Gagal mengirim komentar",
  async (customerId, request: Request, ctx: IdCtx) => {
    const id = await uuidParam(ctx, "id");
    const { text } = await parseBody(
      request,
      commentSchema,
      "Komentar 1-500 karakter",
    );
    return memberJson(await addComment(customerId, id, text));
  },
);
