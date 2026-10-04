export const holidayQueryKeys = {
  lists: () => ["hris", "holidays", "list"] as const,
  list: (year: number) => ["hris", "holidays", "list", year] as const,
  importPreview: (year: number) => ["hris", "holidays", "import", year] as const,
};
