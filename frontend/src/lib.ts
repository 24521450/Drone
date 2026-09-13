import axios from "axios";
import { io } from "socket.io-client";
import { runtimeConfig } from "./config";

export const API_URL = runtimeConfig.apiUrl;
export const SOCKET_URL = runtimeConfig.socketUrl;
export const HEALTH_URL = API_URL.replace(/\/api\/v1\/?$/, "") + "/health";
export const api = axios.create({ baseURL: API_URL, timeout: 20_000 });
api.interceptors.request.use((request) => {
  const token = localStorage.getItem("drone-token");
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("/auth/login")
    ) {
      socket.disconnect();
      localStorage.removeItem("drone-token");
      localStorage.removeItem("drone-user");
      window.location.assign("/login");
    }
    return Promise.reject(error);
  },
);
export const socket = io(SOCKET_URL, { autoConnect: false });
export const errorMessage = (error: any) => {
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT")
    return "The request timed out. Check the connection and try again.";
  if (error?.message === "Network Error")
    return "Unable to reach the API. Check that the backend is running.";
  if (error?.response?.status === 429) {
    const retryAfter = Number(
      error.response.headers?.["retry-after"] ??
        error.response.headers?.["Retry-After"],
    );
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `Too many requests. Try again in ${Math.ceil(retryAfter)} seconds.`
      : "Too many requests. Please try again shortly.";
  }
  return (
    error?.response?.data?.error?.message ??
    error?.message ??
    "Something went wrong"
  );
};
export const isCanceledRequest = (error: any) =>
  error?.code === "ERR_CANCELED" ||
  error?.name === "CanceledError" ||
  error?.name === "AbortError";
export function applyAlertUpdate<T extends { _id: string; status?: string }>(
  items: T[],
  payload: Partial<T> & { alertIds?: string[] },
) {
  const ids = payload.alertIds ?? (payload._id ? [payload._id] : []);
  if (!ids.length) return items;
  if (payload.status && payload.status !== "ACTIVE")
    return items.filter((item) => !ids.includes(item._id));
  return payload._id
    ? items.map((item) =>
        item._id === payload._id ? { ...item, ...payload } : item,
      )
    : items;
}
export type TelemetryState = "LIVE" | "WAITING" | "STALE";
export const telemetryAgeMs = (timestamp?: string, now = Date.now()) => {
  if (!timestamp) return Infinity;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? Math.max(0, now - time) : Infinity;
};
export const telemetryState = (
  timestamp?: string,
  now = Date.now(),
  staleAfterMs = 5_000,
): TelemetryState => {
  if (!timestamp) return "WAITING";
  return telemetryAgeMs(timestamp, now) > staleAfterMs ? "STALE" : "LIVE";
};
export type MissionProgress = {
  current: number;
  total: number;
  percent: number;
  phase: "TAKEOFF" | "MISSION" | "PAUSED" | "RETURN_HOME" | "LANDING" | "COMPLETED";
};
export const missionProgress = (
  waypointIndex?: number,
  waypointCount?: number,
  flightPhase?: MissionProgress["phase"],
): MissionProgress | undefined => {
  const total = Math.trunc(Number(waypointCount));
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const phase = flightPhase ?? "MISSION";
  const current = ["RETURN_HOME", "LANDING", "COMPLETED"].includes(phase)
    ? total
    : Math.max(0, Math.min(total, Math.trunc(Number(waypointIndex ?? 0))));
  return {
    current,
    total,
    percent: Math.round((current / total) * 100),
    phase,
  };
};
export const missionProgressLabel = (
  waypointIndex?: number,
  waypointCount?: number,
  flightPhase?: MissionProgress["phase"],
) => {
  const progress = missionProgress(waypointIndex, waypointCount, flightPhase);
  if (!progress) return waypointIndex == null ? "—" : waypointIndex === 0 ? "HOME" : `WP ${waypointIndex}`;
  if (progress.phase === "RETURN_HOME" || progress.phase === "LANDING")
    return `RETURN HOME · ${progress.percent}%`;
  if (progress.phase === "COMPLETED") return `COMPLETE · ${progress.percent}%`;
  const waypoint = progress.current === 0 ? "HOME" : `WP ${progress.current}`;
  return `${waypoint} · ${progress.percent}%`;
};
export const formatDuration = (seconds = 0) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    // Spreadsheet applications may execute formulas when a cell starts with
    // one of these characters. Prefix only string input so negative numeric
    // telemetry values remain numeric in the exported file.
    const safe =
      typeof value === "string" && /^[=+\-@\t\r]/.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    headers.map(cell).join(","),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(",")),
  ].join("\r\n");
}
export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
) {
  const blob = new Blob(["\ufeff", toCsv(rows)], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(filename, blob);
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
