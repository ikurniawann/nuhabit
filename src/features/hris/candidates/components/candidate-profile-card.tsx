import type { ReactNode } from "react";
import { Briefcase, Calendar, Clock, GraduationCap, Mail, MapPin, Phone, User, Wallet } from "lucide-react";
import { formatDate, formatRupiah } from "@/lib/format";
import type { CandidateView } from "../types";

const AVAILABILITY_LABELS: Record<string, string> = {
  immediate: "Segera",
  "1_week": "1 minggu",
  "2_weeks": "2 minggu",
  "1_month": "1 bulan",
};

function InfoField({ icon: Icon, label, value }: { icon: typeof User; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
        <p className="text-sm font-medium break-words text-gray-800">{value || "—"}</p>
      </div>
    </div>
  );
}

export function CandidateProfileCard({ candidate }: { candidate: CandidateView }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <User className="size-4 text-gray-400" /> Profil Kandidat
      </h3>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <InfoField icon={Mail} label="Email" value={candidate.email} />
        <InfoField icon={Phone} label="Telepon" value={candidate.phone} />
        <InfoField icon={MapPin} label="Domisili" value={candidate.domicile} />
        <InfoField icon={Calendar} label="Tanggal Lahir" value={formatDate(candidate.date_of_birth, "")} />
        <InfoField icon={GraduationCap} label="Pendidikan Terakhir" value={candidate.last_education} />
        <InfoField icon={Briefcase} label="Pengalaman Terakhir" value={candidate.last_experience} />
        <InfoField
          icon={Wallet}
          label="Ekspektasi Gaji"
          value={candidate.expected_salary ? formatRupiah(candidate.expected_salary) : null}
        />
        <InfoField icon={Clock} label="Ketersediaan" value={AVAILABILITY_LABELS[candidate.availability ?? ""]} />
      </div>
    </div>
  );
}
