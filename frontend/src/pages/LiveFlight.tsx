import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Battery,
  Boxes,
  CheckCircle2,
  CircleX,
  CirclePause,
  CirclePlay,
  Gauge,
  House,
  LandPlot,
  MapPin,
  Navigation,
  Play,
  Radio,
  Satellite,
  Sparkles,
  Square,
  X,
  UsersRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../auth";
import {
  AlertRow,
  Empty,
  Metric,
  PageTitle,
  Panel,
  StatusBadge,
} from "../components";
import { useFeedback } from "../feedback";
import { FleetMap, FlightMap } from "../map-display";
import {
  api,
  applyAlertUpdate,
  errorMessage,
  formatDuration,
  isCanceledRequest,
  missionProgress,
  missionProgressLabel,
  socket,
  telemetryAgeMs,
  telemetryState,
} from "../lib";
import {
  ROUTE_PATTERNS,
  ROUTE_PATTERN_META,
  routePatternLabel,
  type Alert,
  type AnomalyType,
  type Drone,
  type DroneReadiness,
  type Flight,
  type Geofence,
  type RoutePattern,
  type Telemetry,
} from "../types";

const patterns = ROUTE_PATTERNS;
const anomalyOptions: Array<{ type: AnomalyType; label: string }> = [
  { type: "LOW_BATTERY", label: "Battery drain" },
  { type: "GPS_WEAK", label: "Weak GPS" },
  { type: "SIGNAL_LOSS", label: "Signal loss" },
  { type: "WIND_DRIFT", label: "Wind drift" },
  { type: "GPS_DRIFT", label: "GPS drift" },
  { type: "EMERGENCY_LANDING", label: "Emergency land" },
];
const mergeTelemetry = (history: Telemetry[], live: Telemetry[]) => {
  const bySequence = new Map<number, Telemetry>();
  [...history, ...live].forEach((point) =>
    bySequence.set(point.sequence, point),
  );
  return [...bySequence.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-120);
};
const flightDroneId = (flight: Flight) =>
  typeof flight.droneId === "string" ? flight.droneId : flight.droneId._id;
type FleetCommandResult = {
  type: FleetCommandType;
  requested: number;
  completed: number;
  failed: number;
  failures: Array<{ flightId: string; message: string }>;
};
type FleetCommandType = "PAUSE" | "RESUME" | "RETURN_HOME" | "LAND";
const fleetCommandLabel: Record<FleetCommandType, string> = {
  PAUSE: "pause",
  RESUME: "resume",
  RETURN_HOME: "return-home",
  LAND: "landing",
};

export default function LiveFlight() {
  const [tab, setTab] = useState<"single" | "fleet">("single");
  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS"
        title="Live flight"
        text="Real-time telemetry for one aircraft or the complete demo fleet."
      />
      <div className="mode-tabs">
        <button
          className={tab === "single" ? "active" : ""}
          onClick={() => setTab("single")}
        >
          <Radio />
          Single flight
        </button>
        <button
          className={tab === "fleet" ? "active" : ""}
          onClick={() => setTab("fleet")}
        >
          <UsersRound />
          Fleet view <span>10</span>
        </button>
      </div>
      {tab === "single" ? <SingleFlight /> : <FleetView />}
    </>
  );
}

