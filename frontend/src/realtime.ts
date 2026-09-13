import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HEALTH_URL, socket } from "./lib";

export type HealthSnapshot = {
  status: "online" | "degraded";
  database: "connected" | "disconnected";
  databaseLatencyMs: number | null;
  uptimeSeconds: number;
  timestamp: string;
};
export type ConnectionStatus = "ONLINE" | "CONNECTING" | "DEGRADED" | "OFFLINE";
type SocketStatus = "ONLINE" | "CONNECTING" | "OFFLINE";

/** A health response is usable only when the API and its backing database agree that the service is online. */
export function healthIsUsable(
  snapshot: Pick<HealthSnapshot, "status" | "database">,
) {
  return snapshot.status === "online" && snapshot.database === "connected";
}

export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthSnapshot> {
  const response = await fetch(HEALTH_URL, { signal });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body?.error?.message ?? "Health check failed");
  return body.data as HealthSnapshot;
}

export function useRealtime(
  events: Record<string, (...args: any[]) => void>,
  subscribe?: () => void,
) {
  const eventsRef = useRef(events);
  const subscribeRef = useRef(subscribe);
  eventsRef.current = events;
  subscribeRef.current = subscribe;
  const eventNames = Object.keys(events).sort().join("|");
  useEffect(() => {
    socket.auth = { token: localStorage.getItem("drone-token") };
    // Keep the socket subscriptions stable while routing each event to the
    // latest callback. This avoids stale React state when callers pass inline
    // handlers without changing the event-name set.
    const entries = Object.keys(eventsRef.current).map((event) => {
      const handler = (...args: any[]) => eventsRef.current[event]?.(...args);
      socket.on(event, handler);
      return [event, handler] as const;
    });
    const onConnect = () => subscribeRef.current?.();
    socket.on("connect", onConnect);
    if (!socket.connected) socket.connect();
    else subscribeRef.current?.();
    return () => {
      socket.off("connect", onConnect);
      entries.forEach(([event, handler]) => socket.off(event, handler));
    };
  }, [eventNames]);
}

const connectionListeners = new Set<() => void>();
let socketStatus: SocketStatus = socket.connected ? "ONLINE" : "CONNECTING";
let apiHealthy: boolean | null = null;
let connectionStatus: ConnectionStatus = "CONNECTING";
let connectionStarted = false;
let healthTimer: number | undefined;
let healthController: AbortController | null = null;

function deriveConnectionStatus(): ConnectionStatus {
  if (socketStatus === "OFFLINE") return "OFFLINE";
  if (apiHealthy === false) return "DEGRADED";
  if (apiHealthy === true && socketStatus === "ONLINE") return "ONLINE";
  return "CONNECTING";
}

function publishConnectionStatus() {
  const next = deriveConnectionStatus();
  if (next === connectionStatus) return;
  connectionStatus = next;
  connectionListeners.forEach((listener) => listener());
}

function setSocketStatus(next: SocketStatus) {
  if (socketStatus === next) return;
  socketStatus = next;
  publishConnectionStatus();
}

function setApiHealthy(next: boolean | null) {
  if (apiHealthy === next) return;
  apiHealthy = next;
  publishConnectionStatus();
}

async function checkSharedHealth() {
  healthController?.abort();
  const controller = new AbortController();
  healthController = controller;
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const snapshot = await fetchHealth(controller.signal);
    if (!controller.signal.aborted && healthController === controller)
      setApiHealthy(healthIsUsable(snapshot));
  } catch {
    if (!controller.signal.aborted && healthController === controller)
      setApiHealthy(false);
  } finally {
    window.clearTimeout(timeout);
    if (healthController === controller) healthController = null;
  }
}

let stopConnectionStore: (() => void) | undefined;
function startConnectionStore() {
  if (connectionStarted) return;
  connectionStarted = true;
  const online = () => setSocketStatus("ONLINE");
  const offline = () => setSocketStatus("OFFLINE");
  const connecting = () => setSocketStatus("CONNECTING");
  socket.on("connect", online);
  socket.on("disconnect", offline);
  socket.on("connect_error", offline);
  socket.io.on("reconnect_attempt", connecting);
  if (socket.connected) setSocketStatus("ONLINE");
  else {
    setSocketStatus("CONNECTING");
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.connect();
  }
  void checkSharedHealth();
  healthTimer = window.setInterval(() => void checkSharedHealth(), 15_000);
  stopConnectionStore = () => {
    socket.off("connect", online);
    socket.off("disconnect", offline);
    socket.off("connect_error", offline);
    socket.io.off("reconnect_attempt", connecting);
    if (healthTimer !== undefined) window.clearInterval(healthTimer);
    healthTimer = undefined;
    healthController?.abort();
    healthController = null;
    connectionStarted = false;
  };
}

function subscribeConnection(listener: () => void) {
  connectionListeners.add(listener);
  startConnectionStore();
  return () => {
    connectionListeners.delete(listener);
    if (!connectionListeners.size) stopConnectionStore?.();
  };
}

function getConnectionStatus() {
  return connectionStatus;
}

export function retryConnection() {
  startConnectionStore();
  setSocketStatus("CONNECTING");
  setApiHealthy(null);
  void checkSharedHealth();
  socket.auth = { token: localStorage.getItem("drone-token") };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function useConnectionStatus() {
  const status = useSyncExternalStore(
    subscribeConnection,
    getConnectionStatus,
    getConnectionStatus,
  );
  return { status, retry: retryConnection };
}

export function useHealthDetails() {
  const [health, setHealth] = useState<HealthSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const snapshot = await fetchHealth(controller.signal);
        if (active) {
          setHealth(snapshot);
          setError(false);
        }
      } catch (reason: any) {
        if (
          active &&
          reason?.name !== "AbortError" &&
          reason?.code !== "ERR_CANCELED"
        ) {
          setHealth(undefined);
          setError(true);
        }
      } finally {
        if (active && requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, []);
  return { health, loading, error };
}
