import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Can, permissionHint } from "./can";
import { IamAccessProvider, useCan } from "./iam-access-provider";

const frontDesk = { gym: ["read"], "gym.credits": ["read", "create"], "gym.bookings": ["read", "create", "update"] };

function withActions(grantedActions?: Record<string, string[]>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <IamAccessProvider grantedCodes={Object.keys(grantedActions ?? {})} grantedActions={grantedActions}>
        {children}
      </IamAccessProvider>
    );
  };
}

describe("useCan", () => {
  it("matches the action on the menu or a menu under it", () => {
    const can = (menus: string | string[], action: string) =>
      renderHook(() => useCan(menus, action), { wrapper: withActions(frontDesk) }).result.current;
    expect(can("gym.credits", "create")).toBe(true);
    expect(can("gym.credits", "update")).toBe(false);
    expect(can(["gym.sessions", "gym.bookings"], "update")).toBe(true);
    expect(can("gym.packages", "read")).toBe(false);
    // Prefixes match whole menu codes, not text.
    expect(can("gym.cred", "read")).toBe(false);
  });

  it("keeps read_own apart from read", () => {
    const coach = withActions({ "gym.sessions": ["read_own"] });
    expect(renderHook(() => useCan("gym.sessions", "read_own"), { wrapper: coach }).result.current).toBe(true);
    expect(renderHook(() => useCan("gym.sessions", "read"), { wrapper: coach }).result.current).toBe(false);
  });

  it("allows everything when the layout sent no action data", () => {
    expect(renderHook(() => useCan("gym.credits", "update"), { wrapper: withActions(undefined) }).result.current).toBe(true);
  });
});

describe("Can", () => {
  const adjust = <button type="button">Sesuaikan</button>;

  it("hides an action the user lacks", () => {
    render(
      <Can menu="gym.credits" action="update">
        {adjust}
      </Can>,
      { wrapper: withActions(frontDesk) }
    );
    expect(screen.queryByRole("button", { name: "Sesuaikan" })).not.toBeInTheDocument();
  });

  it("disables it in disable mode", () => {
    render(
      <Can menu="gym.credits" action="update" mode="disable">
        {adjust}
      </Can>,
      { wrapper: withActions(frontDesk) }
    );
    expect(screen.getByRole("button", { name: "Sesuaikan" })).toBeDisabled();
    expect(permissionHint("update")).toBe("Butuh izin mengubah");
  });

  it("shows it when granted", () => {
    render(
      <Can menu="gym.credits" action="create" mode="disable">
        <button type="button">Jual paket</button>
      </Can>,
      { wrapper: withActions(frontDesk) }
    );
    expect(screen.getByRole("button", { name: "Jual paket" })).toBeEnabled();
  });
});
