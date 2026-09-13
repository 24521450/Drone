import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CloudRain,
  CloudSun,
  Droplets,
  Download,
  Eye,
  Gauge,
  MapPin,
  RefreshCw,
  Sun,
  Thermometer,
  Wind,
} from "lucide-react";
import { PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, isCanceledRequest, socket } from "../lib";
import type { EnvironmentSnapshot } from "../types";

export default function Environment() {
  const { notify } = useFeedback();
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
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
      const response = await api.get("/environment", { signal: controller.signal });
      if (!controller.signal.aborted) setSnapshot(response.data.data as EnvironmentSnapshot);
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

  const exportSnapshot = async () => {
    if (exporting || !snapshot) return;
    setExporting(true);
    try {
      const response = await api.get("/environment/export", { responseType: "blob" });
      downloadBlob(`environment-${new Date().toISOString().slice(0, 10)}.csv`, response.data);
      notify("Environment snapshot exported", "success");
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify("Environment export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    const refresh = () => void load(true);
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      window.clearInterval(timer);
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
      requestRef.current?.abort();
    };
  }, []);

  if (loading && !snapshot)
    return <div className="dashboard-skeleton"><div /><div /><div /><section /></div>;

  const conditions = snapshot?.conditions;
  const risk = snapshot?.flightRisk;
  return <>
    <PageTitle
      eyebrow="SYSTEM / ENVIRONMENT"
      title="Environment conditions"
      text="Weather context and live telemetry combined into an explainable flight-risk snapshot."
      action={<div className="action-row"><button className="secondary" onClick={() => void exportSnapshot()} disabled={exporting || !snapshot}><Download />{exporting ? "Exporting..." : "Export snapshot"}</button><button className="secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing..." : "Refresh conditions"}</button></div>}
    />
    {error && <div className="form-error page-error"><span>{error}</span><button className="secondary small" onClick={() => void load()} disabled={loading}><RefreshCw />Retry</button></div>}
    {snapshot && conditions && risk && <>
      <section className={`environment-hero ${risk.level.toLowerCase()}`}>
        <div className="environment-hero-copy"><span className="environment-kicker"><CloudSun /> CURRENT FIELD SNAPSHOT</span><h2>{snapshot.station.name}</h2><p><MapPin />{snapshot.station.latitude.toFixed(4)}, {snapshot.station.longitude.toFixed(4)}</p><small>Updated {new Date(snapshot.generatedAt).toLocaleTimeString()} · refreshes every {snapshot.refreshIntervalSeconds}s</small></div>
        <div className="environment-risk"><span>FLIGHT RISK</span><strong>{risk.score}<small>/100</small></strong><StatusBadge status={risk.level} /></div>
      </section>
      <Panel title="Current conditions" action={<span className="environment-source"><i />{snapshot.sourceLabel} · {snapshot.source}</span>}>
        <div className="environment-condition-grid">
          <EnvironmentMetric icon={<Thermometer />} label="TEMPERATURE" value={`${conditions.temperatureC.toFixed(1)}°C`} detail="Ambient air" />
          <EnvironmentMetric icon={<Droplets />} label="HUMIDITY" value={`${conditions.humidityPercent}%`} detail="Relative humidity" />
          <EnvironmentMetric icon={<Wind />} label="WIND" value={`${conditions.windSpeedMps.toFixed(1)} m/s`} detail={conditions.windDirection} />
          <EnvironmentMetric icon={<CloudRain />} label="RAIN" value={conditions.rainStatus} detail={`${conditions.rainMm.toFixed(1)} mm`} tone={conditions.rainStatus === "NONE" ? "good" : "watch"} />
          <EnvironmentMetric icon={<Eye />} label="VISIBILITY" value={`${conditions.visibilityKm.toFixed(1)} km`} detail={conditions.visibilityStatus} tone={conditions.visibilityStatus === "GOOD" ? "good" : "watch"} />
          <EnvironmentMetric icon={<Gauge />} label="PRESSURE" value={`${conditions.pressureHpa} hPa`} detail="Sea-level estimate" />
          <EnvironmentMetric icon={<Sun />} label="UV INDEX" value={conditions.uvIndex.toFixed(1)} detail={conditions.uvIndex >= 8 ? "High exposure" : "Moderate exposure"} tone={conditions.uvIndex >= 8 ? "watch" : ""} />
          <EnvironmentMetric icon={<Wind />} label="DIRECTION" value={`${conditions.windDirectionDeg}°`} detail={`From ${conditions.windDirection}`} />
        </div>
      </Panel>
      <div className="two-one-grid environment-lower-grid">
        <Panel title="Risk factors"><div className="environment-factors">{risk.factors.length ? risk.factors.map((factor) => <article className={`environment-factor ${factor.severity.toLowerCase()}`} key={factor.key}><div><StatusBadge status={factor.severity} /><b>{factor.label}</b></div><p>{factor.message}</p><small>+{factor.score} risk points</small></article>) : <div className="environment-all-clear"><CloudSun /><div><strong>Conditions are nominal</strong><p>No weather or active-flight indicators are currently elevating risk.</p></div></div>}</div></Panel>
        <Panel title="Fleet context"><div className="environment-fleet"><div><strong>{snapshot.fleet.activeFlights}</strong><span>ACTIVE FLIGHTS</span></div><div><strong>{snapshot.fleet.atRiskFlights}</strong><span>AT-RISK AIRCRAFT</span></div><div><strong>{snapshot.fleet.telemetryCoveragePercent}%</strong><span>TELEMETRY COVERAGE</span></div></div><p className="environment-note">Risk combines simulated field conditions with the latest packet from each active flight. Idle fleets remain visible for preflight planning.</p></Panel>
      </div>
    </>}
  </>;
}

function EnvironmentMetric({ icon, label, value, detail, tone = "" }: { icon: ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <div className={`environment-condition ${tone}`}><span className="environment-condition-icon">{icon}</span><div><b>{label}</b><strong>{value}</strong><small>{detail}</small></div></div>;
}
