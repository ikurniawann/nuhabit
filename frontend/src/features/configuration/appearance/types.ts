import type { AppearanceTokens } from "@/lib/theme/appearance-tokens";

export type AppearanceCompany = { id: string; name: string };

export type AppearancePayload = {
  company_id: string | null;
  company_name: string | null;
  companies: AppearanceCompany[];
  theme: AppearanceTokens;
};
