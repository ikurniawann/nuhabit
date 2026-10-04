import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  createEntry,
  createEntrySchema,
  createTemplate,
  createTemplateSchema,
  deleteEntry,
  deleteTemplate,
  logbookDeleteQuerySchema,
  logbookListQuerySchema,
  readLogbook,
  requireLogbookActor,
  reviewEntry,
  reviewEntrySchema,
  submitEntry,
  submitEntrySchema,
  updateEntryItem,
  updateItemSchema,
} from "@/lib/hris/logbook-repo";
import { readJson } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/**
 * API Logbook Department (EPIC-009). Semua method WAJIB terautentikasi;
 * scope department ditegakkan di server (lib/hris/logbook-repo).
 */

const unknownAction = () => new ApiError(422, "Unknown action");

/** Body ber-`action`; skema per aksi divalidasi setelah aksinya dikenali. */
const actionBodySchema = z.looseObject({ action: z.unknown() });

/** GET /api/hris/logbook?resource=me|departments|templates|summary|entries */
export const GET = apiHandler(async (request: Request) => {
  const actor = await requireLogbookActor();
  const query = parseInput(logbookListQuerySchema, searchParamsOf(request));
  return NextResponse.json(await readLogbook(actor, query));
}, "hris/logbook.GET");

/** POST /api/hris/logbook { action: create-template | create-entry } */
export const POST = apiHandler(async (request: Request) => {
  const actor = await requireLogbookActor();
  const body = await readJson(request, actionBodySchema);
  if (body.action === "create-template") {
    const data = await createTemplate(actor, parseInput(createTemplateSchema, body));
    return NextResponse.json({ data }, { status: 201 });
  }
  if (body.action === "create-entry") {
    const data = await createEntry(actor, parseInput(createEntrySchema, body));
    return NextResponse.json({ data }, { status: 201 });
  }
  throw unknownAction();
}, "hris/logbook.POST");

/** PATCH /api/hris/logbook { action: update-item | submit-entry | review-entry } */
export const PATCH = apiHandler(async (request: Request) => {
  const actor = await requireLogbookActor();
  const body = await readJson(request, actionBodySchema);
  if (body.action === "update-item") {
    return NextResponse.json({ data: await updateEntryItem(actor, parseInput(updateItemSchema, body)) });
  }
  if (body.action === "submit-entry") {
    return NextResponse.json({ data: await submitEntry(actor, parseInput(submitEntrySchema, body)) });
  }
  if (body.action === "review-entry") {
    return NextResponse.json({ data: await reviewEntry(actor, parseInput(reviewEntrySchema, body)) });
  }
  throw unknownAction();
}, "hris/logbook.PATCH");

/** DELETE /api/hris/logbook?resource=entry|template&id=... */
export const DELETE = apiHandler(async (request: Request) => {
  const actor = await requireLogbookActor();
  const { resource, id } = parseInput(logbookDeleteQuerySchema, searchParamsOf(request));
  if (resource === "entry") return NextResponse.json(await deleteEntry(actor, id));
  if (resource === "template") return NextResponse.json(await deleteTemplate(actor, id));
  throw new ApiError(422, "Unknown resource");
}, "hris/logbook.DELETE");
