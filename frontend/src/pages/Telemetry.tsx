import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Battery,
  Clock3,
  Download,
  Gauge,
  Radio,
  Satellite,
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
import { Empty, Metric, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import {
  api,
  downloadBlob,
  errorMessage,
  missionProgressLabel,
  socket,
  telemetryState,
} from "../lib";
import {
  routePatternLabel,
  type Flight,
  type Telemetry as TelemetryPoint,
} from "../types";

const flightDroneId = (flight: Flight) =>
  typeof flight.droneId === "string" ? flight.droneId : flight.droneId._id;
const flightDroneLabel = (flight: Flight) =>
  typeof flight.droneId === "string"
    ? flight.droneId
    : `${flight.droneId.droneCode} · ${flight.droneId.name}`;
const formatNumber = (value: number | undefined, digits = 1) =>
  value == null ? "—" : value.toFixed(digits);
const headingLabel = (heading?: number) => {
  if (heading == null || !Number.isFinite(heading)) return "—";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round((((heading % 360) + 360) % 360) / 45) % 8
  ];
};
export default function Telemetry() {
  const { notify } = useFeedback();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [flightId, setFlightId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [points, setPoints] = useState<TelemetryPoint[]>([]);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const flightRequestRef = useRef<AbortController | null>(null);

  const loadFlights = async () => {
    flightRequestRef.current?.abort();
    const controller = new AbortController();
    flightRequestRef.current = controller;
    setLoadingFlights(true);
    setError("");
    try {
      const response = await api.get("/flights", {
        params: { status: "ALL", limit: 100 },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const items = response.data.data as Flight[];
      setFlights(items);
      setFlightId((current) =>
        current && items.some((item) => item._id === current)
          ? current
          : (items.find((item) => item.status === "ACTIVE")?._id ??
            items[0]?._id ??
            ""),
      );
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
        setError(errorMessage(reason));
    } finally {
      if (flightRequestRef.current === controller) {
        flightRequestRef.current = null;
        if (!controller.signal.aborted) setLoadingFlights(false);
      }
    }
  };

  useEffect(() => {
    void loadFlights();
    return () => flightRequestRef.current?.abort();
  }, []);
  useEffect(() => {
    const refresh = () => {
      void loadFlights();
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
    };
  }, []);

  const selectedFlight = flights.find((flight) => flight._id === flightId);

  useEffect(() => {
    if (!selectedFlight || selectedFlight.status !== "ACTIVE") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [selectedFlight?.status]);

  useEffect(() => {
    if (!flightId) {
      setPoints([]);
      return;
    }
    const controller = new AbortController();
    // Never let a failed or slow request render packets belonging to the
    // previously selected flight.
    setPoints([]);
    setLoadingPoints(true);
    setError("");
    api
      .get(`/flights/${flightId}/telemetry`, {
        params: {
          limit: 5000,
          dateFrom,
          dateTo,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted)
          setPoints(response.data.data as TelemetryPoint[]);
      })
      .catch((reason) => {
        if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
          setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPoints(false);
      });
    return () => controller.abort();
  }, [flightId, dateFrom, dateTo]);

  useEffect(() => {
    if (
      !selectedFlight ||
      selectedFlight.status !== "ACTIVE" ||
      dateFrom ||
      dateTo
    )
      return;
    const droneId = flightDroneId(selectedFlight);
    socket.auth = { token: localStorage.getItem("drone-token") };
    const subscribe = () => socket.emit("subscribe:drone", droneId);
    const telemetry = (payload: TelemetryPoint) => {
      if (payload.flightId !== selectedFlight._id) return;
      setPoints((current) => {
        const previous = current.at(-1);
        if (previous && payload.sequence <= previous.sequence) return current;
        return [...current.slice(-4999), payload];
      });
    };
    socket.connect();
    subscribe();
    socket.on("connect", subscribe);
    socket.on("telemetry:update", telemetry);
    return () => {
      socket.off("connect", subscribe);
      socket.off("telemetry:update", telemetry);
      socket.emit("unsubscribe:drone", droneId);
    };
  }, [selectedFlight?._id, selectedFlight?.status, dateFrom, dateTo]);

  const latest = points.at(-1);
  const previous = points.at(-2);
  const sequenceGaps = useMemo(
    () =>
      points.reduce(
        (total, point, index) =>
          index === 0
            ? 0
            : total +
              Math.max(0, point.sequence - points[index - 1].sequence - 1),
        0,
      ),
    [points],
  );
  const chartData = useMemo(
    () =>
      points
        .slice(-240)
        .map((point) => ({
          sequence: point.sequence,
          altitude: point.altitude,
          speed: point.speed,
          battery: point.battery,
          signal: point.signal,
        })),
    [points],
  );
  const recentRows = useMemo(() => [...points].slice(-25).reverse(), [points]);
  const stale =
    selectedFlight?.status === "ACTIVE" &&
    !dateFrom &&
    !dateTo &&
    telemetryState(latest?.timestamp, now) !== "LIVE";
  const exportTelemetry = async () => {
    if (!selectedFlight || loadingPoints || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get(
        `/flights/${selectedFlight._id}/telemetry/export`,
        {
          params: {
            dateFrom,
            dateTo,
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          },
          responseType: "blob",
        },
      );
      downloadBlob(`telemetry-${selectedFlight.flightCode}.csv`, response.data);
      notify("Matching telemetry packets exported", "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Telemetry export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  if (error && !selectedFlight)
    return (
      <>
        <PageTitle
          eyebrow="DATA"
          title="Telemetry"
          text="Inspect recorded and realtime sensor packets for every flight."
        />
        <div className="form-error page-error">{error}</div>
      </>
    );
  if (!loadingFlights && !flights.length)
    return (
      <>
        <PageTitle
          eyebrow="DATA"
          title="Telemetry"
          text="Inspect recorded and realtime sensor packets for every flight."
        />
        <Panel>
          <Empty
            title="No telemetry yet"
            text="Start a simulation to create the first flight data stream."
          />
        </Panel>
      </>
    );

  return (
    <>
      <PageTitle
        eyebrow="DATA"
        title="Telemetry"
        text="Inspect recorded and realtime sensor packets for every flight."
        action={
          <button
            className="secondary"
            onClick={() => void exportTelemetry()}
            disabled={!selectedFlight || loadingPoints || exporting}
          >
            <Download />
            {exporting ? "Exporting..." : "Export all telemetry"}
          </button>
        }
      />
      {error && <div className="form-error page-error">{error}</div>}
      <Panel className="telemetry-toolbar">
        <label>
          FLIGHT
          <select
            aria-label="Telemetry flight"
            value={flightId}
            onChange={(event) => setFlightId(event.target.value)}
            disabled={loadingFlights}
          >
            {flights.map((flight) => (
              <option key={flight._id} value={flight._id}>
                {flight.flightCode} · {flightDroneLabel(flight)} ·{" "}
                {flight.status}
              </option>
            ))}
          </select>
        </label>
        {selectedFlight && (
          <div className="telemetry-context">
            <StatusBadge status={stale ? "STALE" : selectedFlight.status} />
            <span>{routePatternLabel(selectedFlight.routePattern)} route</span>
            <small>
              {latest
                ? `Last packet ${new Date(latest.timestamp).toLocaleTimeString()}`
                : "No packets recorded"}
            </small>
          </div>
        )}
        <label>
          FROM
          <input
            aria-label="Telemetry date from"
            type="date"
            max={dateTo || undefined}
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            disabled={loadingPoints}
          />
        </label>
        <label>
          TO
          <input
            aria-label="Telemetry date to"
            type="date"
            min={dateFrom || undefined}
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            disabled={loadingPoints}
          />
        </label>
      </Panel>
      {loadingPoints ? (
        <div className="loading">Loading telemetry…</div>
      ) : (
        selectedFlight && (
          <>
            <div className="metric-grid six">
              <Metric
                label="BATTERY"
                value={latest?.battery ?? "—"}
                unit={latest ? "%" : ""}
                icon={<Battery />}
              />
              <Metric
                label="ALTITUDE"
                value={formatNumber(latest?.altitude)}
                unit={latest ? "m" : ""}
                icon={<Activity />}
              />
              <Metric
                label="SPEED"
                value={formatNumber(latest?.speed)}
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
                label="PACKETS"
                value={points.length}
                unit={sequenceGaps ? `${sequenceGaps} gaps` : ""}
                icon={<Clock3 />}
              />
            </div>
            <div className="telemetry-quality">
              <span>
                <b>DATA QUALITY</b>
                <strong
                  className={sequenceGaps ? "warning-text" : "success-text"}
                >
                  {sequenceGaps
                    ? `${sequenceGaps} missing sequence${sequenceGaps === 1 ? "" : "s"}`
                    : "Continuous stream"}
                </strong>
              </span>
              <span>
                <b>POSITION</b>
                <strong>
                  {latest
                    ? `${latest.latitude.toFixed(5)}, ${latest.longitude.toFixed(5)}`
                    : "No fix"}
                </strong>
              </span>
              <span>
                <b>HEADING</b>
                <strong>
                  {latest
                    ? `${Math.round(latest.heading ?? 0)}° · ${headingLabel(latest.heading)}`
                    : "No fix"}
                </strong>
              </span>
              <span>
                <b>MISSION PROGRESS</b>
                <strong>
                  {missionProgressLabel(
                    latest?.waypointIndex,
                    latest?.waypointCount,
                    latest?.flightPhase,
                  )}
                </strong>
              </span>
              <span>
                <b>DELTA BATTERY</b>
                <strong>
                  {latest && previous
                    ? `${(latest.battery - previous.battery).toFixed(2)}%`
                    : "—"}
                </strong>
              </span>
            </div>
            <div className="analytics-grid telemetry-charts">
              <TelemetryChart
                title="Altitude"
                data={chartData}
                dataKey="altitude"
                color="#60a5fa"
                unit="m"
              />
              <TelemetryChart
                title="Speed"
                data={chartData}
                dataKey="speed"
                color="#4ade80"
                unit="m/s"
              />
              <TelemetryChart
                title="Battery"
                data={chartData}
                dataKey="battery"
                color="#fbbf24"
                unit="%"
              />
              <TelemetryChart
                title="Signal"
                data={chartData}
                dataKey="signal"
                color="#c084fc"
                unit="%"
              />
            </div>
            <Panel title="Recent packets">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Sequence</th>
                      <th>Battery</th>
                      <th>Altitude</th>
                      <th>Speed</th>
                      <th>Heading</th>
                      <th>GPS</th>
                      <th>Signal</th>
                      <th>Waypoint</th>
                      <th>Phase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((point) => (
                      <tr key={`${point.flightId}-${point.sequence}`}>
                        <td>
                          {new Date(point.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="mono">{point.sequence}</td>
                        <td>{point.battery}%</td>
                        <td>{formatNumber(point.altitude)} m</td>
                        <td>{formatNumber(point.speed)} m/s</td>
                        <td>{Math.round(point.heading ?? 0)}°</td>
                        <td>{point.gpsSatellites} sats</td>
                        <td>{point.signal}%</td>
                        <td>
                          {missionProgressLabel(
                            point.waypointIndex,
                            point.waypointCount,
                            point.flightPhase,
                          )}
                        </td>
                        <td>
                          <StatusBadge
                            status={point.flightPhase ?? point.flightMode}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!recentRows.length && (
                  <Empty
                    title="No packets"
                    text="This flight has not produced telemetry yet."
                  />
                )}
              </div>
            </Panel>
          </>
        )
      )}
    </>
  );
}

function TelemetryChart({
  title,
  data,
  dataKey,
  color,
  unit,
}: {
  title: string;
  data: Array<Record<string, number>>;
  dataKey: string;
  color: string;
  unit: string;
}) {
  return (
    <Panel title={title}>
      <div className="telemetry-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid stroke="#202a36" vertical={false} />
            <XAxis
              dataKey="sequence"
              stroke="#64748b"
              tickLine={false}
              fontSize={9}
            />
            <YAxis stroke="#64748b" tickLine={false} fontSize={9} />
            <Tooltip
              contentStyle={{
                background: "#111822",
                border: "1px solid #273140",
                borderRadius: 8,
              }}
              formatter={(value) => [
                `${Number(value).toFixed(1)} ${unit}`,
                title,
              ]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              fill={`${color}26`}
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
