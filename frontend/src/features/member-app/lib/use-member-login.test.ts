import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemberLogin } from "./use-member-login";

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

function renderLogin(onSignedIn = vi.fn()) {
  const hook = renderHook(() => useMemberLogin({ onSignedIn }));
  const fill = (username: string, password: string) =>
    act(() => {
      hook.result.current.setUsername(username);
      hook.result.current.setPassword(password);
    });
  return { hook, fill, onSignedIn };
}

describe("useMemberLogin", () => {
  it("flags empty fields without calling the API", async () => {
    const fetchMock = respond(200, { success: true });
    const { hook } = renderLogin();
    await act(() => hook.result.current.login());
    expect(hook.result.current.fieldErrors).toEqual({
      username: "Enter your WhatsApp number or email.",
      password: "Enter your password.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 400 with a field onto that field", async () => {
    respond(400, { success: false, error: "Enter a WhatsApp number or email", field: "username" });
    const { hook, fill } = renderLogin();
    fill("ayu", "secret12");
    await act(() => hook.result.current.login());
    expect(hook.result.current.fieldErrors).toEqual({ username: "Enter a WhatsApp number or email" });
    expect(hook.result.current.error).toBeNull();
  });

  it("marks the account as having no password on 403", async () => {
    const message = "This account has no password yet. Ask the front desk to set one, or use Forgot password.";
    respond(403, { success: false, error: message });
    const { hook, fill, onSignedIn } = renderLogin();
    fill("081234567890", "secret12");
    await act(() => hook.result.current.login());
    expect(hook.result.current.error).toBe(message);
    expect(hook.result.current.noPassword).toBe(true);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("keeps the one 401 message as a plain error", async () => {
    respond(401, { success: false, error: "Incorrect username or password" });
    const { hook, fill } = renderLogin();
    fill("ayu@example.test", "wrong1234");
    await act(() => hook.result.current.login());
    expect(hook.result.current.error).toBe("Incorrect username or password");
    expect(hook.result.current.noPassword).toBe(false);
  });

  it("sends the trimmed username and signals success", async () => {
    const fetchMock = respond(200, { success: true, data: { name: "Ayu" } });
    const { hook, fill, onSignedIn } = renderLogin();
    fill(" 081234567890 ", "secret12");
    await act(() => hook.result.current.login());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: "081234567890", password: "secret12" });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(hook.result.current.error).toBeNull();
  });
});
