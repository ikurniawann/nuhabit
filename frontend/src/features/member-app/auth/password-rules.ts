/** Mirrors the API rule: 8 to 72 characters with at least one letter and one digit. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** English message key for the first broken rule, null when the password is acceptable. */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return "Use at least 8 characters.";
  if (password.length > PASSWORD_MAX) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one digit.";
  return null;
}
