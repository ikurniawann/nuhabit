import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { MEMBER_STATE, STAFF_STATE, memberCredentials, staffCredentials } from "./support/auth";

const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });

/**
 * Signs in staff and member once per run and saves the cookies as storage
 * state, so specs never hit the login rate limits. Missing credentials leave
 * an empty state and the specs that need it skip.
 */
async function signIn(baseURL: string, endpoint: string, body: Record<string, string> | null, file: string) {
  await mkdir(path.dirname(file), { recursive: true });
  if (!body) {
    await writeFile(file, EMPTY_STATE);
    return;
  }
  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post(endpoint, { data: body });
    if (!response.ok()) {
      throw new Error(`${endpoint} answered ${response.status()}: ${(await response.text()).slice(0, 200)}`);
    }
    await context.storageState({ path: file });
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Set E2E_BASE_URL");
  await signIn(baseURL, "/api/auth/login", staffCredentials(), STAFF_STATE);
  await signIn(baseURL, "/api/member-portal/login", memberCredentials(), MEMBER_STATE);
}
