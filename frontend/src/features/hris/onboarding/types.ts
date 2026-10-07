export interface OnboardingEmployee {
  id: string;
  full_name: string;
  nip: string;
  email: string;
  phone: string;
  join_date: string;
  employment_status: string;
  department?: { name: string };
  job_title?: { title: string };
  photo_url?: string;
}
