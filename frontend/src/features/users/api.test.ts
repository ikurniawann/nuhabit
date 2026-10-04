import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createUser,
  fetchUserDetail,
  fetchUserList,
  resetUserPassword,
  updateUser,
} from "./api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiPut } from "@/lib/api-client";

describe("users api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchUserList calls apiGet with query string", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [], total: 0, page: 1, perPage: 15 });

    await fetchUserList({ page: 2, search: "budi", is_access_app: "true" });

    expect(apiGet).toHaveBeenCalledWith(
      "/api/users?page=2&search=budi&is_access_app=true"
    );
  });

  it("fetchUserList without params uses base path", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [], total: 0, page: 1, perPage: 20 });
    await fetchUserList();
    expect(apiGet).toHaveBeenCalledWith("/api/users");
  });

  it("fetchUserDetail calls correct endpoint", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { id: "emp-1" } });
    await fetchUserDetail("emp-1");
    expect(apiGet).toHaveBeenCalledWith("/api/users/emp-1");
  });

  it("createUser posts to base endpoint", async () => {
    const payload = {
      full_name: "Test",
      email: "test@example.com",
      join_date: "2024-01-01",
      employment_status: "permanent",
      is_access_app: false,
      approval_permissions: [],
    };
    vi.mocked(apiPost).mockResolvedValue({ data: { id: "emp-1" }, message: "ok" });

    await createUser(payload);

    expect(apiPost).toHaveBeenCalledWith("/api/users", payload);
  });

  it("updateUser puts to id endpoint", async () => {
    vi.mocked(apiPut).mockResolvedValue({ data: { id: "emp-1" }, message: "ok" });
    await updateUser("emp-1", { phone: "08123" });
    expect(apiPut).toHaveBeenCalledWith("/api/users/emp-1", { phone: "08123" });
  });

  it("resetUserPassword posts to reset endpoint", async () => {
    vi.mocked(apiPost).mockResolvedValue({ message: "ok", tempPassword: "x" });
    await resetUserPassword("emp-1");
    expect(apiPost).toHaveBeenCalledWith("/api/users/emp-1/reset-password", {});
  });
});
