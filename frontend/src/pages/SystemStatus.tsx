import { useEffect, useRef, useState } from "react";
import { Activity, Clock3, Cpu, Database, HardDrive, Radio, RefreshCw, Server, Wifi } from "lucide-react";
import { Metric, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, errorMessage, isCanceledRequest, socket } from "../lib";
import type { SystemService, SystemStatus as SystemStatusData } from "../types";

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean);
  return parts.join(" ");
};

const serviceIcons: Record<string, typeof Activity> = {
  frontend: Activity,
  backend: Server,
  database: Database,
  websocket: Wifi,
  "drone-link": Radio,
  "ai-service": Cpu,
  storage: HardDrive,
  mqtt: Radio,
};

export default function SystemStatus() {
  const { notify } = useFeedback();
  const [data, setData] = useState<SystemStatusData>();
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
      const response = await api.get("/system/status", { signal: controller.signal });
      if (!controller.signal.aborted) setData(response.data.data as SystemStatusData);
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
    const timer = window.setInterval(() => void load(true), 15_000);
    const refresh = () => void load(true);
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("connect", refresh);
    socket.on("disconnect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      window.clearInterval(timer);
      socket.off("connect", refresh);
      socket.off("disconnect", refresh);
      requestRef.current?.abort();
    };
  }, []);

  if (loading && !data)
    return <div className="dashboard-skeleton"><div /><div /><div /><section /></div>;

  const services = data?.services ?? [];
  const online = services.filter((service) => service.status === "ONLINE").length;
  return <>
    <PageTitle
      eyebrow="SYSTEM / STATUS"
      title="System status"
      text="Inspect the platform runtime, connection health and the adapters powering this demo."
      action={<button className="secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing..." : "Refresh status"}</button>}
    />
    {error && <div className="form-error page-error"><span>{error}</span><button className="secondary small" onClick={() => void load()} disabled={loading}><RefreshCw />Retry</button></div>}
    {data && <>
      <section className={`system-status-hero ${data.overallStatus.toLowerCase()}`}>
        <div><span className="system-status-kicker"><Activity /> PLATFORM RUNTIME</span><h2>{data.overallStatus === "ONLINE" ? "All runtime services operational" : "Runtime needs attention"}</h2><p>{data.sourceLabel} · updated {new Date(data.generatedAt).toLocaleTimeString()}</p></div>
        <StatusBadge status={data.overallStatus} />
      </section>
      <div className="metric-grid system-status-metrics">
        <Metric label="ONLINE SERVICES" value={`${online}/${services.length}`} icon={<Server />} />
        <Metric label="WEBSOCKET CLIENTS" value={data.connection.websocketClients} icon={<Wifi />} />
        <Metric label="PROCESS UPTIME" value={formatUptime(data.connection.uptimeSeconds)} icon={<Clock3 />} />
        <Metric label="MEMORY RSS" value={data.connection.memoryRssMb} unit=" MB" icon={<Cpu />} />
      </div>
      <Panel title="Service registry" action={<span className="system-status-source"><i />{data.sourceLabel}</span>}>
        <div className="system-service-grid">{services.map((service) => <ServiceCard key={service.key} service={service} />)}</div>
      </Panel>
      <div className="two-one-grid system-status-lower">
        <Panel title="Connection metrics"><div className="system-connection-grid"><span><b>WEBSOCKET CLIENTS</b><strong>{data.connection.websocketClients}</strong><small>Connected Socket.IO sessions</small></span><span><b>PROCESS UPTIME</b><strong>{formatUptime(data.connection.uptimeSeconds)}</strong><small>Since the API process started</small></span><span><b>NODE RUNTIME</b><strong>{data.connection.nodeVersion}</strong><small>Backend execution runtime</small></span><span><b>MEMORY RSS</b><strong>{data.connection.memoryRssMb} MB</strong><small>Resident process memory</small></span></div></Panel>
        <Panel title="Operational note"><div className="system-status-note"><Radio /><div><b>Demo adapters are labeled</b><p>Drone link, AI/ML, media storage and MQTT are intentionally marked SIMULATED or NOT CONFIGURED until real integrations are added.</p></div></div></Panel>
      </div>
    </>}
  </>;
}

function ServiceCard({ service }: { service: SystemService }) {
  const Icon = serviceIcons[service.key] ?? Activity;
  return <article className={`system-service-card ${service.status.toLowerCase()}`}><header><span className="system-service-icon"><Icon /></span><div><b>{service.label}</b><small>{service.key}</small></div><StatusBadge status={service.status} /></header><p>{service.detail}</p>{service.latencyMs != null && <small className="system-service-latency">{service.latencyMs} ms health ping</small>}</article>;
}
