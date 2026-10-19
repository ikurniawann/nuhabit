import path from "node:path";

/** Storage state files written once per run by global-setup.ts. */
export const STAFF_STATE = path.join(__dirname, "..", ".auth", "staff.json");
export const MEMBER_STATE = path.join(__dirname, "..", ".auth", "member.json");

export const staffCredentials = () => {
  const email = process.env.E2E_STAFF_EMAIL;
  const password = process.env.E2E_STAFF_PASSWORD;
  return email && password ? { email, password } : null;
};

export const memberCredentials = () => {
  const username = process.env.E2E_MEMBER_USERNAME;
  const password = process.env.E2E_MEMBER_PASSWORD;
  return username && password ? { username, password } : null;
};

export const STAFF_MISSING = "E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD are not set";
export const MEMBER_MISSING = "E2E_MEMBER_USERNAME and E2E_MEMBER_PASSWORD are not set";
