export interface ApprovalPR {
  id: string;
  pr_number: string;
  requester_name?: string;
  department_name?: string;
  status: string;
  total_amount: number;
  priority: string;
  created_at: string;
  required_date: string | null;
}
