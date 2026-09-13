import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Battery,
  CalendarDays,
  Download,
  PlayCircle,
  Radio,
  Route,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  AlertRow,
  Empty,
  Metric,
  PageTitle,
  Panel,
  StatusBadge,
} from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, formatDuration, socket } from "../lib";
import { FlightMap } from "../map-display";
import {
  routePatternLabel,
  type Alert,
  type Command,
  type Drone,
  type Flight,
  type Geofence,
  type Telemetry,
} from "../types";

export function HistoryList() {
  const { notify } = useFeedback();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    status: "ALL",
    droneId: "",
    dateFrom: "",
    dateTo: "",
  });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pages: 0, total: 0 });
  const [exporting, setExporting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const droneRequestRef = useRef<AbortController | null>(null);

  const loadDrones = async () => {
    droneRequestRef.current?.abort();
    const controller = new AbortController();
    droneRequestRef.current = controller;
    try {
      const response = await api.get("/drones", { signal: controller.signal });
      if (!controller.signal.aborted) setDrones(response.data.data);
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
        setError(errorMessage(reason));
    } finally {
      if (droneRequestRef.current === controller)
        droneRequestRef.current = null;
    }
  };

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/flights", {
        params: {
          ...filters,
          page,
          limit: 25,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setFlights(response.data.data);
      setMeta(response.data.meta);
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") {
        setFlights([]);
        setMeta({ page, pages: 0, total: 0 });
        setError(errorMessage(reason));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadDrones();
    return () => droneRequestRef.current?.abort();
  }, []);
  useEffect(() => {
    setPage(1);
  }, [filters.status, filters.droneId, filters.dateFrom, filters.dateTo]);
  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [filters.status, filters.droneId, filters.dateFrom, filters.dateTo, page]);
  useEffect(() => {
    const refresh = () => {
      void load();
    };
    const refreshFleet = () => {
      void loadDrones();
      void load();
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("flight:status", refresh);
    socket.on("drone:updated", refreshFleet);
    socket.on("fleet:updated", refreshFleet);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("flight:status", refresh);
      socket.off("drone:updated", refreshFleet);
      socket.off("fleet:updated", refreshFleet);
      socket.off("connect", refresh);
    };
  }, [filters.status, filters.droneId, filters.dateFrom, filters.dateTo, page]);

  const exportAll = async () => {
    if (!meta.total || loading || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/flights/export", {
        params: {
          status: filters.status,
          droneId: filters.droneId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        responseType: "blob",
      });
      downloadBlob(
        `flight-history-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} flight records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Flight export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="DATA"
        title="Flight history"
        text={`${meta.total} operations match the current filters.`}
        action={
          <button
            className="secondary"
            onClick={() => void exportAll()}
            disabled={!meta.total || loading || exporting}
          >
            <Download />
            {exporting ? "Exporting..." : "Export all matching"}
          </button>
        }
      />
      <>{error && <div className="form-error page-error">{error}</div>}</>
      <Panel>
        <div className="toolbar history-filters">
          <div className="history-label">
            <CalendarDays />
            Recorded flights
          </div>
          <select
            aria-label="Flight status"
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
          >
            <option>ALL</option>
            <option>ACTIVE</option>
            <option>COMPLETED</option>
            <option>FAILED</option>
          </select>
          <select
            aria-label="Flight aircraft"
            value={filters.droneId}
            onChange={(event) =>
              setFilters({ ...filters, droneId: event.target.value })
            }
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
              type="date"
              aria-label="Flight date from"
              max={filters.dateTo || undefined}
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters({ ...filters, dateFrom: event.target.value })
              }
            />
          </label>
          <label>
            TO
            <input
              type="date"
              aria-label="Flight date to"
              min={filters.dateFrom}
              value={filters.dateTo}
              onChange={(event) =>
                setFilters({ ...filters, dateTo: event.target.value })
              }
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Flight</th>
                <th>Drone</th>
                <th>Route</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Battery</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((flight) => (
                <tr key={flight._id}>
                  <td>
                    <Link className="row-link" to={`/history/${flight._id}`}>
                      {flight.flightCode}
                    </Link>
                  </td>
                  <td>
                    {typeof flight.droneId === "string"
                      ? "—"
                      : flight.droneId.droneCode}
                  </td>
                  <td>
                    <span className="role">
                      {routePatternLabel(flight.routePattern)}
                    </span>
                  </td>
                  <td>{new Date(flight.startedAt).toLocaleString()}</td>
                  <td>{formatDuration(flight.durationSeconds)}</td>
                  <td>{Math.round(flight.distanceMeters)} m</td>
                  <td>
                    {Math.round(flight.batteryStart)}% →{" "}
                    {flight.batteryEnd == null
                      ? "—"
                      : `${Math.round(flight.batteryEnd)}%`}
                  </td>
                  <td>
                    <StatusBadge status={flight.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? (
            <div className="loading">Loading flight records...</div>
          ) : (
            !flights.length && (
              <Empty
                title="No flights found"
                text="Adjust the filters or start a simulation."
              />
            )
          )}
        </div>
        <div className="pagination">
          <button
            className="secondary small"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {meta.page} of {Math.max(meta.pages, 1)}
          </span>
          <button
            className="secondary small"
            disabled={page >= meta.pages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
    </>
  );
}

export function HistoryDetail() {
  const { id } = useParams();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [points, setPoints] = useState<Telemetry[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setFlight(null);
    setError("");
    setLoading(true);
    Promise.all([
      api.get(`/flights/${id}`, { signal: controller.signal }),
      api.get(`/flights/${id}/telemetry`, {
        params: { limit: 5000 },
        signal: controller.signal,
      }),
    ])
      .then(([flightResponse, telemetryResponse]) => {
        if (controller.signal.aborted) return;
        setFlight(flightResponse.data.data.flight);
        setAlerts(flightResponse.data.data.alerts);
        setCommands(flightResponse.data.data.commands ?? []);
        setPoints(telemetryResponse.data.data);
      })
      .catch((reason: any) => {
        if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
          setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  if (error && !flight)
    return (
      <>
        <Link to="/history" className="back-link">
          <ArrowLeft />
          Flight history
        </Link>
        <div className="form-error page-error">{error}</div>
      </>
    );
  if (!flight)
    return (
      <div className="loading">
        {loading ? "Loading flight record..." : "Flight record unavailable"}
      </div>
    );
  const mission =
    flight.missionId && typeof flight.missionId === "object"
      ? flight.missionId
      : undefined;
  const geofence =
    mission?.geofenceId && typeof mission.geofenceId === "object"
      ? (mission.geofenceId as Geofence)
      : undefined;
  return (
    <>
      <Link to="/history" className="back-link">
        <ArrowLeft />
        Flight history
      </Link>
      <PageTitle
        eyebrow="FLIGHT RECORD"
        title={flight.flightCode}
        text={`${new Date(flight.startedAt).toLocaleString()} · ${flight.scenario.replaceAll("_", " ")} · ${routePatternLabel(flight.routePattern)}`}
        action={
          <div className="action-row">
            <StatusBadge status={flight.status} />
            <Link className="primary" to={`/history/${id}/replay`}>
              <PlayCircle />
              Replay
            </Link>
          </div>
        }
      />
      <div className="metric-grid six">
        <Metric
          label="DURATION"
          value={formatDuration(flight.durationSeconds)}
        />
        <Metric
          label="DISTANCE"
          value={Math.round(flight.distanceMeters)}
          unit="m"
          icon={<Route />}
        />
        <Metric
          label="MAX ALTITUDE"
          value={Math.round(flight.maxAltitude)}
          unit="m"
        />
        <Metric
          label="MAX SPEED"
          value={flight.maxSpeed.toFixed(1)}
          unit="m/s"
        />
        <Metric
          label="BATTERY USED"
          value={
            flight.batteryEnd == null || flight.batteryStart == null
              ? "—"
              : Math.max(0, flight.batteryStart - flight.batteryEnd).toFixed(1)
          }
          unit={
            flight.batteryEnd == null || flight.batteryStart == null ? "" : "%"
          }
          icon={<Battery />}
        />
        <Metric
          label="TELEMETRY PACKETS"
          value={points.length}
          icon={<Radio />}
        />
      </div>
      <div className="two-one-grid">
        <Panel title="Recorded route">
          <FlightMap
            points={points}
            home={flight.homePosition}
            geofences={geofence ? [geofence] : []}
            height={430}
          />
        </Panel>
        <Panel title="Flight alerts">
          <div className="alerts-list">
            {alerts.map((alert) => (
              <AlertRow
                key={alert._id}
                severity={alert.severity}
                message={alert.message}
                time={alert.occurredAt}
              />
            ))}
            {!alerts.length && (
              <Empty
                title="No alerts"
                text="No abnormal condition was recorded."
              />
            )}
          </div>
        </Panel>
      </div>
      <Panel title="Flight commands">
        <div className="command-feed">
          {commands.map((command) => (
            <div key={command._id}>
              <span>
                <b>{command.type.replaceAll("_", " ")}</b>
                <small>
                  {command.source} · {new Date(command.requestedAt).toLocaleString()}
                  {command.retryOf && ` · Retry of …${command.retryOf.slice(-6)}`}
                </small>
                {command.failureReason && (
                  <small className="danger-text">{command.failureReason}</small>
                )}
              </span>
              <StatusBadge status={command.status} />
            </div>
          ))}
          {!commands.length && (
            <Empty
              title="No commands"
              text="No operator or automatic command was recorded for this flight."
            />
          )}
        </div>
      </Panel>
    </>
  );
}
