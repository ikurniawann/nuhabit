"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOffboardingEmployee, useOffboardingRecord } from "../queries";
import type { OffboardingEmployee } from "../types";
import { InitiateOffboardingCard } from "./initiate-offboarding-card";
import { OffboardingDetailCard } from "./offboarding-detail-card";

interface OffboardingPageProps {
  params: Promise<{ employee_id: string }>;
}

export function OffboardingPage({ params }: OffboardingPageProps) {
  const { employee_id: employeeId } = use(params);
  const employeeQuery = useOffboardingEmployee(employeeId);
  const recordQuery = useOffboardingRecord(employeeId);
  const employee = employeeQuery.data ?? null;
  const offboarding = recordQuery.data ?? null;

  if (employeeQuery.isLoading || recordQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!employee) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-gray-500 mb-4">Karyawan tidak ditemukan</p>
          <Button asChild>
            <Link href="/dashboard/employees">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Kembali ke Daftar Karyawan
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/employees">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offboarding / Resignasi</h1>
          <p className="text-gray-500 mt-1">Kelola proses resignasi dan pengembalian aset</p>
        </div>
      </div>

      <EmployeeInfoCard employee={employee} />

      {offboarding ? (
        <OffboardingDetailCard employeeId={employeeId} offboarding={offboarding} />
      ) : (
        <InitiateOffboardingCard employeeId={employeeId} employeeName={employee.full_name} />
      )}
    </div>
  );
}

function EmployeeInfoCard({ employee }: { employee: OffboardingEmployee }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <User className="w-6 h-6 text-green-600" />
          {employee.full_name}
          <span className="text-sm text-gray-500 font-normal ml-2">{employee.nip} • {employee.department?.name || "-"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">Jabatan</p>
            <p className="font-medium">{employee.job_title?.title || "-"}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Email</p>
            <p className="font-medium">{employee.email}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <Badge variant={employee.is_active ? "default" : "secondary"}>
              {employee.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-gray-500">Employment</p>
            <Badge variant="outline">{employee.employment_status}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
