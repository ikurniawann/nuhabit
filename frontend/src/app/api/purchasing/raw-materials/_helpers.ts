// Sisa helper lama yang masih dipakai route production/{product,raw-material}-recipes.
// Route raw-materials sendiri memakai apiHandler + src/lib/purchasing/raw-material-api.
type DbError = { message: string; code?: string } | null | undefined;

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export function throwIfDbError(error: DbError) {
  if (error) throw new Error(error.message);
}
