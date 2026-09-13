import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Battery,
  CheckCircle2,
  Download,
  Route,
  Timer,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Metric, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadCsv, errorMessage, formatDuration, socket } from "../lib";
import { routePatternLabel, type Drone } from "../types";

type AnalyticsData = {
  range: { dateFrom: string; dateTo: string };
  totals: {
    flights: number;
    completed: number;
    failed: number;
    distanceMeters: number;
    durationSeconds: number;
    averageBatteryUsed: number;
  };
  daily: Array<{
    date: string;
    flights: number;
    completed: number;
    failed: number;
    distanceMeters: number;
    durationSeconds: number;
  }>;
  alertTypes: Array<{ type: string; count: number }>;
  routePatterns: Array<{ routePattern: string; count: number }>;
  missionOutcomes: Array<{ status: string; count: number }>;
};

type AnalyticsExportRow = {
  section: string;
  date: string;
  metric: string;
  value: string | number;
  completed: string | number;
  failed: string | number;
  distanceMeters: string | number;
  durationSeconds: string | number;
};

const analyticsExportRows = (analytics: AnalyticsData): AnalyticsExportRow[] => {
  const empty = {
    date: "",
    completed: "",
    failed: "",
    distanceMeters: "",
    durationSeconds: "",
  };
  const summary: AnalyticsExportRow[] = [
    { section: "SUMMARY", metric: "flights", value: analytics.totals.flights, ...empty },
    { section: "SUMMARY", metric: "completed", value: analytics.totals.completed, ...empty },
    { section: "SUMMARY", metric: "failed", value: analytics.totals.failed, ...empty },
    { section: "SUMMARY", metric: "distanceMeters", value: analytics.totals.distanceMeters, ...empty },
    { section: "SUMMARY", metric: "durationSeconds", value: analytics.totals.durationSeconds, ...empty },
    { section: "SUMMARY", metric: "averageBatteryUsed", value: analytics.totals.averageBatteryUsed, ...empty },
    {
      section: "SUMMARY",
      metric: "successRatePercent",
      value: analytics.totals.flights
        ? Math.round((analytics.totals.completed / analytics.totals.flights) * 100)
        : 0,
      ...empty,
    },
  ];
  const daily = analytics.daily.map((item) => ({
    section: "DAILY",
    date: item.date,
    metric: "flightOutcomes",
    value: item.flights,
    completed: item.completed,
    failed: item.failed,
    distanceMeters: item.distanceMeters,
    durationSeconds: item.durationSeconds,
  }));
  const breakdown = (
    section: string,
    items: Array<{ key: string; count: number }>,
  ) =>
    items.map((item) => ({
      section,
      date: "",
      metric: item.key,
      value: item.count,
      completed: "",
      failed: "",
      distanceMeters: "",
      durationSeconds: "",
    }));
  return [
    ...summary,
    ...daily,
    ...breakdown("SAFETY", analytics.alertTypes.map((item) => ({ key: item.type, count: item.count }))),
    ...breakdown("ROUTES", analytics.routePatterns.map((item) => ({ key: item.routePattern, count: item.count }))),
    ...breakdown("MISSIONS", analytics.missionOutcomes.map((item) => ({ key: item.status, count: item.count }))),
  ];
};

const localDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
const today = new Date();
const monthAgo = new Date(today.getTime() - 29 * 86_400_000);

