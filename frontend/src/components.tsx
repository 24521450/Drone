import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Activity, BarChart3, Bell, CalendarClock, CircleGauge, CloudSun, Command, Fence, History, Images, LogOut, MapPinned, Menu, Plane, Radio, RefreshCw, ScrollText, Server, ShieldAlert, Sprout, Users, Wrench, X } from "lucide-react";
import { useAuth } from "./auth";
import { api, socket } from "./lib";
import { useConnectionStatus } from "./realtime";

export function StatusBadge({ status }: { status: string }) {
  const tone = /CRITICAL|FAILED|OFFLINE|SERVICE_DUE/.test(status) ? "danger" : /WARNING|LOW|WEAK|WATCH|STALE|DEGRADED|PROCESSING|WAITING|HIGH/.test(status) ? "warning" : /ONLINE|COMPLETED|ACTIVE|IN_FLIGHT|SUCCESS|HEALTHY|STARTED|LIVE/.test(status) ? "success" : "neutral";
  return <span className={`badge ${tone}`}><i />{status.replaceAll("_", " ")}</span>;
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <header className="panel-head"><h2>{title}</h2>{action}</header>}{children}</section>;
}

export function Metric({ label, value, unit, icon }: { label: string; value: string | number; unit?: string; icon?: ReactNode }) {
  return <div className="metric"><div className="metric-top"><span>{label}</span>{icon}</div><strong>{value}<small>{unit}</small></strong></div>;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><Radio size={28} /><strong>{title}</strong><p>{text}</p></div>;
}

const links = [
  { to: "/overview", label: "Overview", icon: CircleGauge },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/drones", label: "Drones", icon: Plane },
  { to: "/maintenance", label: "Fleet Health", icon: Wrench },
  { to: "/environment", label: "Environment", icon: CloudSun },
  { to: "/system-status", label: "System Status", icon: Server },
  { to: "/field-intelligence", label: "Field Intelligence", icon: Sprout },
  { to: "/media", label: "Media", icon: Images },
  { to: "/live", label: "Live Flight", icon: Activity },
  { to: "/telemetry", label: "Telemetry", icon: Radio },
  { to: "/missions", label: "Missions", icon: MapPinned },
  { to: "/schedule", label: "Flight Schedule", icon: CalendarClock },
  { to: "/command-center", label: "Command Center", icon: Command },
  { to: "/geofences", label: "Geofences", icon: Fence },
  { to: "/alerts", label: "Alert Center", icon: Bell },
  { to: "/safety-rules", label: "Safety Rules", icon: ShieldAlert },
  { to: "/history", label: "Flight History", icon: History },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState(0);
  const { status: connection, retry: retryConnection } = useConnectionStatus();
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      api.get("/alerts", { params: { status: "ACTIVE", limit: 1 }, signal: current.signal })
        .then((response) => { if (active && !current.signal.aborted) setActiveAlerts(response.data.meta?.total ?? response.data.data.length); })
        .catch(() => undefined)
        .finally(() => { if (controller === current) controller = null; });
    };
    const alertCreated = (payload: { severity?: string; message?: string }) => { if (payload?.severity === "CRITICAL" && payload.message) window.dispatchEvent(new CustomEvent("drone:critical-alert", { detail: { message: payload.message } })); load(); };
    const subscribe = () => socket.emit("subscribe:fleet"); load(); subscribe(); socket.on("connect", subscribe); socket.on("alert:created", alertCreated); socket.on("alert:updated", load); socket.on("flight:status", load);
    return () => { active = false; controller?.abort(); socket.off("connect", subscribe); socket.off("alert:created", alertCreated); socket.off("alert:updated", load); socket.off("flight:status", load); };
  }, []);
  return <div className="shell">
    <aside className={open ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="brand-mark"><Plane size={19} /></span><div><b>DRONE</b><small>MONITORING</small></div><button className="icon-btn close-nav" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></button></div>
      <nav>{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setOpen(false)}><Icon size={18} />{label}{to === "/alerts" && activeAlerts > 0 && <span className="nav-count">{activeAlerts > 99 ? "99+" : activeAlerts}</span>}</NavLink>)}
        {user?.role === "ADMIN" && <><p className="nav-section">ADMINISTRATION</p><NavLink to="/users" onClick={() => setOpen(false)}><Users size={18} />Users</NavLink><NavLink to="/audit-log" onClick={() => setOpen(false)}><ScrollText size={18} />Audit Log</NavLink></>}
      </nav>
      <div className="sidebar-foot"><span className={connection === "ONLINE" ? "live-dot" : "live-dot offline"} />System {connection.toLowerCase()}{connection !== "ONLINE" && <button className="status-retry" aria-label="Retry connection" title="Retry connection" onClick={retryConnection} disabled={connection === "CONNECTING"}><RefreshCw size={13} /></button>}</div>
    </aside>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
    <main className="main"><header className="topbar"><button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></button><div className="top-status"><span className={connection === "ONLINE" ? "live-dot" : "live-dot offline"} />{connection === "ONLINE" ? "All systems operational" : connection === "CONNECTING" ? "Checking system health" : connection === "DEGRADED" ? "API or database degraded" : "Realtime link offline"}{connection !== "ONLINE" && <button className="status-retry" aria-label="Retry connection" title="Retry connection" onClick={retryConnection} disabled={connection === "CONNECTING"}><RefreshCw size={13} /></button>}</div><div className="profile"><div><b>{user?.name}</b><small>{user?.role}</small></div><span>{user?.name?.slice(0, 1).toUpperCase()}</span><button className="icon-btn" aria-label="Sign out" onClick={logout} title="Sign out"><LogOut size={18} /></button></div></header><div className="content"><Outlet /></div></main>
  </div>;
}

export function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="page-title"><div><p>{eyebrow}</p><h1>{title}</h1><span>{text}</span></div>{action}</div>;
}

export function AlertRow({ severity, message, time }: { severity: string; message: string; time?: string }) {
  return <div className="alert-row"><span className={`alert-icon ${severity.toLowerCase()}`}><Bell size={16} /></span><div><b>{message}</b><small>{time ? new Date(time).toLocaleString() : severity}</small></div></div>;
}
