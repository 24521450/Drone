import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, GripVertical, MapPinned, Play, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Empty, Metric, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, errorMessage, formatDuration, socket } from "../lib";
import { MissionEditorMap } from "../operation-maps";
import type { Coordinate, Drone, Geofence, Mission, MissionInspection, MissionTemplate, MissionTemplateType, Waypoint } from "../types";
import { estimateMission, insideFence } from "../mission-utils";

const HOME = { latitude: 10.762622, longitude: 106.660172 };
const normalize = (items: Waypoint[]) => items.map((item, order) => ({ ...item, order }));

export default function Missions() { const { id } = useParams(); return id === "new" || id ? <MissionEditor id={id === "new" ? undefined : id} /> : <MissionList />; }

function MissionList() {
  const { user } = useAuth(); const { notify, confirm } = useFeedback(); const navigate = useNavigate();
  const [items, setItems] = useState<Mission[]>([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState("ALL"); const [loading, setLoading] = useState(true); const [page, setPage] = useState(1); const [meta, setMeta] = useState({ page: 1, pages: 0, total: 0 }); const [busyMissionId, setBusyMissionId] = useState<string>();
  const requestRef = useRef<AbortController | null>(null);
  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const response = await api.get("/missions", { params: { search, status, page, limit: 20 }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems(response.data.data);
      setMeta(response.data.meta);
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") notify(errorMessage(reason), "error");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };
  useEffect(() => { setPage(1); }, [search, status]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => { window.clearTimeout(timer); requestRef.current?.abort(); }; }, [search, status, page]);
  useEffect(() => {
    const refresh = () => { void load(); };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("mission:updated", refresh);
    socket.on("mission:status", refresh);
    socket.on("mission:schedule", refresh);
    socket.on("drone:updated", refresh);
    socket.on("geofence:updated", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => { socket.off("mission:updated", refresh); socket.off("mission:status", refresh); socket.off("mission:schedule", refresh); socket.off("drone:updated", refresh); socket.off("geofence:updated", refresh); socket.off("connect", refresh); };
  }, [search, status, page]);
  const duplicate = async (item: Mission) => { if (busyMissionId) return; setBusyMissionId(item._id); try { if (!await confirm({ title: "Duplicate mission", message: `Create an editable copy of ${item.name}?`, confirmLabel: "Duplicate" })) return; const response = await api.post(`/missions/${item._id}/duplicate`); notify("Mission duplicated", "success"); navigate(`/missions/${response.data.data._id}`); } catch (e) { notify(errorMessage(e), "error"); } finally { setBusyMissionId(undefined); } };
  return <><PageTitle eyebrow="AUTONOMY" title="Mission planner" text="Build reusable waypoint missions and launch them on the simulator." action={user?.role === "ADMIN" && <Link className="primary" to="/missions/new"><Plus />New mission</Link>} />
    <Panel><div className="toolbar"><div className="search"><input aria-label="Search missions" placeholder="Search missions…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><span className="result-count">{meta.total} missions</span><select aria-label="Mission status" value={status} onChange={(e) => setStatus(e.target.value)}><option>ALL</option><option>READY</option><option>RUNNING</option><option>PAUSED</option><option>COMPLETED</option><option>FAILED</option><option>CANCELLED</option></select></div><div className="table-wrap"><table><thead><tr><th>Mission</th><th>Aircraft</th><th>Geofence</th><th>Waypoints</th><th>Created</th><th>Status</th><th>Schedule</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item._id}><td><Link className="row-link" to={`/missions/${item._id}`}>{item.name}</Link></td><td>{typeof item.droneId === "string" ? "—" : item.droneId.droneCode}</td><td>{!item.geofenceId ? "None" : typeof item.geofenceId === "string" ? "Assigned" : item.geofenceId.name}</td><td>{item.waypoints.length}</td><td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}</td><td><StatusBadge status={item.status} /></td><td>{item.scheduleStatus && item.scheduleStatus !== "NONE" ? <StatusBadge status={item.scheduleStatus} /> : <span className="table-sub">—</span>}</td><td>{user?.role === "ADMIN" && <button className="icon-btn" title="Duplicate" onClick={() => duplicate(item)}><Copy /></button>}</td></tr>)}</tbody></table>{loading ? <div className="loading">Loading missions…</div> : !items.length && <Empty title="No missions found" text="Create a route or adjust the filters." />}</div><div className="pagination"><button className="secondary small" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {meta.page} of {Math.max(meta.pages, 1)}</span><button className="secondary small" disabled={page >= meta.pages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></Panel></>;
}

function MissionEditor({ id }: { id?: string }) {
  const { user } = useAuth(); const { notify, confirm } = useFeedback(); const navigate = useNavigate();
  const [name, setName] = useState(""); const [droneId, setDroneId] = useState(""); const [geofenceId, setGeofenceId] = useState(""); const [home, setHome] = useState<Coordinate>(HOME);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]); const [undoStack, setUndoStack] = useState<Waypoint[][]>([]); const [status, setStatus] = useState("DRAFT"); const [scheduleStatus, setScheduleStatus] = useState<Mission["scheduleStatus"]>("NONE"); const [scheduleError, setScheduleError] = useState("");
  const [drones, setDrones] = useState<Drone[]>([]); const [geofences, setGeofences] = useState<Geofence[]>([]); const [busy, setBusy] = useState(false); const [templateBusy, setTemplateBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [dragged, setDragged] = useState<number>();
  const [templates, setTemplates] = useState<MissionTemplate[]>([]); const [templateType, setTemplateType] = useState<MissionTemplateType>("GRID_SURVEY"); const [templateSize, setTemplateSize] = useState(120); const [templateAltitude, setTemplateAltitude] = useState(40); const [templateSpeed, setTemplateSpeed] = useState(7);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    Promise.all([api.get("/drones", { signal: controller.signal }), api.get("/geofences", { signal: controller.signal }), api.get("/mission-templates", { signal: controller.signal }), id ? api.get(`/missions/${id}`, { signal: controller.signal }) : Promise.resolve(null)])
      .then(([d, g, t, m]) => {
        if (controller.signal.aborted) return;
        setDrones(d.data.data); setGeofences(g.data.data); setTemplates(t.data.data);
        if (!id) setDroneId(d.data.data[0]?._id ?? "");
        if (m) { const item: Mission = m.data.data; setName(item.name); setDroneId(typeof item.droneId === "string" ? item.droneId : item.droneId._id); setGeofenceId(!item.geofenceId ? "" : typeof item.geofenceId === "string" ? item.geofenceId : item.geofenceId._id); setHome(item.homePosition); setWaypoints(item.waypoints); setStatus(item.status); setScheduleStatus(item.scheduleStatus ?? "NONE"); setScheduleError(item.scheduleError ?? ""); }
      })
      .catch((reason: any) => { if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError") setError(errorMessage(reason)); })
      .finally(() => { if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setLoading(false); } });
    return () => { controller.abort(); if (requestRef.current === controller) requestRef.current = null; };
  }, [id]);
  const fence = geofences.find((g) => g._id === geofenceId); const invalidIndexes = waypoints.map((p, i) => insideFence(p, fence) ? -1 : i).filter((i) => i >= 0);
  const estimate = useMemo(() => estimateMission(home, waypoints), [home, waypoints]);
  const remember = () => setUndoStack((stack) => [...stack.slice(-19), waypoints.map((point) => ({ ...point }))]); const replace = (next: Waypoint[]) => { remember(); setWaypoints(normalize(next)); };
  const add = (point: Coordinate) => replace([...waypoints, { ...point, order: waypoints.length, altitude: 35, speed: 6 }]); const update = (index: number, values: Partial<Waypoint>, track = false) => { if (track) remember(); setWaypoints((items) => items.map((item, i) => i === index ? { ...item, ...values } : item)); };
  const undo = () => setUndoStack((stack) => { const previous = stack.at(-1); if (previous) setWaypoints(previous); return stack.slice(0, -1); }); const reorder = (from: number, to: number) => { if (from === to) return; const next = [...waypoints]; const [item] = next.splice(from, 1); next.splice(to, 0, item); replace(next); };
  const applyTemplate = async () => { if (templateBusy || busy || loading || user?.role !== "ADMIN") return; setTemplateBusy(true); setError(""); try { if (waypoints.length && !await confirm({ title: "Replace current route", message: "Applying a template replaces the current waypoint list. You can still use Undo.", confirmLabel: "Apply template" })) return; const response = await api.post("/mission-templates/generate", { type: templateType, center: home, sizeMeters: templateSize, altitude: templateAltitude, speed: templateSpeed }); replace(response.data.data.waypoints); if (!name) setName(templates.find((item) => item.type === templateType)?.name ?? "Generated mission"); notify("Mission template applied", "success"); } catch (reason) { setError(errorMessage(reason)); } finally { setTemplateBusy(false); } };
  const save = async () => { if (busy || loading || user?.role !== "ADMIN") return; setBusy(true); setError(""); try { const body = { name, droneId, geofenceId: geofenceId || null, homePosition: home, waypoints: normalize(waypoints) }; const response = id ? await api.patch(`/missions/${id}`, body) : await api.post("/missions", body); notify("Mission saved", "success"); navigate(`/missions/${response.data.data._id}`, { replace: true }); setStatus(response.data.data.status); setScheduleStatus(response.data.data.scheduleStatus ?? "NONE"); setScheduleError(response.data.data.scheduleError ?? ""); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const start = async () => { if (!id || busy || loading || user?.role !== "ADMIN") return; setBusy(true); setError(""); try { const result: MissionInspection = (await api.post(`/missions/${id}/validate`)).data.data; if (!result.valid) { setError(result.issues.map((issue) => issue.message).join(" · ")); return; } if (!await confirm({ title: "Launch mission", message: `${result.estimate.distanceMeters} m · ${formatDuration(result.estimate.durationSeconds)} estimated. Launch now?`, confirmLabel: "Launch" })) return; await api.post(`/missions/${id}/start`); notify("Mission launched", "success"); navigate("/command-center"); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const archive = async () => { if (!id || busy || loading || user?.role !== "ADMIN") return; setBusy(true); setError(""); try { if (!await confirm({ title: "Archive mission", message: "The mission will be hidden from the active list.", confirmLabel: "Archive", danger: true })) return; await api.delete(`/missions/${id}`); notify("Mission archived", "success"); navigate("/missions"); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const scheduleLocked = ["SCHEDULED", "PROCESSING"].includes(scheduleStatus ?? "NONE");
  useEffect(() => {
    if (!id) return;
    const scheduleNotice = "This mission is queued for automatic launch. Cancel it in Flight Schedule before editing.";
    const scheduleUpdate = (payload: any) => {
      const entries = Array.isArray(payload) ? payload : [payload];
      const event = entries.find((item: any) => String(item?.missionId ?? item?._id) === id);
      if (!event?.status) return;
      const normalizedStatus = event.status === "WAITING" ? "SCHEDULED" : event.status;
      if (["SCHEDULED", "PROCESSING", "STARTED", "FAILED", "CANCELLED", "NONE"].includes(normalizedStatus)) setScheduleStatus(normalizedStatus as Mission["scheduleStatus"]);
      if (event.status === "WAITING") setScheduleError(event.error ?? "Waiting for assigned drone to become available");
      else if (event.status === "FAILED") setScheduleError(event.error ?? "Unable to start scheduled mission");
      else if (["SCHEDULED", "STARTED", "CANCELLED", "NONE"].includes(event.status)) setScheduleError("");
      if (event.status === "STARTED") setStatus("RUNNING");
      if (event.status === "CANCELLED") setStatus("READY");
    };
    const missionStatus = (payload: { missionId?: string; status?: string }) => { if (String(payload?.missionId) === id && payload.status) setStatus(payload.status); };
    const missionUpdated = (payload: Mission) => { if (String(payload?._id) !== id) return; setStatus(payload.status); setScheduleStatus(payload.scheduleStatus ?? "NONE"); setScheduleError(payload.scheduleError ?? ""); };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("mission:schedule", scheduleUpdate);
    socket.on("mission:status", missionStatus);
    socket.on("mission:updated", missionUpdated);
    if (!socket.connected) socket.connect();
    return () => { socket.off("mission:schedule", scheduleUpdate); socket.off("mission:status", missionStatus); socket.off("mission:updated", missionUpdated); };
  }, [id]);
  useEffect(() => {
    const scheduleNotice = "This mission is queued for automatic launch. Cancel it in Flight Schedule before editing.";
    setError((current) => scheduleLocked ? scheduleNotice : current === scheduleNotice ? "" : current);
  }, [scheduleLocked]);
  const locked = loading || busy || templateBusy || scheduleLocked || ["RUNNING", "PAUSED"].includes(status) || user?.role !== "ADMIN"; const canSave = !locked && waypoints.length >= 2 && !!name && invalidIndexes.length === 0;
  return <><PageTitle eyebrow="MISSION EDITOR" title={id ? name || "Mission" : "New mission"} text="Click the map to add points. Drag markers or waypoint rows to revise the route." action={<div className="action-row"><Link className="secondary" to="/missions">Back</Link><button className="secondary" onClick={undo} disabled={!undoStack.length || locked}><RotateCcw />Undo</button>{id && user?.role === "ADMIN" && <button className="stop" onClick={archive} disabled={locked}><Trash2 />Archive</button>}<button className="primary" onClick={save} disabled={!canSave}><Save />Save</button>{id && <button className="primary launch" onClick={start} disabled={locked || busy || invalidIndexes.length > 0}><Play />Start mission</button>}</div>} />
    {error && <div className="form-error page-error">{error}</div>}{scheduleError && scheduleError !== error && <div className="form-error page-error">{scheduleError}</div>}{invalidIndexes.length > 0 && <div className="form-error page-error">Move highlighted waypoints inside the selected geofence before saving.</div>}<div className="metric-grid mission-estimate"><Metric label="EST. DISTANCE" value={estimate.distanceMeters} unit="m" /><Metric label="EST. DURATION" value={formatDuration(estimate.durationSeconds)} /><Metric label="EST. BATTERY" value={estimate.batteryPercent} unit="%" /><Metric label="WAYPOINTS" value={waypoints.length} /></div>
    <div className="editor-layout"><Panel title="Route canvas" action={<StatusBadge status={status} />}><MissionEditorMap home={home} waypoints={waypoints} geofence={fence} invalidIndexes={invalidIndexes} interactive={!locked} onAdd={add} onMove={(i, p) => update(i, p, true)} /></Panel><Panel title="Mission setup"><div className="editor-form"><label>Mission name<input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} placeholder="Campus inspection" /></label><label>Aircraft<select value={droneId} onChange={(e) => setDroneId(e.target.value)} disabled={locked}>{drones.map((d) => <option key={d._id} value={d._id}>{d.droneCode} · {d.name}</option>)}</select></label><label>Safety geofence<select value={geofenceId} onChange={(e) => { setGeofenceId(e.target.value); const next = geofences.find((x) => x._id === e.target.value); if (next) setHome(next.homePosition); }} disabled={locked}><option value="">No geofence</option>{geofences.filter((g) => g.isActive).map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}</select></label><div className="coordinate-note"><MapPinned />Home: {home.latitude.toFixed(5)}, {home.longitude.toFixed(5)}</div></div><div className="template-builder"><h3><Sparkles />Route template</h3><select value={templateType} onChange={(e) => setTemplateType(e.target.value as MissionTemplateType)} disabled={locked}>{templates.map((template) => <option key={template.type} value={template.type}>{template.name}</option>)}</select><div><label>SIZE M<input type="number" min="20" max="1000" value={templateSize} onChange={(e) => setTemplateSize(Number(e.target.value))} disabled={locked} /></label><label>ALT M<input type="number" min="10" max="150" value={templateAltitude} onChange={(e) => setTemplateAltitude(Number(e.target.value))} disabled={locked} /></label><label>SPEED<input type="number" min="1" max="20" value={templateSpeed} onChange={(e) => setTemplateSpeed(Number(e.target.value))} disabled={locked} /></label></div><small>{templates.find((template) => template.type === templateType)?.description}</small><button className="secondary" disabled={locked} onClick={applyTemplate}><Sparkles />Generate route</button></div><h3 className="subheading">WAYPOINTS ({waypoints.length})</h3><div className="waypoint-list">{waypoints.map((point, index) => <div className={`waypoint ${invalidIndexes.includes(index) ? "invalid" : ""}`} key={index} draggable={!locked} onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged != null) reorder(dragged, index); setDragged(undefined); }}><GripVertical className="drag-handle" /><b>{index + 1}</b><div><small>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</small><span><label>ALT <input type="number" min="10" max="150" value={point.altitude} onChange={(e) => update(index, { altitude: Number(e.target.value) })} disabled={locked} /></label><label>SPEED <input type="number" min="1" max="20" value={point.speed} onChange={(e) => update(index, { speed: Number(e.target.value) })} disabled={locked} /></label></span></div><aside><button className="icon-btn danger-text" onClick={() => replace(waypoints.filter((_, i) => i !== index))} disabled={locked}><Trash2 /></button></aside></div>)}{!waypoints.length && <Empty title="Empty route" text="Click anywhere on the map or apply a route template." />}</div></Panel></div></>;
}
