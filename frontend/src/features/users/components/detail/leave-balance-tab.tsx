"use client";

import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Card, CardContent } from "@/components/ui/card";
import { leaveBalanceUsage } from "@/lib/hris/employee-profile-summary";
import { useEmployeeLeaveBalances } from "../../queries";
import { EmptyTabCard, TabSpinner } from "./tab-states";

export function LeaveBalanceTab({ employeeId }: { employeeId: string }) {
  const { data: leaveBalances = [], isLoading } = useEmployeeLeaveBalances(employeeId);
  if (isLoading) return <TabSpinner />;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-700">Leave Balance</h3>
      {leaveBalances.length === 0 ? (
        <EmptyTabCard icon={CalendarDaysIcon}>No leave balance data yet</EmptyTabCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {leaveBalances.map((lb) => {
            const usage = leaveBalanceUsage(lb);
            return (
              <Card key={lb.id}>
                <CardContent className="p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    {lb.leave_type_name || lb.leave_type}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className="text-3xl font-bold text-blue-600">{usage.remaining}</span>
                    <span className="text-sm text-gray-400 mb-0.5">/ {usage.total} days</span>
                  </div>
                  {usage.used !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">Used: {usage.used} days</p>
                  )}
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${usage.percent}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
