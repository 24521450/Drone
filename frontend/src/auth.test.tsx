// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider, useAuth } from "./auth";
import { socket } from "./lib";
import type { User } from "./types";

function Harness() {
  const { user } = useAuth();
  return <output data-testid="session-role">{user?.role ?? "NONE"}</output>;
}

const session: User = { id: "session-user", name: "Session User", email: "session@test.local", role: "ADMIN", isActive: true };

afterEach(() => { cleanup(); localStorage.clear(); });

describe("realtime session synchronization", () => {
  it("updates and revokes the current session from user events", () => {
    localStorage.setItem("drone-user", JSON.stringify(session));
    render(<AuthProvider><Harness /></AuthProvider>);
    const handler = (socket as any).listeners("user:updated").at(-1) as ((user: User) => void) | undefined;
    expect(handler).toBeTypeOf("function");

    act(() => handler?.({ ...session, role: "VIEWER" }));
    expect(screen.getByTestId("session-role").textContent).toBe("VIEWER");
    expect(JSON.parse(localStorage.getItem("drone-user") ?? "null").role).toBe("VIEWER");

    act(() => handler?.({ ...session, role: "VIEWER", isActive: false }));
    expect(screen.getByTestId("session-role").textContent).toBe("NONE");
    expect(localStorage.getItem("drone-token")).toBeNull();
    expect(localStorage.getItem("drone-user")).toBeNull();
  });
});
