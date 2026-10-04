import { Loader2 } from "lucide-react";

export function EssLoading() {
  return (
    <div className="flex justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

/** Akun yang login tidak tertaut ke record karyawan HRIS. */
export function EssNotLinked({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-lg font-semibold text-gray-800">Akun ini tidak terhubung ke data karyawan</p>
      <p className="mt-2 text-sm text-gray-500">
        {feature} hanya tersedia untuk akun yang tertaut ke record karyawan HRIS. Hubungi HRD bila
        menurut Anda ini keliru.
      </p>
    </div>
  );
}