function SingleFlight() {
  const { user } = useAuth();
  const { confirm } = useFeedback();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [droneId, setDroneId] = useState("");
  const [anomalies, setAnomalies] = useState<AnomalyType[]>([]);
  const [routePattern, setRoutePattern] = useState<RoutePattern>("RANDOM");
  const [flight, setFlight] = useState<Flight | null>(null);
  const [points, setPoints] = useState<Telemetry[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<DroneReadiness | null>(null);
  const activeFlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeFlightIdRef.current = flight?._id ?? null;
  }, [flight?._id]);

  useEffect(() => {
    const flightId = flight?._id;
    if (!flightId) {
      setPoints([]);
      setAlerts([]);
      return;
    }
    setPoints((items) => items.filter((item) => item.flightId === flightId));
    setAlerts((items) => items.filter((item) => item.flightId === flightId));
  }, [flight?._id]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get("/drones", { signal: controller.signal }),
      api.get("/flights", {
        params: { status: "ACTIVE", limit: 20 },
        signal: controller.signal,
      }),
      api.get("/geofences", { signal: controller.signal }),
    ])
      .then(([d, f, g]) => {
        if (controller.signal.aborted) return;
        setDrones(d.data.data);
        setGeofences(
          (g.data.data as Geofence[]).filter((geofence) => geofence.isActive),
        );
        const active = f.data.data[0];
        if (active) {
          setFlight(active);
          const id =
            typeof active.droneId === "string"
              ? active.droneId
              : active.droneId._id;
          setDroneId(id);
          setRoutePattern(active.routePattern ?? "RANDOM");
          setAnomalies(active.anomalyTypes ?? []);
        } else if (d.data.data[0]) setDroneId(d.data.data[0]._id);
      })
      .catch((reason) => {
        if (!isCanceledRequest(reason)) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!droneId) return;
    socket.auth = { token: localStorage.getItem("drone-token") };
    let statusController: AbortController | undefined;
    let geofenceController: AbortController | undefined;
    const subscribe = () => socket.emit("subscribe:drone", droneId);
    const telemetry = (payload: Telemetry) => {
      if (
        payload.droneId === droneId &&
        activeFlightIdRef.current === payload.flightId
      )
        setPoints((items) =>
          mergeTelemetry(
            items.filter((item) => item.flightId === payload.flightId),
            [payload],
          ),
        );
    };
    const alert = (payload: Alert) => {
      if (
        (typeof payload.droneId === "string"
          ? payload.droneId
          : payload.droneId._id) === droneId &&
        activeFlightIdRef.current === payload.flightId
      )
        setAlerts((items) =>
          items.some((item) => item._id === payload._id)
            ? items
            : [payload, ...items],
        );
    };
    const alertUpdated = (
      payload: Partial<Alert> & { alertIds?: string[] },
    ) => {
      const ids = payload.alertIds ?? (payload._id ? [payload._id] : []);
      if (!ids.length) return;
      setAlerts((items) => applyAlertUpdate(items, payload));
    };
    const refreshActiveFlight = () => {
      statusController?.abort();
      const controller = new AbortController();
      statusController = controller;
      api
        .get("/flights", {
          params: { status: "ACTIVE", droneId, limit: 1 },
          signal: controller.signal,
        })
        .then((response) => {
          if (controller.signal.aborted) return;
          const active: Flight | undefined = response.data.data[0];
          activeFlightIdRef.current = active?._id ?? null;
          setFlight(active ?? null);
          if (active) {
            setRoutePattern(active.routePattern ?? "RANDOM");
            setAnomalies(active.anomalyTypes ?? []);
          }
        })
        .catch((reason: any) => {
          if (
            reason?.code !== "ERR_CANCELED" &&
            reason?.name !== "CanceledError"
          )
            setError(errorMessage(reason));
        })
        .finally(() => {
          if (statusController === controller) statusController = undefined;
        });
    };
    const refreshGeofences = () => {
      geofenceController?.abort();
      const controller = new AbortController();
      geofenceController = controller;
      api
        .get("/geofences", { signal: controller.signal })
        .then((response) => {
          if (!controller.signal.aborted)
            setGeofences(
              (response.data.data as Geofence[]).filter(
                (geofence) => geofence.isActive,
              ),
            );
        })
        .catch((reason) => {
          if (!isCanceledRequest(reason)) setError(errorMessage(reason));
        })
        .finally(() => {
          if (geofenceController === controller) geofenceController = undefined;
        });
    };
    const flightStatus = (payload: {
      flightId: string;
      droneId: string;
      status: string;
    }) => {
      if (String(payload.droneId) !== droneId) return;
      if (payload.status !== "ACTIVE") {
        if (activeFlightIdRef.current === payload.flightId)
          activeFlightIdRef.current = null;
        setFlight((current) =>
          current?._id === payload.flightId ? null : current,
        );
        return;
      }
      refreshActiveFlight();
    };
    const connected = () => {
      subscribe();
      refreshActiveFlight();
      refreshGeofences();
    };
    socket.on("telemetry:update", telemetry);
    socket.on("alert:created", alert);
    socket.on("alert:updated", alertUpdated);
    socket.on("flight:status", flightStatus);
    socket.on("geofence:updated", refreshGeofences);
    socket.on("connect", connected);
    if (!socket.connected) socket.connect();
    else connected();
    return () => {
      statusController?.abort();
      geofenceController?.abort();
      activeFlightIdRef.current = null;
      socket.off("connect", connected);
      socket.off("telemetry:update", telemetry);
      socket.off("alert:created", alert);
      socket.off("alert:updated", alertUpdated);
      socket.off("flight:status", flightStatus);
      socket.off("geofence:updated", refreshGeofences);
      socket.emit("unsubscribe:drone", droneId);
    };
  }, [droneId]);
  useEffect(() => {
    if (!flight) return;
    const controller = new AbortController();
    Promise.all([
      api.get(`/flights/${flight._id}/telemetry`, {
        params: { limit: 120 },
        signal: controller.signal,
      }),
      api.get("/alerts", {
        params: { status: "ACTIVE" },
        signal: controller.signal,
      }),
    ])
      .then(([t, a]) => {
        if (controller.signal.aborted) return;
        setPoints((current) => mergeTelemetry(t.data.data, current));
        setAlerts((current) => {
          const active = a.data.data.filter(
            (item: Alert) =>
              item.flightId === flight._id &&
              String(
                typeof item.droneId === "string"
                  ? item.droneId
                  : item.droneId._id,
              ) === droneId,
          );
          const byId = new Map<string, Alert>();
          active.forEach((item: Alert) => byId.set(item._id, item));
          current.forEach((item) => byId.set(item._id, item));
          return [...byId.values()].sort(
            (x, y) => +new Date(y.occurredAt) - +new Date(x.occurredAt),
          );
        });
      })
      .catch((reason) => {
        if (!isCanceledRequest(reason)) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [flight?._id, droneId]);
  useEffect(() => {
    if (!droneId || flight) {
      setReadiness(null);
      return;
    }
    const controller = new AbortController();
    api
      .get(`/drones/${droneId}/readiness`, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setReadiness(response.data.data);
      })
      .catch((reason) => {
        if (!isCanceledRequest(reason)) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [droneId, flight?._id]);

  const latest = points.at(-1);
  const duration = flight
    ? Math.max(
        flight.durationSeconds,
        Math.round((Date.now() - new Date(flight.startedAt).getTime()) / 1000),
      )
    : 0;
  const chart = useMemo(
    () =>
      points.map((point) => ({
        seq: point.sequence,
        altitude: point.altitude,
        speed: point.speed,
      })),
    [points],
  );
  const start = async () => {
    if (!droneId) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post("/flights/simulate", {
        droneId,
        scenario: "NORMAL",
        anomalies,
        routePattern,
      });
      const nextFlight = response.data.data as Flight;
      activeFlightIdRef.current = nextFlight._id;
      setFlight(nextFlight);
      setPoints([]);
      setAlerts([]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const toggleAnomaly = (type: AnomalyType) =>
    setAnomalies((items) =>
      items.includes(type)
        ? items.filter((item) => item !== type)
        : items.length < 3
          ? [...items, type]
          : items,
    );
  const stop = async () => {
    if (!flight || busy) return;
    setBusy(true);
    try {
      if (
        !(await confirm({
          title: "Stop simulation",
          message: "The active flight will be ended and saved to history.",
          confirmLabel: "Stop flight",
          danger: true,
        }))
      )
        return;
      await api.post(`/flights/${flight._id}/stop`);
      activeFlightIdRef.current = null;
      setFlight(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel className="control-bar">
        <div className="control-fields">
          <label>
            Aircraft
            <select
              value={droneId}
              onChange={(event) => setDroneId(event.target.value)}
              disabled={!!flight}
            >
              {drones.map((drone) => (
                <option value={drone._id} key={drone._id}>
                  {drone.droneCode} · {drone.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Route pattern
            <select
              value={routePattern}
              onChange={(event) =>
                setRoutePattern(event.target.value as RoutePattern)
              }
              disabled={!!flight}
            >
              {patterns.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {ROUTE_PATTERN_META[pattern].label}
                </option>
              ))}
            </select>
            <small className="route-help">
              {ROUTE_PATTERN_META[routePattern].description}
            </small>
          </label>
          <div className="anomaly-field">
            <span>
              Anomalies <small>{anomalies.length}/3</small>
            </span>
            <div>
              {anomalyOptions.map((option) => (
                <button
                  key={option.type}
                  className={anomalies.includes(option.type) ? "active" : ""}
                  disabled={
                    !!flight ||
                    (!anomalies.includes(option.type) && anomalies.length >= 3)
                  }
                  onClick={() => toggleAnomaly(option.type)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {user?.role === "ADMIN" &&
          (flight ? (
            <button className="stop" onClick={stop} disabled={busy}>
              <Square />
              Stop simulation
            </button>
          ) : (
            <button
              className="primary"
              onClick={start}
              disabled={busy || !droneId || !readiness?.ready}
            >
              <Play />
              Start simulation
            </button>
          ))}
      </Panel>
      {error && <div className="form-error page-error">{error}</div>}
      {!flight && readiness && <ReadinessPanel readiness={readiness} />}
      <div className="metric-grid six">
        <Metric
          label="BATTERY"
          value={latest?.battery ?? "—"}
          unit={latest ? "%" : ""}
          icon={<Battery />}
        />
        <Metric
          label="ALTITUDE"
          value={latest?.altitude ?? "—"}
          unit={latest ? "m" : ""}
          icon={<Navigation />}
        />
        <Metric
          label="SPEED"
          value={latest?.speed ?? "—"}
          unit={latest ? "m/s" : ""}
          icon={<Gauge />}
        />
        <Metric
          label="GPS"
          value={latest?.gpsSatellites ?? "—"}
          unit={latest ? "sats" : ""}
          icon={<Satellite />}
        />
        <Metric
          label="SIGNAL"
          value={latest?.signal ?? "—"}
          unit={latest ? "%" : ""}
          icon={<Radio />}
        />
        <Metric
          label="FLIGHT TIME"
          value={formatDuration(duration)}
          icon={<MapPin />}
        />
      </div>
      <div className="live-grid">
        <Panel
          title="Live position"
          action={
            <span className="map-live">
              <i />
              {flight ? "LIVE" : "STANDBY"}
            </span>
          }
        >
          <FlightMap
            points={points}
            home={flight?.homePosition}
            geofences={geofences}
            height={430}
          />
        </Panel>
        <Panel title="Flight information">
          <div className="flight-info">
            <div>
              <span>Flight ID</span>
              <b>{flight?.flightCode ?? "Not active"}</b>
            </div>
            <div>
              <span>Route</span>
              <b>{routePatternLabel(flight?.routePattern ?? routePattern)}</b>
            </div>
            <div>
              <span>Mode</span>
              <b>{latest?.flightMode ?? "—"}</b>
            </div>
            <div>
              <span>Mission progress</span>
              <b>
                {missionProgressLabel(
                  latest?.waypointIndex,
                  latest?.waypointCount,
                  latest?.flightPhase,
                )}
              </b>
            </div>
            <div>
              <span>Heading</span>
              <b>{latest ? `${Math.round(latest.heading ?? 0)}°` : "—"}</b>
            </div>
            <div>
              <span>Telemetry packets</span>
              <b>{latest?.sequence ?? 0}</b>
            </div>
          </div>
          <h3 className="subheading">Active alerts</h3>
          <div className="alerts-list compact">
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
                title="No active alerts"
                text="Flight conditions are within limits."
              />
            )}
          </div>
        </Panel>
      </div>
      <Panel title="Telemetry trend">
        <TelemetryChart data={chart} />
      </Panel>
    </>
  );
}

function FleetView() {
  const { user } = useAuth();
  const { confirm, notify } = useFeedback();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [assignments, setAssignments] = useState<Record<string, RoutePattern>>(
    {},
  );
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pointsByDrone, setPointsByDrone] = useState<
    Record<string, Telemetry[]>
  >({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedDroneId, setSelectedDroneId] = useState<string>();
  const [selectedFlightIds, setSelectedFlightIds] = useState<string[]>([]);
  const [commandResult, setCommandResult] = useState<FleetCommandResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [readiness, setReadiness] = useState<Record<string, DroneReadiness>>(
    {},
  );
  const [now, setNow] = useState(() => Date.now());
  const requestRef = useRef<AbortController | null>(null);
  const demoDroneIdsRef = useRef<Set<string>>(new Set());
  const activeFlightIdsRef = useRef<Map<string, string>>(new Map());
  const commandSelectionInitializedRef = useRef(false);

  const applyDrones = (items: Drone[]) => {
    const demo = items.slice(0, 10);
    demoDroneIdsRef.current = new Set(demo.map((drone) => drone._id));
    setDrones(demo);
    setSelectedDroneId((current) =>
      current && demo.some((drone) => drone._id === current)
        ? current
        : demo[0]?._id,
    );
    setAssignments((current) =>
      Object.fromEntries(
        demo.map((drone, index) => [
          drone._id,
          current[drone._id] ?? patterns[index % patterns.length],
        ]),
      ),
    );
  };
  const syncCommandSelection = (nextFlights: Flight[]) => {
    const nextIds = nextFlights.map((flight) => flight._id);
    setSelectedFlightIds((current) => {
      if (!nextIds.length) {
        commandSelectionInitializedRef.current = false;
        return [];
      }
      if (!commandSelectionInitializedRef.current) {
        commandSelectionInitializedRef.current = true;
        return nextIds;
      }
      const activeIds = new Set(nextIds);
      return current.filter((flightId) => activeIds.has(flightId));
    });
  };
  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const signal = controller.signal;
    setLoading(true);
    setError("");
    try {
      const [
        droneResponse,
        flightResponse,
        alertResponse,
        readinessResponse,
        geofenceResponse,
        telemetryResponse,
      ] =
        await Promise.all([
          api.get("/drones", { params: { demo: true }, signal }),
          api.get("/flights", {
            params: { status: "ACTIVE", limit: 20 },
            signal,
          }),
          api.get("/alerts", { params: { status: "ACTIVE" }, signal }),
          api.get("/drones/readiness", { params: { demo: true }, signal }),
          api.get("/geofences", { signal }),
          api.get("/flights/active/telemetry", {
            params: { limit: 120 },
            signal,
          }),
        ]);
      if (signal.aborted) return;
      setGeofences(
        (geofenceResponse.data.data as Geofence[]).filter(
          (geofence) => geofence.isActive,
        ),
      );
      const demo: Drone[] = droneResponse.data.data.slice(0, 10);
      applyDrones(demo);
      const demoIds = new Set(demo.map((drone) => drone._id));
      const active: Flight[] = flightResponse.data.data.filter(
        (flight: Flight) =>
          demoIds.has(
            typeof flight.droneId === "string"
              ? flight.droneId
              : flight.droneId._id,
          ),
      );
      activeFlightIdsRef.current = new Map(
        active.map((flight) => [
          typeof flight.droneId === "string"
            ? flight.droneId
            : flight.droneId._id,
          flight._id,
        ]),
      );
      setFlights(active);
      syncCommandSelection(active);
      setAlerts(
        alertResponse.data.data.filter((alert: Alert) =>
          demoIds.has(
            typeof alert.droneId === "string"
              ? alert.droneId
              : alert.droneId._id,
          ),
        ),
      );
      setReadiness(
        Object.fromEntries(
          (readinessResponse.data.data.items as DroneReadiness[]).map(
            (item) => [item.droneId, item],
          ),
        ),
      );
      if (active.length) {
        const histories = new Map<string, Telemetry[]>(
          (telemetryResponse.data.data as Array<{
            flightId: string;
            telemetry: Telemetry[];
          }>).map((item) => [item.flightId, item.telemetry]),
        );
        setPointsByDrone((current) => {
          const next = { ...current };
          const activeIds = new Set<string>();
          active.forEach((flight) => {
            const droneId =
              typeof flight.droneId === "string"
                ? flight.droneId
                : flight.droneId._id;
            activeIds.add(droneId);
            next[droneId] = mergeTelemetry(
              histories.get(String(flight._id)) ?? [],
              (current[droneId] ?? []).filter(
                (point) => point.flightId === String(flight._id),
              ),
            );
          });
          Object.keys(next).forEach((droneId) => {
            if (!activeIds.has(droneId)) delete next[droneId];
          });
          return next;
        });
      } else setPointsByDrone({});
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!signal.aborted) setLoading(false);
      }
    }
  };
  useEffect(() => {
    load().catch((reason) => {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
        setError(errorMessage(reason));
    });
    return () => requestRef.current?.abort();
  }, []);
  useEffect(() => {
    socket.auth = { token: localStorage.getItem("drone-token") };
    const subscribe = () => socket.emit("subscribe:fleet");
    socket.connect();
    subscribe();
    socket.on("connect", subscribe);
    const telemetry = (payload: Telemetry) => {
      if (activeFlightIdsRef.current.get(payload.droneId) !== payload.flightId)
        return;
      setPointsByDrone((current) => ({
        ...current,
        [payload.droneId]: mergeTelemetry(
          (current[payload.droneId] ?? []).filter(
            (point) => point.flightId === payload.flightId,
          ),
          [payload],
        ),
      }));
    };
    const alert = (payload: Alert) => {
      const droneId =
        typeof payload.droneId === "string"
          ? payload.droneId
          : payload.droneId._id;
      if (!demoDroneIdsRef.current.has(droneId)) return;
      setAlerts((current) =>
        current.some((item) => item._id === payload._id)
          ? current
          : [payload, ...current],
      );
    };
    const alertUpdated = (
      payload: Partial<Alert> & { alertIds?: string[] },
    ) => {
      const ids = payload.alertIds ?? (payload._id ? [payload._id] : []);
      if (!ids.length) return;
      setAlerts((current) => applyAlertUpdate(current, payload));
    };
    const status = () => {
      load().catch((reason) => {
        if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
          setError(errorMessage(reason));
      });
    };
    socket.on("telemetry:update", telemetry);
    socket.on("alert:created", alert);
    socket.on("alert:updated", alertUpdated);
    socket.on("flight:status", status);
    socket.on("drone:updated", status);
    socket.on("fleet:updated", status);
    socket.on("maintenance:updated", status);
    socket.on("geofence:updated", status);
    socket.on("connect", status);
    return () => {
      socket.off("connect", subscribe);
      socket.off("connect", status);
      socket.off("telemetry:update", telemetry);
      socket.off("alert:created", alert);
      socket.off("alert:updated", alertUpdated);
      socket.off("flight:status", status);
      socket.off("drone:updated", status);
      socket.off("fleet:updated", status);
      socket.off("maintenance:updated", status);
      socket.off("geofence:updated", status);
      socket.emit("unsubscribe:fleet");
    };
  }, []);
  useEffect(() => {
    if (!flights.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [flights.length]);

  const seed = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/drones/seed-demo");
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/drones/prepare-demo");
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await api.post("/flights/simulate-fleet", {
        assignments: drones.map((drone) => ({
          droneId: drone._id,
          routePattern: assignments[drone._id],
        })),
      });
      const nextFlights = response.data.data as Flight[];
      activeFlightIdsRef.current = new Map(
        nextFlights.map((flight) => [
          typeof flight.droneId === "string"
            ? flight.droneId
            : flight.droneId._id,
          flight._id,
        ]),
      );
      setFlights(nextFlights);
      commandSelectionInitializedRef.current = true;
      setSelectedFlightIds(nextFlights.map((flight) => flight._id));
      setCommandResult(undefined);
      setPointsByDrone({});
      setAlerts([]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        !(await confirm({
          title: "Stop fleet simulation",
          message: `${flights.length} active flights will be ended and saved to history.`,
          confirmLabel: "Stop fleet",
          danger: true,
        }))
      )
        return;
      await api.post("/flights/stop-fleet", {
        flightIds: flights.map((flight) => flight._id),
      });
      activeFlightIdsRef.current.clear();
      commandSelectionInitializedRef.current = false;
      setSelectedFlightIds([]);
      setCommandResult(undefined);
      setFlights([]);
      setPointsByDrone({});
      setAlerts([]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const activeCommandFlightIds = flights.map((flight) => flight._id);
  const allCommandTargetsSelected =
    activeCommandFlightIds.length > 0 &&
    selectedFlightIds.length === activeCommandFlightIds.length;
  const selectedCommandFlights = flights.filter((flight) =>
    selectedFlightIds.includes(flight._id),
  );
  const canPauseSelected = selectedCommandFlights.some((flight) =>
    ["TAKEOFF", "MISSION"].includes(flight.flightPhase ?? "MISSION"),
  );
  const canResumeSelected = selectedCommandFlights.some(
    (flight) => flight.flightPhase === "PAUSED",
  );
  const selectAllCommandTargets = () => {
    commandSelectionInitializedRef.current = true;
    setSelectedFlightIds(activeCommandFlightIds);
  };
  const clearCommandTargets = () => {
    commandSelectionInitializedRef.current = true;
    setSelectedFlightIds([]);
  };
  const toggleCommandTarget = (flightId: string) => {
    commandSelectionInitializedRef.current = true;
    setSelectedFlightIds((current) =>
      current.includes(flightId)
        ? current.filter((item) => item !== flightId)
        : [...current, flightId],
    );
  };
  const failedActiveFlightIds = (commandResult?.failures ?? [])
    .map((failure) => failure.flightId)
    .filter((flightId) => activeCommandFlightIds.includes(flightId));
  const selectFailedCommandTargets = () => {
    if (!failedActiveFlightIds.length) return;
    commandSelectionInitializedRef.current = true;
    setSelectedFlightIds(failedActiveFlightIds);
    notify(
      `${failedActiveFlightIds.length} failed aircraft selected for retry`,
      "info",
    );
  };
  const commandFleet = async (type: FleetCommandType) => {
    if (!flights.length || !selectedFlightIds.length || busy) return;
    const activeIds = new Set(activeCommandFlightIds);
    const targetIds = selectedFlightIds.filter((flightId) =>
      activeIds.has(flightId),
    );
    if (!targetIds.length) return;
    const allTargets = targetIds.length === activeCommandFlightIds.length;
    const copy = {
      PAUSE: {
        title: allTargets ? "Pause entire fleet" : "Pause selected aircraft",
        confirm: allTargets ? "Pause all" : "Pause selected",
        message: `${targetIds.length} aircraft will pause their current route.`,
      },
      RESUME: {
        title: allTargets
          ? "Resume entire fleet"
          : "Resume selected aircraft",
        confirm: allTargets ? "Resume all" : "Resume selected",
        message: `${targetIds.length} paused aircraft will resume their previous route.`,
      },
      RETURN_HOME: {
        title: allTargets
          ? "Return entire fleet home"
          : "Return selected aircraft home",
        confirm: allTargets ? "Return all home" : "Return selected",
        message: `${targetIds.length} aircraft will stop their current route and return home.`,
      },
      LAND: {
        title: allTargets ? "Land entire fleet" : "Land selected aircraft",
        confirm: allTargets ? "Land all" : "Land selected",
        message: `${targetIds.length} aircraft will land immediately and cancel their current missions.`,
      },
    }[type];
    setBusy(true);
    setError("");
    setCommandResult(undefined);
    try {
      if (
        !(await confirm({
          title: copy.title,
          message: copy.message,
          confirmLabel: copy.confirm,
          danger: type === "LAND",
        }))
      )
        return;
      const response = await api.post("/commands/fleet", {
        flightIds: targetIds,
        type,
      });
      const result = response.data.data as FleetCommandResult;
      setCommandResult({ ...result, type });
      if (result.failed)
        notify(
          `${result.completed}/${result.requested} fleet commands completed; ${result.failed} failed.`,
          "error",
        );
      else
        notify(
          `${fleetCommandLabel[type].replace("-", " ")} commands sent to the fleet`,
          "success",
        );
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const selectedDrone = drones.find((drone) => drone._id === selectedDroneId);
  const commandTargetLabel = (flightId: string) => {
    const flight = flights.find((item) => item._id === flightId);
    if (flight) {
      const drone = drones.find((item) => item._id === flightDroneId(flight));
      if (drone) return drone.droneCode;
    }
    return `Flight ${flightId.slice(-6)}`;
  };
  const selectedTelemetry = selectedDroneId
    ? pointsByDrone[selectedDroneId]?.at(-1)
    : undefined;
  const selectedFlight = flights.find(
    (flight) =>
      (typeof flight.droneId === "string"
        ? flight.droneId
        : flight.droneId._id) === selectedDroneId,
  );
  const selectedAlerts = alerts.filter(
    (alert) =>
      (typeof alert.droneId === "string"
        ? alert.droneId
        : alert.droneId._id) === selectedDroneId,
  );
  const readyCount = drones.filter(
    (drone) => readiness[drone._id]?.ready,
  ).length;
  const freshness = (point?: Telemetry) =>
    telemetryAgeMs(point?.timestamp, now);
  const latestTelemetryForFlight = (flight: Flight) =>
    pointsByDrone[flightDroneId(flight)]?.at(-1);
  const telemetryStatusForFlight = (flight: Flight) =>
    telemetryState(latestTelemetryForFlight(flight)?.timestamp, now);
  const waitingCount = flights.filter((flight) => {
    return telemetryStatusForFlight(flight) === "WAITING";
  }).length;
  const staleCount = flights.filter((flight) => {
    return telemetryStatusForFlight(flight) === "STALE";
  }).length;
  const liveCount = Math.max(0, flights.length - waitingCount - staleCount);
  const selectedStale = Boolean(
    selectedFlight &&
    selectedTelemetry &&
    telemetryState(selectedTelemetry.timestamp, now) === "STALE",
  );
  const streamTone = staleCount ? "stale" : waitingCount ? "waiting" : "";
  const streamLabel =
    staleCount || waitingCount
      ? [
          liveCount ? `${liveCount} LIVE` : "",
          waitingCount ? `${waitingCount} WAITING` : "",
          staleCount ? `${staleCount} STALE` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : `${flights.length} STREAMS LIVE`;
  const routeByDrone = Object.fromEntries(
    drones.map((drone) => {
      const flight = flights.find(
        (item) =>
          (typeof item.droneId === "string"
            ? item.droneId
            : item.droneId._id) === drone._id,
      );
      return [drone._id, flight?.routePattern ?? assignments[drone._id]];
    }),
  );
  const telemetryStatusByDrone = Object.fromEntries(
    drones.map((drone) => {
      const flight = flights.find(
        (item) => flightDroneId(item) === drone._id,
      );
      const latest = pointsByDrone[drone._id]?.at(-1);
      return [
        drone._id,
        flight ? telemetryState(latest?.timestamp, now) : "STANDBY",
      ];
    }),
  );

  if (loading && !drones.length)
    return (
      <Panel className="fleet-setup">
        <div className="fleet-setup-inner">
          <span>
            <Boxes />
          </span>
          <p className="eyebrow">DEMO FLEET</p>
          <h2>Loading fleet status</h2>
          <p>Checking the ten-aircraft demo fleet and preflight readiness.</p>
          <div className="loading">Loading aircraft...</div>
        </div>
      </Panel>
    );
  if (drones.length < 10)
    return (
      <>
        {error && <div className="form-error page-error">{error}</div>}
        <Panel className="fleet-setup">
          <div className="fleet-setup-inner">
            <span>
              <Boxes />
            </span>
            <p className="eyebrow">DEMO FLEET</p>
            <h2>Prepare 10 aircraft</h2>
            <p>
              Create the missing demo records without changing your existing
              drones or history.
            </p>
            {user?.role === "ADMIN" ? (
              <button className="primary" onClick={seed} disabled={busy}>
                <Sparkles />
                Prepare demo fleet
              </button>
            ) : (
              <small>An administrator must prepare the demo fleet.</small>
            )}
          </div>
        </Panel>
      </>
    );

  return (
    <>
      {error && <div className="form-error page-error">{error}</div>}
      <Panel className="fleet-toolbar">
        <div>
          <span className="fleet-count">
            <i />
            {flights.length || `${readyCount}/10`} AIRCRAFT
          </span>
          <strong>
            {flights.length
              ? "Fleet simulation active"
              : readyCount === 10
                ? "Fleet ready for launch"
                : "Fleet preparation required"}
          </strong>
          <small>
            {flights.length
              ? "Two aircraft carry randomly assigned warning scenarios."
              : readyCount === 10
                ? `${patterns.length} route patterns · configurable per aircraft`
                : `${10 - readyCount} aircraft blocked by preflight checks`}
          </small>
        </div>
        {user?.role === "ADMIN" && (
          <div className="fleet-actions">
            {flights.length ? (
              <>
                <button
                  className="secondary"
                  onClick={() => commandFleet("PAUSE")}
                  disabled={busy || !selectedFlightIds.length || !canPauseSelected}
                  title={
                    canPauseSelected
                      ? "Pause selected aircraft"
                      : "No selected aircraft can be paused"
                  }
                >
                  <CirclePause />
                  Pause selected
                </button>
                <button
                  className="secondary"
                  onClick={() => commandFleet("RESUME")}
                  disabled={
                    busy || !selectedFlightIds.length || !canResumeSelected
                  }
                  title={
                    canResumeSelected
                      ? "Resume selected aircraft"
                      : "No selected aircraft is paused"
                  }
                >
                  <CirclePlay />
                  Resume selected
                </button>
                <button
                  className="secondary"
                  onClick={() => commandFleet("RETURN_HOME")}
                  disabled={busy || !selectedFlightIds.length}
                >
                  <House />
                  {allCommandTargetsSelected
                    ? "Return all home"
                    : "Return selected home"}
                </button>
                <button
                  className="stop"
                  onClick={() => commandFleet("LAND")}
                  disabled={busy || !selectedFlightIds.length}
                >
                  <LandPlot />
                  {allCommandTargetsSelected ? "Land all" : "Land selected"}
                </button>
                <button className="stop" onClick={stop} disabled={busy}>
                  <Square />
                  Stop fleet
                </button>
              </>
            ) : (
              <>
                {readyCount < 10 && (
                  <button
                    className="secondary"
                    onClick={prepare}
                    disabled={busy}
                  >
                    <Sparkles />
                    Recharge demo fleet
                  </button>
                )}
                <button
                  className="primary"
                  onClick={start}
                  disabled={busy || readyCount < 10}
                >
                  <Play />
                  Start 10 drones
                </button>
              </>
            )}
          </div>
        )}
      </Panel>
      {flights.length > 0 && user?.role === "ADMIN" && (
        <Panel
          className="fleet-command-targets"
          title="Emergency command targets"
          action={
            <span className="fleet-target-count">
              {selectedFlightIds.length}/{flights.length} selected
            </span>
          }
        >
          <div className="fleet-target-toolbar">
            <small>
              Choose which active aircraft receive the next fleet command.
            </small>
            <div>
              <button
                className="secondary small"
                onClick={selectAllCommandTargets}
                disabled={busy || allCommandTargetsSelected}
              >
                Select all
              </button>
              <button
                className="secondary small"
                onClick={clearCommandTargets}
                disabled={busy || !selectedFlightIds.length}
              >
                Clear
              </button>
            </div>
          </div>
          {commandResult && (
            <div
              className={`fleet-command-result ${commandResult.failed ? "failed" : "success"}`}
              role={commandResult.failed ? "alert" : "status"}
            >
              <div className="fleet-command-result-head">
                <div>
                  <strong>
                    {commandResult.completed}/{commandResult.requested}{" "}
                    {fleetCommandLabel[commandResult.type]} commands completed
                  </strong>
                  <small>
                    {commandResult.failed
                      ? `${commandResult.failed} aircraft need attention.`
                      : "Every selected aircraft acknowledged the command."}
                  </small>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Dismiss fleet command result"
                  title="Dismiss fleet command result"
                  onClick={() => setCommandResult(undefined)}
                >
                  <X />
                </button>
              </div>
              {commandResult.failures.length > 0 && (
                <>
                  <ul className="fleet-command-failures">
                    {commandResult.failures.map((failure) => (
                      <li key={failure.flightId}>
                        <b>{commandTargetLabel(failure.flightId)}</b>
                        <span>{failure.message}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="secondary small fleet-retry-button"
                    onClick={selectFailedCommandTargets}
                    disabled={busy || !failedActiveFlightIds.length}
                  >
                    Select failed ({failedActiveFlightIds.length})
                  </button>
                </>
              )}
            </div>
          )}
          <div className="fleet-target-grid">
            {drones.map((drone, index) => {
              const flight = flights.find(
                (item) => flightDroneId(item) === drone._id,
              );
              if (!flight) return null;
              const checked = selectedFlightIds.includes(flight._id);
              const streamStatus = telemetryStatusForFlight(flight);
              return (
                <label
                  className={checked ? "fleet-target selected" : "fleet-target"}
                  key={flight._id}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${drone.droneCode} for fleet command`}
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggleCommandTarget(flight._id)}
                  />
                  <i
                    style={{
                      background: [
                        "#60a5fa",
                        "#34d399",
                        "#fbbf24",
                        "#f472b6",
                        "#a78bfa",
                        "#22d3ee",
                        "#fb7185",
                        "#a3e635",
                        "#f97316",
                        "#c084fc",
                      ][index],
                    }}
                  />
                  <span>
                    <b>{drone.droneCode}</b>
                    <small>
                      {flight.flightPhase?.replaceAll("_", " ") ?? "ACTIVE"} · {streamStatus}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        </Panel>
      )}
      {flights.length > 0 && (
        <div
          className={`fleet-stream-health ${streamTone}`}
          role="status"
          aria-live="polite"
        >
          <div className="fleet-stream-health-title">
            <Radio />
            <span>
              <b>Telemetry coverage</b>
              <small>Packets older than 5 seconds are marked stale.</small>
            </span>
          </div>
          <div className="fleet-stream-stats">
            <span className="live">
              <i />
              {liveCount} live
            </span>
            <span className="waiting">
              <i />
              {waitingCount} waiting
            </span>
            <span className="stale">
              <i />
              {staleCount} stale
            </span>
          </div>
        </div>
      )}
      {!flights.length && (
        <Panel title="Route assignments">
          <div className="assignment-grid">
            {drones.map((drone, index) => (
              <label key={drone._id}>
                <span>
                  <b>{drone.droneCode}</b>
                  <small>{drone.model}</small>
                </span>
                <select
                  aria-label={`Route for ${drone.droneCode}`}
                  value={assignments[drone._id]}
                  disabled={user?.role !== "ADMIN" || busy}
                  onChange={(event) =>
                    setAssignments({
                      ...assignments,
                      [drone._id]: event.target.value as RoutePattern,
                    })
                  }
                >
                  {patterns.map((pattern) => (
                    <option key={pattern} value={pattern}>
                      {ROUTE_PATTERN_META[pattern].label}
                    </option>
                  ))}
                </select>
                <i
                  style={{
                    background: [
                      "#60a5fa",
                      "#34d399",
                      "#fbbf24",
                      "#f472b6",
                      "#a78bfa",
                      "#22d3ee",
                      "#fb7185",
                      "#a3e635",
                      "#f97316",
                      "#c084fc",
                    ][index],
                  }}
                />
              </label>
            ))}
          </div>
        </Panel>
      )}
      <div className="fleet-layout">
        <Panel
          title="Fleet live map"
          action={
            <span className={`map-live ${streamTone}`}>
              <i />
              {flights.length ? streamLabel : "STANDBY"}
            </span>
          }
        >
          <FleetMap
            drones={drones}
            pointsByDrone={pointsByDrone}
            routeByDrone={routeByDrone}
            telemetryStatusByDrone={telemetryStatusByDrone}
            geofences={geofences}
            selectedDroneId={selectedDroneId}
            onSelect={setSelectedDroneId}
          />
        </Panel>
        <Panel title="Selected aircraft">
          <div className="selected-head">
            <div>
              <span>{selectedDrone?.droneCode}</span>
              <b>{selectedDrone?.name}</b>
            </div>
            <StatusBadge
              status={
                selectedFlight
                  ? !selectedTelemetry
                    ? "WAITING"
                    : selectedStale
                      ? "STALE"
                      : selectedAlerts.length
                        ? "WARNING"
                        : "IN_FLIGHT"
                  : "STANDBY"
              }
            />
          </div>
          <div className="selected-metrics">
            <div>
              <span>Battery</span>
              <b>
                {selectedTelemetry?.battery ?? selectedDrone?.battery ?? "—"}%
              </b>
            </div>
            <div>
              <span>Altitude</span>
              <b>{selectedTelemetry?.altitude ?? "—"} m</b>
            </div>
            <div>
              <span>Speed</span>
              <b>{selectedTelemetry?.speed ?? "—"} m/s</b>
            </div>
            <div>
              <span>GPS</span>
              <b>{selectedTelemetry?.gpsSatellites ?? "—"} sats</b>
            </div>
            <div>
              <span>Heading</span>
              <b>
                {selectedTelemetry
                  ? `${Math.round(selectedTelemetry.heading ?? 0)}°`
                  : "—"}
              </b>
            </div>
          </div>
          <div className="flight-info">
            <div>
              <span>Route</span>
              <b>
                {routePatternLabel(
                  selectedFlight?.routePattern ??
                    assignments[selectedDroneId ?? ""],
                )}
              </b>
            </div>
            <div>
              <span>Condition</span>
              <b>
                {selectedFlight?.scenario?.replaceAll("_", " ") ?? "WAITING"}
              </b>
            </div>
            <div>
              <span>Mission progress</span>
              <b>
                {missionProgressLabel(
                  selectedTelemetry?.waypointIndex,
                  selectedTelemetry?.waypointCount,
                  selectedTelemetry?.flightPhase,
                )}
              </b>
            </div>
            <div>
              <span>Telemetry age</span>
              <b>
                {selectedTelemetry
                  ? `${Math.max(0, Math.round(freshness(selectedTelemetry) / 1_000))}s ago`
                  : "Waiting for packet"}
              </b>
            </div>
          </div>
          <h3 className="subheading">Aircraft alerts</h3>
          <div className="alerts-list compact">
            {selectedAlerts.map((alert) => (
              <AlertRow
                key={alert._id}
                severity={alert.severity}
                message={alert.message}
                time={alert.occurredAt}
              />
            ))}
            {!selectedAlerts.length && (
              <Empty
                title="No alerts"
                text="Select any aircraft to inspect its condition."
              />
            )}
          </div>
        </Panel>
      </div>
      <div className="drone-card-grid">
        {drones.map((drone) => {
          const latest = pointsByDrone[drone._id]?.at(-1);
          const flight = flights.find(
            (item) =>
              flightDroneId(item) === drone._id,
          );
          const streamStatus = flight
            ? telemetryState(latest?.timestamp, now)
            : undefined;
          const progress = missionProgress(
            latest?.waypointIndex,
            latest?.waypointCount,
            latest?.flightPhase,
          );
          return (
            <button
              key={drone._id}
              className={
                selectedDroneId === drone._id
                  ? "fleet-card selected"
                  : "fleet-card"
              }
              onClick={() => setSelectedDroneId(drone._id)}
              title={readiness[drone._id]?.blockers.join(" · ")}
            >
              <header>
                <span>{drone.droneCode}</span>
                <StatusBadge
                  status={
                    flight
                      ? streamStatus === "WAITING"
                        ? "WAITING"
                        : streamStatus === "STALE"
                          ? "STALE"
                          : alerts.some(
                              (alert) =>
                                (typeof alert.droneId === "string"
                                  ? alert.droneId
                                  : alert.droneId._id) === drone._id,
                            )
                            ? "WARNING"
                            : "LIVE"
                      : readiness[drone._id]?.ready
                        ? "READY"
                        : "BLOCKED"
                  }
                />
              </header>
              <strong>
                {latest?.battery ?? Math.round(drone.battery)}
                <small>%</small>
              </strong>
              {progress && (
                <div
                  className="fleet-progress"
                  role="progressbar"
                  aria-label={`Mission progress ${progress.percent}%`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                >
                  <span>
                    <small>MISSION</small>
                    <b>{progress.percent}%</b>
                  </span>
                  <i>
                    <em style={{ width: `${progress.percent}%` }} />
                  </i>
                </div>
              )}
              <footer>
                <span>
                  {routePatternLabel(
                    flight?.routePattern ?? assignments[drone._id],
                  )}
                </span>
                <span>{latest?.speed ?? "—"} m/s</span>
              </footer>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ReadinessPanel({ readiness }: { readiness: DroneReadiness }) {
  return (
    <Panel
      className={`readiness-panel ${readiness.ready ? "ready" : "blocked"}`}
      title="Preflight readiness"
      action={<StatusBadge status={readiness.ready ? "READY" : "BLOCKED"} />}
    >
      <div className="readiness-grid">
        {readiness.checks.map((check) => (
          <div key={check.key} className={check.status.toLowerCase()}>
            {check.status === "PASS" ? (
              <CheckCircle2 />
            ) : check.status === "WARN" ? (
              <AlertTriangle />
            ) : (
              <CircleX />
            )}
            <span>
              <b>{check.label}</b>
              <small>{check.message}</small>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TelemetryChart({
  data,
}: {
  data: Array<{ seq: number; altitude: number; speed: number }>;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="alt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3b82f6" stopOpacity={0.32} />
              <stop offset="1" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#202a36" vertical={false} />
          <XAxis dataKey="seq" stroke="#64748b" tickLine={false} />
          <YAxis stroke="#64748b" tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "#111822",
              border: "1px solid #273140",
              borderRadius: 8,
            }}
          />
          <Area
            type="monotone"
            dataKey="altitude"
            stroke="#3b82f6"
            fill="url(#alt)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="speed"
            stroke="#22c55e"
            fill="transparent"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
