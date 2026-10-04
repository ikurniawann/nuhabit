import { ApiError } from "@/lib/api/auth";

// API legacy: workflow retur pindah ke /api/purchasing/returns/:id.
const gone = async () =>
  new ApiError(
    410,
    "API legacy /api/purchasing/return/:id sudah tidak dipakai. Gunakan /api/purchasing/returns/:id."
  ).toResponse();

export const GET = gone;
export const PUT = gone;
export const DELETE = gone;
