import { ApiError } from "@/lib/api/auth";

// API legacy: workflow retur pindah ke /api/purchasing/returns.
const gone = async () =>
  new ApiError(
    410,
    "API legacy /api/purchasing/return sudah tidak dipakai. Gunakan /api/purchasing/returns untuk purchase return workflow."
  ).toResponse();

export const GET = gone;
export const POST = gone;
