import { ApiError } from "@/lib/api/auth";

const CV_EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const MAX_CV_SIZE = 10 * 1024 * 1024; // 10 MB

/** File CV dari multipart `file`; ekstensi & ukuran divalidasi, galat jadi 400. */
export async function readCvFile(request: Request): Promise<File> {
  const formData = await request.formData().catch(() => null);
  if (!formData) throw ApiError.badRequest("Invalid form data");

  const file = formData.get("file");
  if (!file || typeof file === "string") throw ApiError.badRequest("File tidak ditemukan");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!CV_EXTENSIONS.includes(ext)) {
    throw ApiError.badRequest(`Tipe file tidak valid. Allowed: ${CV_EXTENSIONS.join(", ")}`);
  }
  if (file.size > MAX_CV_SIZE) throw ApiError.badRequest("Ukuran file maksimal 10MB");
  return file;
}
