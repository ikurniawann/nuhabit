"use client";

import { useState, useMemo, use } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftIcon,
  UserCircleIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  ClockIcon,
  PencilIcon,
  CheckCircleIcon,
  XCircleIcon,
  BuildingOfficeIcon,
  BanknotesIcon,
  KeyIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import {
  useEmployeeAttendance,
  useEmployeeLeaveBalances,
  useEmploymentHistory,
  useHRISEmployeeDetail,
} from "../queries";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { CreateAccountDialog } from "./create-account-dialog";
import { EmployeeLifecycleTab } from "./employee-lifecycle-tab";
import { EmployeeContractsTab } from "./employee-contracts-tab";
import { EmployeeDocumentsTab } from "./employee-documents-tab";
import { EmployeeShiftsTab } from "./employee-shifts-tab";

const STATUS_LABELS: Record<string, string> = {
  probation: "Probation",
  contract: "Contract",
  permanent: "Permanent",
  internship: "Internship",
  resigned: "Resigned",
  terminated: "Terminated",
  suspended: "Suspended",
};

const STATUS_COLORS: Record<string, string> = {
  probation: "bg-yellow-100 text-yellow-700",
  contract: "bg-blue-100 text-blue-700",
  permanent: "bg-green-100 text-green-700",
  internship: "bg-purple-100 text-purple-700",
  resigned: "bg-red-100 text-red-600",
  terminated: "bg-red-200 text-red-700",
  suspended: "bg-orange-100 text-orange-700",
};

const HISTORY_TYPE_LABELS: Record<string, string> = {
  hire: "Hired",
  promotion: "Promotion",
  transfer: "Transfer",
  demotion: "Demotion",
  status_change: "Status Change",
  salary_change: "Salary Change",
};

const HISTORY_COLORS: Record<string, string> = {
  hire: "bg-green-100 text-green-700",
  promotion: "bg-blue-100 text-blue-700",
  transfer: "bg-purple-100 text-purple-700",
  demotion: "bg-orange-100 text-orange-700",
  status_change: "bg-yellow-100 text-yellow-700",
  salary_change: "bg-teal-100 text-teal-700",
};

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

function calculateTenure(joinDate: string) {
  const join = new Date(joinDate);
  const now = new Date();
  const years = now.getFullYear() - join.getFullYear();
  const months = now.getMonth() - join.getMonth();
  if (years > 0) return `${years} yr ${Math.max(0, months)} mo`;
  if (months > 0) return `${months} mo`;
  return "Just joined";
}

type Tab =
  | "info"
  | "lifecycle"
  | "contracts"
  | "shifts"
  | "employment"
  | "documents"
  | "attendance"
  | "leave";

const VALID_TABS: Tab[] = [
  "info",
  "lifecycle",
  "contracts",
  "shifts",
  "employment",
  "documents",
  "attendance",
  "leave",
];

