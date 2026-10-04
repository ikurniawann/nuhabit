import { ApiError } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { resetUserEmployeePassword } from "@/lib/users/user-service";

/** Reset password akun login milik karyawan; karyawan tanpa akses aplikasi ditolak. */
export async function resetEmployeeAppPassword(employeeId: string) {
  const { data: employee, error } = await createPgClient()
    .from("employees")
    .select("user_id, is_access_app")
    .eq("id", employeeId)
    .single();

  if (error || !employee) throw ApiError.notFound("Employee not found");
  if (!employee.is_access_app || !employee.user_id) {
    throw ApiError.badRequest("This employee does not have app access");
  }
  return resetUserEmployeePassword(employee.user_id as string);
}
