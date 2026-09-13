import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "./types";
import { api, socket } from "./lib";
import { runtimeConfig } from "./config";

type AuthValue = { user: User | null; checking: boolean; setSession: (user: User, token: string) => void; logout: () => void };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem("drone-user") ?? "null"); } catch { return null; }
  });
  const [checking, setChecking] = useState(() => Boolean(localStorage.getItem("drone-token")));
  const currentUserRef = useRef<User | null>(user);
  const sessionRequestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    currentUserRef.current = user;
  }, [user]);
  useEffect(() => {
    const onUserUpdated = (next: User) => {
      if (!next?.id || currentUserRef.current?.id !== next.id) return;
      if (!next.isActive) {
        sessionRequestRef.current?.abort();
        socket.disconnect();
        currentUserRef.current = null;
        localStorage.removeItem("drone-token");
        localStorage.removeItem("drone-user");
        setUser(null);
        return;
      }
      currentUserRef.current = next;
      localStorage.setItem("drone-user", JSON.stringify(next));
      setUser(next);
    };
    socket.on("user:updated", onUserUpdated);
    return () => { socket.off("user:updated", onUserUpdated); };
  }, []);
  useEffect(() => {
    if (runtimeConfig.error) { setChecking(false); return; }
    if (!localStorage.getItem("drone-token")) { setChecking(false); return; }
    const controller = new AbortController();
    sessionRequestRef.current = controller;
    api.get("/auth/me", { signal: controller.signal }).then((response) => { if (controller.signal.aborted) return; currentUserRef.current = response.data.data; setUser(response.data.data); localStorage.setItem("drone-user", JSON.stringify(response.data.data)); }).catch((reason) => { if (reason?.code === "ERR_CANCELED" || reason?.name === "CanceledError") return; currentUserRef.current = null; localStorage.removeItem("drone-token"); localStorage.removeItem("drone-user"); setUser(null); }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); if (sessionRequestRef.current === controller) sessionRequestRef.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    if (runtimeConfig.error) return () => { active = false; };
    const validate = () => {
      if (!localStorage.getItem("drone-token") || !currentUserRef.current || sessionRequestRef.current) return;
      const controller = new AbortController();
      sessionRequestRef.current = controller;
      api.get("/auth/me", { signal: controller.signal })
        .then((response) => {
          if (!active || controller.signal.aborted) return;
          currentUserRef.current = response.data.data;
          localStorage.setItem("drone-user", JSON.stringify(response.data.data));
          setUser(response.data.data);
        })
        .catch((reason) => {
          if (!active || controller.signal.aborted || reason?.code === "ERR_CANCELED" || reason?.name === "CanceledError") return;
          if (reason?.response?.status === 401) {
            currentUserRef.current = null;
            localStorage.removeItem("drone-token");
            localStorage.removeItem("drone-user");
            setUser(null);
          }
        })
        .finally(() => { if (sessionRequestRef.current === controller) sessionRequestRef.current = null; });
    };
    const timer = window.setInterval(validate, 60_000);
    window.addEventListener("focus", validate);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", validate); };
  }, []);
  const value = useMemo(() => ({
    user, checking,
    setSession: (next: User, token: string) => { sessionRequestRef.current?.abort(); currentUserRef.current = next; localStorage.setItem("drone-token", token); localStorage.setItem("drone-user", JSON.stringify(next)); setUser(next); setChecking(false); },
    logout: () => { sessionRequestRef.current?.abort(); const token = localStorage.getItem("drone-token"); if (token) void api.post("/auth/logout", undefined, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined); socket.disconnect(); currentUserRef.current = null; localStorage.removeItem("drone-token"); localStorage.removeItem("drone-user"); setUser(null); },
  }), [user, checking]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
};
export function Protected({ children }: { children: ReactNode }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) return <div className="loading">Validating secure session…</div>;
  return user ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "ADMIN" ? children : <Navigate to="/overview" replace />;
}