export function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const canManageUsers = useIamAccess().hasPrefix(IAM.settingsUsers);
  const canResetPassword = canManageUsers;
  const canCreateAccount = canManageUsers;

  // deep-link tab via ?tab=contracts (dipakai banner pengingat kontrak)
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const requested = searchParams.get("tab") as Tab | null;
    return requested && VALID_TABS.includes(requested) ? requested : "info";
  });
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  const { data: employee, isLoading: loading } = useHRISEmployeeDetail(id);
  const { data: history = [], isLoading: historyLoading } = useEmploymentHistory(
    id,
    activeTab === "employment"
  );
  const attendancePeriod = useMemo(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }, []);
  const { data: attendance = [], isLoading: attendanceLoading } = useEmployeeAttendance(
    id,
    attendancePeriod.month,
    attendancePeriod.year,
    activeTab === "attendance"
  );
  const { data: leaveBalances = [], isLoading: leaveLoading } = useEmployeeLeaveBalances(
    id,
    activeTab === "leave"
  );

  const tabLoading =
    (activeTab === "employment" && historyLoading) ||
    (activeTab === "attendance" && attendanceLoading) ||
    (activeTab === "leave" && leaveLoading);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "info", label: "Personal Info", icon: <UserCircleIcon className="w-4 h-4" /> },
    { key: "lifecycle", label: "Lifecycle", icon: <ArrowPathIcon className="w-4 h-4" /> },
    { key: "contracts", label: "Kontrak", icon: <BriefcaseIcon className="w-4 h-4" /> },
    { key: "shifts", label: "Jadwal Shift", icon: <ClockIcon className="w-4 h-4" /> },
    { key: "employment", label: "Employment History", icon: <BriefcaseIcon className="w-4 h-4" /> },
    { key: "documents", label: "Dokumen", icon: <DocumentTextIcon className="w-4 h-4" /> },
    { key: "attendance", label: "Attendance", icon: <ClockIcon className="w-4 h-4" /> },
    { key: "leave", label: "Leave Balance", icon: <CalendarDaysIcon className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Employee not found</p>
        <Button className="mt-4" onClick={() => router.back()}>Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => router.push("/dashboard/employees")} className="hover:text-gray-900">
          Employee Directory
        </button>
        <span>/</span>
        <span className="text-gray-900 font-medium">{employee?.full_name || "Employee Detail"}</span>
      </div>

      {/* Back + Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1">
          <ArrowLeftIcon className="w-4 h-4" /> Back
        </Button>
      </div>

      {/* Profile Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {employee.photo_url ? (
              <img
                src={employee.photo_url}
                alt={employee.full_name}
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                {employee.full_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">{employee.full_name}</h1>
                <Badge className={STATUS_COLORS[employee.employment_status] || "bg-gray-100 text-gray-600"}>
                  {STATUS_LABELS[employee.employment_status] || employee.employment_status}
                </Badge>
                {employee.is_active ? (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircleIcon className="w-3.5 h-3.5" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <XCircleIcon className="w-3.5 h-3.5" /> Inactive
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {employee.job_title?.title || "—"} · {employee.department?.name || "—"}
                {employee.section ? ` · ${employee.section.name}` : ""}
              </p>
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{employee.nip}</span>
                {employee.email && (
                  <span className="flex items-center gap-1">
                    <EnvelopeIcon className="w-3.5 h-3.5" /> {employee.email}
                  </span>
                )}
                {employee.phone && (
                  <span className="flex items-center gap-1">
                    <PhoneIcon className="w-3.5 h-3.5" /> {employee.phone}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <CalendarDaysIcon className="w-3.5 h-3.5" />
                  Joined {formatDate(employee.join_date)} · {calculateTenure(employee.join_date)}
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {canCreateAccount && !employee.user_id ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateAccountOpen(true)}
                  className="gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                >
                  <KeyIcon className="w-4 h-4" /> Buat Akun Login
                </Button>
              ) : null}
              {canResetPassword && employee.user_id ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetDialogOpen(true)}
                  className="gap-1"
                >
                  <KeyIcon className="w-4 h-4" /> Reset Password
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/dashboard/hris/onboarding/${id}`)}
                className="gap-1"
              >
                Onboarding
              </Button>
              <Button
                size="sm"
                onClick={() => router.push(`/dashboard/employees/edit/${id}`)}
                className="gap-1"
              >
                <PencilIcon className="w-4 h-4" /> Edit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tabLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
        </div>
      ) : (
        <>
          {/* INFO PERSONAL */}
          {activeTab === "info" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Personal Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <UserCircleIcon className="w-4 h-4" /> Personal Data
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Full Name", value: employee.full_name },
                    { label: "Gender", value: employee.gender === "male" ? "Male" : employee.gender === "female" ? "Female" : "-" },
                    { label: "Date of Birth", value: formatDate(employee.birth_date) },
                    { label: "Marital Status", value: { single: "Single", married: "Married", divorced: "Divorced", widowed: "Widowed" }[employee.marital_status as string] || "-" },
                    { label: "KTP", value: employee.ktp || "-" },
                    { label: "NPWP", value: employee.npwp || "-" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-500 shrink-0 w-36">{label}</span>
                      <span className="text-gray-900 text-right">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Contact & Address */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <MapPinIcon className="w-4 h-4" /> Contact & Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Email", value: employee.email },
                    { label: "Phone", value: employee.phone || "-" },
                    { label: "Address", value: employee.address || "-" },
                    { label: "City", value: employee.city || "-" },
                    { label: "Province", value: employee.province || "-" },
                    { label: "Postal Code", value: employee.postal_code || "-" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-500 shrink-0 w-36">{label}</span>
                      <span className="text-gray-900 text-right">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Employment Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <BuildingOfficeIcon className="w-4 h-4" /> Employment Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "NIP", value: employee.nip },
                    { label: "Department", value: employee.department?.name || "-" },
                    { label: "Section", value: employee.section?.name || "-" },
                    { label: "Job Title", value: employee.job_title?.title || "-" },
                    { label: "Manager", value: employee.manager?.full_name || "-" },
                    { label: "Join Date", value: formatDate(employee.join_date) },
                    { label: "Status", value: STATUS_LABELS[employee.employment_status] || employee.employment_status },
                    { label: "Tenure", value: calculateTenure(employee.join_date) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-500 shrink-0 w-36">{label}</span>
                      <span className="text-gray-900 text-right">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Banking & BPJS */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <BanknotesIcon className="w-4 h-4" /> Bank & BPJS
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Bank Name", value: employee.bank_name || "-" },
                    { label: "Account No.", value: employee.bank_account || "-" },
                    { label: "BPJS Employment", value: employee.bpjs_tk || "-" },
                    { label: "BPJS Health", value: employee.bpjs_kesehatan || "-" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-gray-500 shrink-0 w-36">{label}</span>
                      <span className="text-gray-900 text-right font-mono text-xs">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Emergency Contact */}
              {(employee.emergency_contact_name || employee.emergency_contact_phone) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <PhoneIcon className="w-4 h-4" /> Emergency Contact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Name", value: employee.emergency_contact_name || "-" },
                      { label: "Phone", value: employee.emergency_contact_phone || "-" },
                      { label: "Relationship", value: employee.emergency_contact_relationship || "-" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-gray-500 shrink-0 w-36">{label}</span>
                        <span className="text-gray-900 text-right">{value}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* LIFECYCLE */}
          {activeTab === "lifecycle" && <EmployeeLifecycleTab employeeId={id} />}

          {activeTab === "contracts" && <EmployeeContractsTab employeeId={id} />}

          {activeTab === "shifts" && <EmployeeShiftsTab employeeId={id} />}

          {/* RIWAYAT KERJA */}
          {activeTab === "employment" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-gray-700">Employment History</h3>
              </div>
              {history.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400">
                    <BriefcaseIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No employment history yet
                  </CardContent>
                </Card>
              ) : (
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
                  <div className="space-y-4">
                    {history.map((h) => (
                      <div key={h.id} className="relative pl-12">
                        <div className="absolute left-3.5 top-3 w-3 h-3 rounded-full border-2 border-white bg-blue-500 shadow" />
                        <Card>
                          <CardContent className="p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Badge className={HISTORY_COLORS[h.change_type] || "bg-gray-100 text-gray-600"}>
                                {HISTORY_TYPE_LABELS[h.change_type] || h.change_type}
                              </Badge>
                              <span className="text-xs text-gray-500">{formatDate(h.effective_date)}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                              {h.prev_department && (
                                <div>
                                  <p className="text-xs text-gray-400">From Department</p>
                                  <p className="text-gray-700">{h.prev_department.name}</p>
                                </div>
                              )}
                              {h.new_department && (
                                <div>
                                  <p className="text-xs text-gray-400">To Department</p>
                                  <p className="text-gray-700 font-medium">{h.new_department.name}</p>
                                </div>
                              )}
                              {h.prev_job_title && (
                                <div>
                                  <p className="text-xs text-gray-400">From Job Title</p>
                                  <p className="text-gray-700">{h.prev_job_title.title}</p>
                                </div>
                              )}
                              {h.new_job_title && (
                                <div>
                                  <p className="text-xs text-gray-400">To Job Title</p>
                                  <p className="text-gray-700 font-medium">{h.new_job_title.title}</p>
                                </div>
                              )}
                              {h.prev_employment_status && (
                                <div>
                                  <p className="text-xs text-gray-400">From Status</p>
                                  <p className="text-gray-700">{STATUS_LABELS[h.prev_employment_status]}</p>
                                </div>
                              )}
                              {h.new_employment_status && (
                                <div>
                                  <p className="text-xs text-gray-400">To Status</p>
                                  <p className="text-gray-700 font-medium">{STATUS_LABELS[h.new_employment_status]}</p>
                                </div>
                              )}
                            </div>
                            {(h.reason || h.notes) && (
                              <p className="mt-2 text-xs text-gray-500 italic">&ldquo;{h.reason || h.notes}&rdquo;</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DOKUMEN — semua lampiran: rekrutmen, kontrak, upload manual */}
          {activeTab === "documents" && <EmployeeDocumentsTab employeeId={id} />}

          {/* ABSENSI */}
          {activeTab === "attendance" && (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-700">Attendance Summary (This Month)</h3>
              {attendance.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400">
                    <ClockIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No attendance data for this month
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "Present", value: attendance.filter(a => a.status === "present").length, color: "text-green-700" },
                      { label: "Late", value: attendance.filter(a => a.is_late).length, color: "text-yellow-700" },
                      { label: "Absent", value: attendance.filter(a => a.status === "absent").length, color: "text-red-700" },
                      { label: "Total Hours", value: attendance.reduce((sum: number, a: any) => sum + (a.work_hours || 0), 0).toFixed(1) + "h", color: "text-blue-700" },
                    ].map((s) => (
                      <Card key={s.label}>
                        <CardContent className="pt-4 pb-3">
                          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                          <p className="text-xs text-gray-500">{s.label}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {/* Attendance List */}
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 bg-gray-50">
                              <th className="text-left p-3">Date</th>
                              <th className="text-left p-3">Clock In</th>
                              <th className="text-left p-3">Clock Out</th>
                              <th className="text-left p-3">Work Hours</th>
                              <th className="text-left p-3">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attendance.map((a) => (
                              <tr key={a.id} className="border-b border-gray-50">
                                <td className="p-3 text-gray-700">{formatDate(a.date)}</td>
                                <td className="p-3 text-gray-600">{a.clock_in ? new Date(a.clock_in).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                                <td className="p-3 text-gray-600">{a.clock_out ? new Date(a.clock_out).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                                <td className="p-3 text-gray-600">{a.work_hours ? `${a.work_hours.toFixed(1)}h` : "-"}</td>
                                <td className="p-3">
                                  <div className="flex gap-1">
                                    <Badge className={a.status === "present" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}>
                                      {a.status === "present" ? "Present" : a.status === "absent" ? "Absent" : a.status}
                                    </Badge>
                                    {a.is_late && <Badge className="bg-yellow-100 text-yellow-700">Late</Badge>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* SALDO CUTI */}
          {activeTab === "leave" && (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-700">Leave Balance</h3>
              {leaveBalances.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400">
                    <CalendarDaysIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No leave balance data yet
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {leaveBalances.map((lb) => (
                    <Card key={lb.id}>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                          {lb.leave_type_name || lb.leave_type}
                        </p>
                        <div className="flex items-end gap-1">
                          <span className="text-3xl font-bold text-blue-600">{lb.remaining_days ?? lb.balance}</span>
                          <span className="text-sm text-gray-400 mb-0.5">/ {lb.total_days ?? lb.quota} days</span>
                        </div>
                        {(lb.used_days !== undefined || lb.used !== undefined) && (
                          <p className="text-xs text-gray-400 mt-1">
                            Used: {lb.used_days ?? lb.used} days
                          </p>
                        )}
                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{
                              width: `${Math.min(100, ((lb.used_days ?? lb.used ?? 0) / (lb.total_days ?? lb.quota ?? 1)) * 100)}%`
                            }}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <ResetPasswordDialog
        target={{ id, fullName: employee.full_name }}
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        onError={(message) => showToast(message, "error")}
      />

      {createAccountOpen && (
        <CreateAccountDialog
          employee={{ id, full_name: employee.full_name, email: employee.email }}
          open
          onOpenChange={setCreateAccountOpen}
          onSuccess={(message) => showToast(message)}
          onError={(message) => showToast(message, "error")}
        />
      )}
    </div>
  );
}
