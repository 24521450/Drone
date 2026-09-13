import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, Battery, Box, CheckCircle2, CircleX, Cpu, Fingerprint, Gauge, Plane, Radio, Satellite } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Empty, Metric, PageTitle, Panel, StatusBadge } from "../components";
import { api, errorMessage, socket } from "../lib";
import type { Drone, DroneHealth, DroneReadiness, Flight, MaintenanceTask, Telemetry } from "../types";

export default function DroneDetail() {
  const { id } = useParams();
  const [drone, setDrone] = useState<Drone | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [flightTotal, setFlightTotal] = useState(0);
  const [readiness, setReadiness] = useState<DroneReadiness | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceTask[]>([]);
  const [health, setHealth] = useState<DroneHealth | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const activeFlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeFlightIdRef.current = drone?.activeFlightId ? String(drone.activeFlightId) : null;
  }, [drone?.activeFlightId]);

  const load = async () => {
    if (!id) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const [droneResponse, flightResponse, readinessResponse, maintenanceResponse, healthResponse] = await Promise.all([
        api.get(`/drones/${id}`, { signal: controller.signal }),
        api.get("/flights", { params: { droneId: id, limit: 10 }, signal: controller.signal }),
        api.get(`/drones/${id}/readiness`, { signal: controller.signal }),
        api.get("/maintenance", { params: { droneId: id, limit: 5 }, signal: controller.signal }),
        api.get("/maintenance/health", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setDrone(droneResponse.data.data);
      setFlights(flightResponse.data.data);
      setFlightTotal(flightResponse.data.meta?.total ?? flightResponse.data.data.length);
      setReadiness(readinessResponse.data.data);
      setMaintenance(maintenanceResponse.data.data);
      setHealth((healthResponse.data.data.items as DroneHealth[]).find((item) => item.drone._id === id) ?? null);
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") setError(errorMessage(reason));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };

  useEffect(() => {
    setDrone(null);
    void load();
    return () => { requestRef.current?.abort(); };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const refresh = () => { void load(); };
    const subscribe = () => socket.emit("subscribe:drone", id);
    const telemetry = (payload: Telemetry) => {
      if (String(payload.droneId) !== id) return;
      if (!activeFlightIdRef.current || String(payload.flightId) !== activeFlightIdRef.current) return;
      setTelemetry(payload);
      setDrone((current) => current ? { ...current, battery: payload.battery, lastSeen: payload.timestamp, status: "IN_FLIGHT" } : current);
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("drone:updated", refresh);
    socket.on("flight:status", refresh);
    socket.on("maintenance:updated", refresh);
    socket.on("command:status", refresh);
    socket.on("telemetry:update", telemetry);
    socket.on("connect", subscribe);
    if (!socket.connected) socket.connect();
    subscribe();
    return () => { socket.off("drone:updated", refresh); socket.off("flight:status", refresh); socket.off("maintenance:updated", refresh); socket.off("command:status", refresh); socket.off("telemetry:update", telemetry); socket.off("connect", subscribe); socket.emit("unsubscribe:drone", id); };
  }, [id]);

  const activeFlightId = flights.find((flight) => flight.status === "ACTIVE")?._id;
  useEffect(() => {
    if (!activeFlightId) {
      setTelemetry(null);
      return;
    }
    const controller = new AbortController();
    api.get(`/flights/${activeFlightId}/telemetry`, { params: { limit: 1 }, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setTelemetry(response.data.data.at(-1) ?? null);
      })
      .catch((reason: any) => {
        if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") setTelemetry(null);
      });
    return () => controller.abort();
  }, [activeFlightId]);

  if (error && !drone) return <><Link to="/drones" className="back-link"><ArrowLeft />Back to fleet</Link><div className="form-error page-error">{error}</div></>;
  if (!drone) return <div className="loading">{loading ? "Loading aircraft..." : "Aircraft unavailable"}</div>;
  return <><Link to="/drones" className="back-link"><ArrowLeft />Back to fleet</Link><PageTitle eyebrow="AIRCRAFT PROFILE" title={drone.droneCode} text={`${drone.name} · ${drone.model}`} action={<StatusBadge status={drone.status} />} />
    {error && <div className="form-error page-error">{error}</div>}
    <div className="metric-grid"><Metric label="BATTERY" value={Math.round(drone.battery)} unit="%" icon={<Battery />} /><Metric label="HEALTH SCORE" value={health?.score ?? "—"} unit="/100" icon={<Gauge />} /><Metric label="MODEL" value={drone.model} icon={<Plane />} /><Metric label="FIRMWARE" value={drone.firmware} icon={<Cpu />} /><Metric label="TOTAL FLIGHTS" value={flightTotal} icon={<Box />} /></div>
    <div className="two-one-grid"><Panel title="Aircraft information"><div className="details"><div><Fingerprint /><span>Serial number</span><b>{drone.serialNumber}</b></div><div><Cpu /><span>Firmware version</span><b>{drone.firmware}</b></div><div><Plane /><span>Current status</span><b>{drone.status.replaceAll("_", " ")}</b></div><div><Battery /><span>Last telemetry</span><b>{drone.lastSeen ? new Date(drone.lastSeen).toLocaleString() : "Never"}</b></div></div></Panel><Panel title="Live telemetry" action={telemetry ? <StatusBadge status={telemetry.flightPhase ?? "LIVE"} /> : undefined}><div className="telemetry-snapshot">{telemetry ? <><span><Activity /><b>ALTITUDE</b><strong>{telemetry.altitude.toFixed(1)} m</strong></span><span><Radio /><b>SPEED</b><strong>{telemetry.speed.toFixed(1)} m/s</strong></span><span><Satellite /><b>GPS</b><strong>{telemetry.gpsSatellites} sats</strong></span><span><Gauge /><b>SIGNAL</b><strong>{Math.round(telemetry.signal)}%</strong></span></> : <Empty title="No live stream" text="Start a flight to see telemetry for this aircraft." />}</div></Panel></div>
    <div className="two-one-grid"><Panel title="Preflight readiness" action={readiness && <StatusBadge status={readiness.ready ? "READY" : "BLOCKED"} />}><div className="readiness-grid aircraft-readiness">{readiness?.checks.map((check) => <div key={check.key} className={check.status.toLowerCase()}>{check.status === "PASS" ? <CheckCircle2 /> : check.status === "WARN" ? <AlertTriangle /> : <CircleX />}<span><b>{check.label}</b><small>{check.message}</small></span></div>)}</div></Panel><Panel title="Maintenance" action={<Link to="/maintenance" className="text-link">Service center</Link>}><div className="simple-list">{maintenance.map((task) => <div key={task._id}><div><b>{task.type.replaceAll("_", " ")}</b><small>{new Date(task.scheduledFor).toLocaleString()}</small></div><StatusBadge status={task.status} /></div>)}{!maintenance.length && <Empty title="No maintenance" text="No service records for this aircraft." />}</div></Panel></div>
  </>;
}