export default function Analytics() {
  const { notify } = useFeedback();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [data, setData] = useState<AnalyticsData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    dateFrom: localDay(monthAgo),
    dateTo: localDay(today),
    droneId: "",
  });
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
      const response = await api.get("/analytics", {
        params: {
          ...filters,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setData(response.data.data);
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") {
        setData(undefined);
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
    void load();
    return () => requestRef.current?.abort();
  }, [filters.dateFrom, filters.dateTo, filters.droneId]);
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
    socket.on("alert:created", refresh);
    socket.on("alert:updated", refresh);
    socket.on("drone:updated", refreshFleet);
    socket.on("fleet:updated", refreshFleet);
    socket.on("mission:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("flight:status", refresh);
      socket.off("alert:created", refresh);
      socket.off("alert:updated", refresh);
      socket.off("drone:updated", refreshFleet);
      socket.off("fleet:updated", refreshFleet);
      socket.off("mission:status", refresh);
      socket.off("connect", refresh);
    };
  }, [filters.dateFrom, filters.dateTo, filters.droneId]);

  const exportAnalytics = () => {
    if (!data) return;
    downloadCsv(
      `operations-${filters.dateFrom}-${filters.dateTo}.csv`,
      analyticsExportRows(data),
    );
    notify("Analytics summary exported", "success");
  };

  return (
    <>
      <PageTitle
        eyebrow="INTELLIGENCE"
        title="Operational analytics"
        text="Measure fleet output, reliability and safety trends over a selected period."
        action={
          <button
            className="secondary"
            disabled={!data || loading}
            onClick={exportAnalytics}
          >
            <Download />
            Export analytics CSV
          </button>
        }
      />
      {error && <div className="form-error page-error">{error}</div>}
      <Panel>
        <div className="toolbar analytics-filters">
          <label>
            FROM
            <input
              aria-label="Analytics date from"
              type="date"
              max={filters.dateTo}
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters({ ...filters, dateFrom: event.target.value })
              }
            />
          </label>
          <label>
            TO
            <input
              aria-label="Analytics date to"
              type="date"
              min={filters.dateFrom}
              value={filters.dateTo}
              onChange={(event) =>
                setFilters({ ...filters, dateTo: event.target.value })
              }
            />
          </label>
          <label>
            AIRCRAFT
            <select
              value={filters.droneId}
              onChange={(event) =>
                setFilters({ ...filters, droneId: event.target.value })
              }
            >
              <option value="">Entire fleet</option>
              {drones.map((drone) => (
                <option key={drone._id} value={drone._id}>
                  {drone.droneCode}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      {loading ? (
        <div className="dashboard-skeleton">
          <div />
          <div />
          <div />
          <div />
          <section />
        </div>
      ) : (
        data && (
          <>
            <div className="metric-grid">
              <Metric
                label="FLIGHTS"
                value={data.totals.flights}
                icon={<Route />}
              />
              <Metric
                label="COMPLETED"
                value={data.totals.completed}
                icon={<CheckCircle2 />}
              />
              <Metric
                label="FAILED"
                value={data.totals.failed}
                icon={<XCircle />}
              />
              <Metric
                label="FLIGHT TIME"
                value={formatDuration(data.totals.durationSeconds)}
                icon={<Timer />}
              />
            </div>
            <div className="metric-grid analytics-secondary">
              <Metric
                label="DISTANCE"
                value={(data.totals.distanceMeters / 1000).toFixed(2)}
                unit="km"
              />
              <Metric
                label="SUCCESS RATE"
                value={
                  data.totals.flights
                    ? Math.round(
                        (data.totals.completed / data.totals.flights) * 100,
                      )
                    : 0
                }
                unit="%"
              />
              <Metric
                label="AVG. BATTERY USED"
                value={Math.max(0, data.totals.averageBatteryUsed || 0).toFixed(
                  1,
                )}
                unit="%"
                icon={<Battery />}
              />
              <Metric
                label="SAFETY EVENTS"
                value={data.alertTypes.reduce(
                  (total, item) => total + item.count,
                  0,
                )}
              />
            </div>
            <div className="analytics-grid">
              <Panel title="Daily flight outcomes">
                <ChartEmpty empty={!data.daily.length}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily}>
                      <CartesianGrid stroke="#202a36" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: "#111822",
                          border: "1px solid #273140",
                          borderRadius: 8,
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="completed"
                        stackId="flights"
                        fill="#22c55e"
                      />
                      <Bar dataKey="failed" stackId="flights" fill="#ef4444" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartEmpty>
              </Panel>
              <Panel title="Distance trend">
                <ChartEmpty empty={!data.daily.length}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily}>
                      <CartesianGrid stroke="#202a36" vertical={false} />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" />
                      <Tooltip
                        contentStyle={{
                          background: "#111822",
                          border: "1px solid #273140",
                          borderRadius: 8,
                        }}
                      />
                      <Area
                        dataKey="distanceMeters"
                        stroke="#60a5fa"
                        fill="#3b82f62a"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartEmpty>
              </Panel>
              <BreakdownPanel
                title="Safety events"
                emptyTitle="No safety events"
                emptyText="No alerts match this date range."
                items={data.alertTypes.map((item) => ({
                  key: item.type,
                  label: item.type.replaceAll("_", " "),
                  count: item.count,
                }))}
              />
              <BreakdownPanel
                title="Route utilization"
                emptyTitle="No route data"
                emptyText="No route patterns match this date range."
                items={data.routePatterns.map((item) => ({
                  key: item.routePattern ?? "MISSION",
                  label: routePatternLabel(item.routePattern),
                  count: item.count,
                }))}
              />
              <Panel title="Mission outcomes">
                <div className="analytics-breakdown">
                  {data.missionOutcomes.map((item) => (
                    <div key={item.status}>
                      <StatusBadge status={item.status} />
                      <b>{item.count}</b>
                    </div>
                  ))}
                  {!data.missionOutcomes.length && (
                    <Empty
                      title="No mission outcomes"
                      text="No missions match this date range."
                    />
                  )}
                </div>
              </Panel>
            </div>
          </>
        )
      )}
    </>
  );
}

function ChartEmpty({
  empty,
  children,
}: {
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="analytics-chart">
      {empty ? (
        <Empty
          title="No flight data"
          text="Broaden the date range or choose another aircraft."
        />
      ) : (
        children
      )}
    </div>
  );
}
function BreakdownPanel({
  title,
  items,
  emptyTitle,
  emptyText,
}: {
  title: string;
  items: Array<{ key: string; label: string; count: number }>;
  emptyTitle: string;
  emptyText: string;
}) {
  return (
    <Panel title={title}>
      <div className="analytics-breakdown">
        {items.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <b>{item.count}</b>
          </div>
        ))}
        {!items.length && <Empty title={emptyTitle} text={emptyText} />}
      </div>
    </Panel>
  );
}
