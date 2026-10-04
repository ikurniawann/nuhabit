type DbError = { message: string; code?: string } | null | undefined;

function throwIfDbError(error: DbError) {
  if (error) throw new Error(error.message);
}

export function isMissingRelationError(error: DbError): boolean {
  return error?.code === "42P01" || /does not exist/i.test(error?.message ?? "");
}

/** Throw DB errors except when the manufacturing BOM table has not been migrated yet. */
export function throwUnlessMissingBomTable(error: DbError) {
  if (!error) return;
  if (isMissingRelationError(error)) return;
  throwIfDbError(error);
}
