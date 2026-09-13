import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCheck,
  Download,
  Filter,
  MapPinned,
  ShieldCheck,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import type { Alert, AlertActor, Drone } from "../types";

const alertTypes = [
  "BATTERY_LOW",
  "GPS_WEAK",
  "SIGNAL_LOW",
  "SIGNAL_LOSS",
  "WIND_DRIFT",
  "GPS_DRIFT",
  "EMERGENCY_LANDING",
  "GEOFENCE_BREACH",
  "COMMAND_FAILED",
];
const actorName = (actor?: AlertActor) =>
  !actor ? "System" : typeof actor === "string" ? actor : actor.name;
const droneIdOf = (drone: Alert["droneId"]) =>
  typeof drone === "string" ? drone : drone._id;

export default function Alerts() {
  const { user } = useAuth();
  const { notify } = useFeedback();
  const [items, setItems] = useState<Alert[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [actionBusy, setActionBusy] = useState<string>();
  const requestRef = useRef<AbortController | null>(null);
  const [filters, setFilters] = useState({
    status: "ALL",
    severity: "ALL",
    type: "ALL",
    droneId: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/alerts", {
        params: {
          ...filters,
          limit: 20,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems(response.data.data);
      setMeta(response.data.meta);
      setSelected(new Set());
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
        setError(errorMessage(reason));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    api
      .get("/drones", { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setDrones(response.data.data);
      })
      .catch((reason: any) => {
        if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
          setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [
    filters.status,
    filters.severity,
    filters.type,
    filters.droneId,
    filters.dateFrom,
    filters.dateTo,
    filters.page,
  ]);
  useEffect(() => {
    const refresh = () => {
      void load();
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("alert:created", refresh);
    socket.on("alert:updated", refresh);
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("alert:created", refresh);
      socket.off("alert:updated", refresh);
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
    };
  }, [
    filters.status,
    filters.severity,
    filters.type,
    filters.droneId,
    filters.dateFrom,
    filters.dateTo,
    filters.page,
  ]);

  const set = (key: string, value: string) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const selectable = items.filter((alert) => alert.status === "ACTIVE");
  const allSelected =
    selectable.length > 0 &&
    selectable.every((alert) => selected.has(alert._id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected(
      allSelected ? new Set() : new Set(selectable.map((alert) => alert._id)),
    );

  const acknowledge = async (alertId: string) => {
    if (actionBusy) return;
    setActionBusy(alertId);
    setError("");
    try {
      await api.patch(`/alerts/${alertId}/acknowledge`, {});
      notify("Alert acknowledged", "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setActionBusy(undefined);
    }
  };
  const acknowledgeSelected = async () => {
    if (!selected.size || actionBusy) return;
    setActionBusy("bulk");
    setError("");
    try {
      const response = await api.post("/alerts/bulk-acknowledge", {
        alertIds: [...selected],
      });
      notify(
        `${response.data.data.acknowledged} alerts acknowledged`,
        "success",
      );
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setActionBusy(undefined);
    }
  };
  const resolve = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolving || actionBusy) return;
    setActionBusy(resolving._id);
    setError("");
    try {
      await api.patch(`/alerts/${resolving._id}/resolve`, {
        note: resolutionNote,
      });
      notify("Alert resolved", "success");
      setResolving(null);
      setResolutionNote("");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setActionBusy(undefined);
    }
  };
  const exportAll = async () => {
    if (!meta.total || loading || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/alerts/export", {
        params: {
          status: filters.status,
          severity: filters.severity,
          type: filters.type,
          droneId: filters.droneId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        responseType: "blob",
      });
      downloadBlob(
        `alerts-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} alert records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Alert export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="SAFETY"
        title="Alert center"
        text={`${meta.total} safety events with accountable acknowledgement and resolution tracking.`}
        action={
          <div className="action-row">
            {user?.role === "ADMIN" && (
              <button
                className="primary"
                onClick={acknowledgeSelected}
                disabled={!selected.size || !!actionBusy}
              >
                <CheckCheck />
                {actionBusy === "bulk"
                  ? "Acknowledging..."
                  : `Acknowledge selected (${selected.size})`}
              </button>
            )}
            <button
              className="secondary"
              onClick={() => void exportAll()}
              disabled={!meta.total || loading || exporting}
            >
              <Download />
              {exporting ? "Exporting..." : "Export all matching"}
            </button>
          </div>
        }
      />
      {error && <div className="form-error page-error">{error}</div>}
      <Panel>
        <div className="toolbar alert-filters">
          <Filter />
          <select
            aria-label="Alert status"
            value={filters.status}
            onChange={(event) => set("status", event.target.value)}
          >
            <option>ALL</option>
            <option>ACTIVE</option>
            <option>ACKNOWLEDGED</option>
            <option>RESOLVED</option>
          </select>
          <select
            aria-label="Alert severity"
            value={filters.severity}
            onChange={(event) => set("severity", event.target.value)}
          >
            <option>ALL</option>
            <option>WARNING</option>
            <option>CRITICAL</option>
          </select>
          <select
            aria-label="Alert type"
            value={filters.type}
            onChange={(event) => set("type", event.target.value)}
          >
            <option>ALL</option>
            {alertTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <select
            aria-label="Alert aircraft"
            value={filters.droneId}
            onChange={(event) => set("droneId", event.target.value)}
          >
            <option value="">All aircraft</option>
            {drones.map((drone) => (
              <option key={drone._id} value={drone._id}>
                {drone.droneCode}
              </option>
            ))}
          </select>
          <label>
            FROM
            <input
              aria-label="Alert date from"
              type="date"
              max={filters.dateTo || undefined}
              value={filters.dateFrom}
              onChange={(event) => set("dateFrom", event.target.value)}
            />
          </label>
          <label>
            TO
            <input
              aria-label="Alert date to"
              type="date"
              min={filters.dateFrom || undefined}
              value={filters.dateTo}
              onChange={(event) => set("dateTo", event.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="select-cell">
                  {user?.role === "ADMIN" && (
                    <input
                      aria-label="Select active alerts on page"
                      type="checkbox"
                      checked={allSelected}
                      onChange={togglePage}
                      disabled={!selectable.length || !!actionBusy}
                    />
                  )}
                </th>
                <th>Occurred</th>
                <th>Aircraft</th>
                <th>Event</th>
                <th>Severity</th>
                <th>Workflow</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((alert) => {
                const rowBusy = actionBusy === alert._id;
                const droneId = droneIdOf(alert.droneId);
                return (
                  <tr key={alert._id}>
                    <td className="select-cell">
                      {user?.role === "ADMIN" && alert.status === "ACTIVE" && (
                        <input
                          aria-label={`Select ${alert.type}`}
                          type="checkbox"
                          checked={selected.has(alert._id)}
                          onChange={() => toggle(alert._id)}
                          disabled={!!actionBusy}
                        />
                      )}
                    </td>
                    <td>{new Date(alert.occurredAt).toLocaleString()}</td>
                    <td>
                      <div>
                        <b>
                          {typeof alert.droneId === "string"
                            ? "Unknown aircraft"
                            : alert.droneId.droneCode}
                        </b>
                        {typeof alert.droneId !== "string" && (
                          <small className="table-sub">
                            <Link
                              className="text-link"
                              to={`/drones/${droneId}`}
                            >
                              View drone
                            </Link>
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <Link
                        className="row-link"
                        to={`/history/${alert.flightId}`}
                        title="Open recorded flight map"
                      >
                        {alert.type.replaceAll("_", " ")}
                      </Link>
                      <small className="table-sub">{alert.message}</small>
                      <small className="table-sub">
                        <Link
                          className="text-link"
                          to={`/history/${alert.flightId}`}
                        >
                          <MapPinned />
                          View map
                        </Link>
                      </small>
                    </td>
                    <td>
                      <StatusBadge status={alert.severity} />
                    </td>
                    <td>
                      <StatusBadge status={alert.status} />
                      {alert.acknowledgedAt && (
                        <small className="table-sub">
                          Ack by {actorName(alert.acknowledgedBy)} ·{" "}
                          {new Date(alert.acknowledgedAt).toLocaleString()}
                        </small>
                      )}
                      {alert.resolvedAt && (
                        <small className="table-sub">
                          Resolved by {actorName(alert.resolvedBy)} ·{" "}
                          {new Date(alert.resolvedAt).toLocaleString()}
                        </small>
                      )}
                      {alert.resolutionNote && (
                        <small className="table-sub resolution-note">
                          {alert.resolutionNote}
                        </small>
                      )}
                    </td>
                    <td>
                      {user?.role === "ADMIN" && (
                        <div className="row-actions alert-actions">
                          {alert.status === "ACTIVE" && (
                            <button
                              className="secondary small"
                              disabled={!!actionBusy}
                              onClick={() => acknowledge(alert._id)}
                            >
                              <CheckCheck />
                              {rowBusy ? "Acknowledging..." : "Acknowledge"}
                            </button>
                          )}
                          {alert.status !== "RESOLVED" && (
                            <button
                              className="secondary small"
                              disabled={!!actionBusy}
                              onClick={() => {
                                setResolving(alert);
                                setResolutionNote("");
                              }}
                            >
                              <ShieldCheck />
                              Resolve
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading ? (
            <div className="loading">Loading alerts...</div>
          ) : (
            !items.length && (
              <Empty
                title="No matching alerts"
                text="Try broadening the current filters."
              />
            )
          )}
        </div>
        <div className="pagination">
          <button
            className="secondary small"
            disabled={meta.page <= 1 || loading || !!actionBusy}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            Previous
          </button>
          <span>
            Page {meta.page} of {Math.max(meta.pages, 1)}
          </span>
          <button
            className="secondary small"
            disabled={meta.page >= meta.pages || loading || !!actionBusy}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            Next
          </button>
        </div>
      </Panel>
      {resolving && (
        <div className="modal-layer">
          <form className="modal" onSubmit={resolve}>
            <header>
              <div>
                <p className="eyebrow">INCIDENT CLOSURE</p>
                <h2>Resolve alert</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                disabled={!!actionBusy}
                aria-label="Close resolve alert form"
                onClick={() => setResolving(null)}
              >
                <X />
              </button>
            </header>
            {error && <div className="form-error">{error}</div>}
            <div className="resolve-form">
              <StatusBadge status={resolving.severity} />
              <b>{resolving.type.replaceAll("_", " ")}</b>
              <p>{resolving.message}</p>
              <label>
                Resolution note
                <textarea
                  value={resolutionNote}
                  minLength={3}
                  maxLength={1000}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Describe the check performed or corrective action taken"
                  required
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary"
                disabled={!!actionBusy}
                onClick={() => setResolving(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={!!actionBusy}>
                <ShieldCheck />
                {actionBusy === resolving._id
                  ? "Resolving..."
                  : "Resolve incident"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
