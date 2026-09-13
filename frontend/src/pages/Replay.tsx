import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Metric, PageTitle, Panel, StatusBadge } from "../components";
import { api, errorMessage, missionProgressLabel } from "../lib";
import { ReplayEventMap as ReplayEventMapBase } from "../operation-maps";
import type { Alert, Command, Coordinate, Flight, Geofence, Mission, Telemetry } from "../types";

export default function Replay() {
  const { id } = useParams(); const [flight, setFlight] = useState<Flight>(); const [points, setPoints] = useState<Telemetry[]>([]); const [alerts, setAlerts] = useState<Alert[]>([]); const [commands, setCommands] = useState<Command[]>([]); const [index, setIndex] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); setFlight(undefined); setError(""); api.get(`/flights/${id}/replay`, { signal: controller.signal }).then((r) => { if (controller.signal.aborted) return; setFlight(r.data.data.flight); setPoints(r.data.data.telemetry); setAlerts(r.data.data.alerts); setCommands(r.data.data.commands); setIndex(0); }).catch((reason) => { if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") setError(errorMessage(reason)); }); return () => controller.abort(); }, [id]);
  useEffect(() => { if (!playing || !points.length) return; const timer = window.setInterval(() => setIndex((current) => { if (current >= points.length - 1) { setPlaying(false); return current; } return current + 1; }), 1000 / speed); return () => clearInterval(timer); }, [playing, speed, points.length]);
  const current = points[index];
  const events = useMemo(() => [...alerts.map((alert) => ({ time: alert.occurredAt, title: alert.type.replaceAll("_", " "), detail: alert.message, status: alert.severity })), ...commands.map((command) => ({ time: command.requestedAt, title: command.type.replaceAll("_", " "), detail: `${command.source} command`, status: command.status }))].sort((a, b) => +new Date(a.time) - +new Date(b.time)), [alerts, commands]);
  const mission = flight && typeof flight.missionId === "object" ? flight.missionId as Mission : undefined;
  const geofence = mission && mission.geofenceId && typeof mission.geofenceId === "object" ? mission.geofenceId as Geofence : undefined;
  const ReplayEventMap = useMemo(
    () =>
      (props: ComponentProps<typeof ReplayEventMapBase>) => (
        <ReplayEventMapBase
          {...props}
          geofences={geofence ? [geofence] : []}
        />
      ),
    [geofence?._id],
  );
  const planned: Coordinate[] = mission ? [mission.homePosition, ...[...mission.waypoints].sort((a, b) => a.order - b.order), mission.homePosition] : [];
    const mapEvents = alerts.filter((alert) => alert.latitude != null && alert.longitude != null).map((alert) => ({ latitude: alert.latitude!, longitude: alert.longitude!, label: alert.type.replaceAll("_", " "), severity: alert.severity, time: alert.occurredAt }));
  const jumpTo = (time: string) => { if (!points.length) return; let nearest = 0; let difference = Infinity; points.forEach((point, pointIndex) => { const next = Math.abs(+new Date(point.timestamp) - +new Date(time)); if (next < difference) { difference = next; nearest = pointIndex; } }); setIndex(nearest); setPlaying(false); };
  if (error) return <><Link to="/history" className="secondary">Flight history</Link><div className="form-error page-error">{error}</div></>;
  if (!flight) return <div className="loading">Loading replay…</div>;
  return <><PageTitle eyebrow="FLIGHT REPLAY" title={flight.flightCode} text="Compare planned and actual routes with synchronized telemetry and events." action={<Link className="secondary" to={`/history/${id}`}>Flight record</Link>} />
    <div className="metric-grid"><Metric label="BATTERY" value={current?.battery ?? "—"} unit={current ? "%" : ""} /><Metric label="ALTITUDE" value={current?.altitude ?? "—"} unit={current ? "m" : ""} /><Metric label="SPEED" value={current?.speed ?? "—"} unit={current ? "m/s" : ""} /><Metric label="HEADING" value={current ? Math.round(current.heading ?? 0) : "—"} unit={current ? "°" : ""} /><Metric label="WAYPOINT" value={missionProgressLabel(current?.waypointIndex, current?.waypointCount, current?.flightPhase)} /><Metric label="PHASE" value={current?.flightPhase ?? "—"} /></div>
    <div className="replay-layout"><div><Panel title="Recorded route" action={<div className="map-legend"><span><i className="planned" />PLANNED</span><span><i />ACTUAL</span><StatusBadge status={playing ? "PLAYING" : "PAUSED"} /></div>}><ReplayEventMap points={points} index={index} home={flight.homePosition} planned={planned} events={mapEvents} /><div className="replay-controls"><button className="icon-btn" title="Restart" onClick={() => { setIndex(0); setPlaying(false); }}><RotateCcw /></button><button className="primary" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}{playing ? "Pause" : "Play"}</button><input aria-label="Replay position" className="replay-slider" type="range" min="0" max={Math.max(points.length - 1, 0)} value={index} onChange={(e) => { setIndex(Number(e.target.value)); setPlaying(false); }} /><span>{index + 1} / {points.length}</span><select aria-label="Replay speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select></div></Panel><Panel title="Synchronized telemetry"><div className="chart replay-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points}><CartesianGrid stroke="#202a36" vertical={false} /><XAxis dataKey="sequence" stroke="#64748b" tickLine={false} /><YAxis stroke="#64748b" tickLine={false} /><Tooltip contentStyle={{ background: "#111822", border: "1px solid #273140", borderRadius: 8 }} /><Area dataKey="altitude" stroke="#60a5fa" fill="#3b82f626" /><Area dataKey="battery" stroke="#4ade80" fill="transparent" /><ReferenceLine x={current?.sequence} stroke="#f8fafc" strokeDasharray="3 3" /></AreaChart></ResponsiveContainer></div></Panel></div>
      <Panel title="Event timeline"><div className="timeline">{events.map((event, eventIndex) => <button className="timeline-event" key={`${event.time}-${eventIndex}`} onClick={() => jumpTo(event.time)}><i /><div><small>{new Date(event.time).toLocaleTimeString()}</small><b>{event.title}</b><span>{event.detail}</span></div><StatusBadge status={event.status} /></button>)}{!events.length && <div className="empty">No alerts or commands during this flight.</div>}</div></Panel></div></>;
}
