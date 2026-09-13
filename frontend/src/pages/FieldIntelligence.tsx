import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Droplets,
  Leaf,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sprout,
  TriangleAlert,
} from "lucide-react";
import { PageTitle, Empty, Metric, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, errorMessage, isCanceledRequest, socket } from "../lib";
import { FleetMap } from "../map-display";
import type { FieldIntelligence as FieldIntelligenceData, FieldPlot, Geofence } from "../types";

const statusLabel: Record<FieldPlot["status"], string> = {
  NORMAL: "NORMAL",
  WATER_STRESS: "WATER STRESS",
  POSSIBLE_DISEASE: "POSSIBLE DISEASE",
  NUTRIENT_STRESS: "NUTRIENT STRESS",
};

export default function FieldIntelligence() {
  const { notify } = useFeedback();
  const [data, setData] = useState<FieldIntelligenceData>();
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = async (silent = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [response, geofenceResponse] = await Promise.all([
        api.get("/field-intelligence", { signal: controller.signal }),
        api.get("/geofences", { params: { status: "ACTIVE" }, signal: controller.signal }),
      ]);
      if (!controller.signal.aborted) {
        setData(response.data.data as FieldIntelligenceData);
        setGeofences(geofenceResponse.data.data as Geofence[]);
      }
    } catch (reason) {
      if (!isCanceledRequest(reason)) {
        const message = errorMessage(reason);
        setError(message);
        if (!silent) notify(message, "error");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    const refresh = () => void load(true);
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("geofence:updated", refresh);
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      window.clearInterval(timer);
      socket.off("geofence:updated", refresh);
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
      requestRef.current?.abort();
    };
  }, []);

  if (loading && !data)
    return <div className="dashboard-skeleton"><div /><div /><div /><section /></div>;

  return <>
    <PageTitle
      eyebrow="MAP / FIELD INTELLIGENCE"
      title="Field intelligence"
      text="Turn survey zones into an explainable crop-health view for the next operational decision."
      action={<button className="secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing..." : "Refresh analysis"}</button>}
    />
    {error && <div className="form-error page-error"><span>{error}</span><button className="secondary small" onClick={() => void load()} disabled={loading}><RefreshCw />Retry</button></div>}
    {data && <>
      <section className="field-hero"><div><span className="field-kicker"><Sprout /> FIELD OVERVIEW</span><h2>{data.field.name}</h2><p>{data.field.areaHectares.toFixed(1)} ha · {data.field.plotsCount} plots · latest scan {data.summary.lastScanAt ? new Date(data.summary.lastScanAt).toLocaleString() : "not available"}</p></div><div className={`field-health ${data.summary.averageHealthScore < 60 ? "watch" : ""}`}><span>AVERAGE HEALTH</span><strong>{data.summary.averageHealthScore}<small>/100</small></strong><StatusBadge status={data.summary.averageHealthScore >= 75 ? "HEALTHY" : data.summary.averageHealthScore >= 60 ? "WATCH" : "CRITICAL"} /></div></section>
      <div className="metric-grid field-metrics"><Metric label="NORMAL" value={data.summary.normal} icon={<ShieldCheck />} /><Metric label="WATER STRESS" value={data.summary.waterStress} icon={<Droplets />} /><Metric label="POSSIBLE DISEASE" value={data.summary.possibleDisease} icon={<TriangleAlert />} /><Metric label="NUTRIENT STRESS" value={data.summary.nutrientStress} icon={<Leaf />} /></div>
      <Panel title="Field map overlay" action={<span className="field-map-note">{geofences.length ? `${geofences.length} active zone${geofences.length === 1 ? "" : "s"}` : "Demo plots are virtual"}</span>}><FleetMap drones={[]} pointsByDrone={{}} geofences={geofences} onSelect={() => undefined} height={380} /></Panel>
      <Panel title="Plot health" action={<span className="field-source"><i />{data.sourceLabel} · {data.source}</span>}><div className="field-plot-grid">{data.plots.map((plot) => <FieldPlotCard key={plot.id} plot={plot} />)}{!data.plots.length && <Empty title="No plots available" text="Create an active geofence to start a field analysis." />}</div></Panel>
      <Panel className="field-analysis-note"><ScanLine /><div><b>How to read this view</b><p>Scores are deterministic demo analysis placeholders. In production, replace the adapter with RGB, thermal or multispectral captures while retaining the same evidence and confidence workflow.</p></div><small>Updated {new Date(data.generatedAt).toLocaleTimeString()}</small></Panel>
    </>}
  </>;
}

function FieldPlotCard({ plot }: { plot: FieldPlot }) {
  const statusClass = plot.status.toLowerCase().replaceAll("_", "-");
  const badge = plot.status === "POSSIBLE_DISEASE" ? "CRITICAL" : plot.status === "NORMAL" ? "HEALTHY" : "WATCH";
  return <article className={`field-plot-card ${statusClass}`}><header><div><b>{plot.name}</b><small>{plot.areaHectares.toFixed(2)} ha{plot.virtual ? " · demo plot" : " · geofence zone"}</small></div><StatusBadge status={badge} /></header><div className="field-plot-health"><strong>{plot.healthScore}<small>/100</small></strong><span>HEALTH SCORE</span></div><FieldBar label="Disease risk" value={plot.diseaseRiskPercent} tone="disease" /><FieldBar label="Water stress" value={plot.waterStressPercent} tone="water" /><FieldBar label="Nutrient stress" value={plot.nutrientStressPercent} tone="nutrient" /><footer><span className={`field-plot-status ${statusClass}`}>{statusLabel[plot.status]}</span><small>Scanned {new Date(plot.latestScanAt).toLocaleDateString()}</small></footer></article>;
}

function FieldBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="field-bar"><div><span>{label}</span><b>{value}%</b></div><i><em className={tone} style={{ width: `${value}%` }} /></i></div>;
}
