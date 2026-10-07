"use client";

import { use } from "react";
import { UserFormPage } from "@/features/users";

interface EditEmployeePageProps {
  params: Promise<{ id: string }>;
}

export default function EditEmployeePage({ params }: EditEmployeePageProps) {
  const { id } = use(params);
  return <UserFormPage mode="edit" employeeId={id} />;
}
