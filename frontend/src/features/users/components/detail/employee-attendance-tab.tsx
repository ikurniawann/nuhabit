"use client";

import { useState } from "react";
import { ClockIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/format";
import { summarizeAttendance } from "@/lib/hris/employee-profile-summary";
import { useEmployeeAttendance } from "../../queries";
import { EmptyTabCard, TabSpinner } from "./tab-states";

function currentPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/** Tab "Attendance": rekap absensi bulan berjalan. */
export function EmployeeAttendanceTab({ employeeId }: { employeeId: string }) {
  const [period] = useState(currentPeriod);
  const { data: attendance = [], isLoading } = useEmployeeAttendance(
    employeeId,
    period.month,
    period.year
  );
  if (isLoading) return <TabSpinner />;

  const summary = summarizeAttendance(attendance);
  const stats = [
    { label: "Present", value: summary.present, color: "text-green-700" },
    { label: "Late", value: summary.late, color: "text-yellow-700" },
    { label: "Absent", value: summary.absent, color: "text-red-700" },
    {
      label: "Total Hours",
      value: `${summary.totalHours.toFixed(1)}h`,
      color: "text-blue-700",
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-700">Attendance Summary (This Month)</h3>
      {attendance.length === 0 ? (
        <EmptyTabCard icon={ClockIcon}>No attendance data for this month</EmptyTabCard>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
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
                        <td className="p-3 text-gray-600">{formatTime(a.clock_in)}</td>
                        <td className="p-3 text-gray-600">{formatTime(a.clock_out)}</td>
                        <td className="p-3 text-gray-600">
                          {a.work_hours ? `${a.work_hours.toFixed(1)}h` : "-"}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Badge
                              className={
                                a.status === "present"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-600"
                              }
                            >
                              {a.status === "present"
                                ? "Present"
                                : a.status === "absent"
                                  ? "Absent"
                                  : a.status}
                            </Badge>
                            {a.is_late && (
                              <Badge className="bg-yellow-100 text-yellow-700">Late</Badge>
                            )}
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
  );
}
