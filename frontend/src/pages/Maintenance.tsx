import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, CalendarPlus, Check, Clock3, Download, Gauge, Play, Wrench, X } from "lucide-react";
import { useAuth } from "../auth";
import { Empty, Metric, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, formatDuration, isCanceledRequest, socket } from "../lib";
import { Link } from "react-router-dom";
import type { Drone, DroneHealth, MaintenanceStatus, MaintenanceTask, MaintenanceType } from "../types";

const tomorrowLocal = () => { const date = new Date(Date.now() + 86_400_000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
const blank = { droneId: "", type: "INSPECTION" as MaintenanceType, scheduledFor: tomorrowLocal(), notes: "" };
const TASK_PAGE_SIZE = 25;

export default function Maintenance() {
  const { user } = useAuth(); const { notify, confirm } = useFeedback();
  const [health, setHealth] = useState<DroneHealth[]>([]); const [summary, setSummary] = useState({ healthy: 0, watch: 0, serviceDue: 0, averageScore: 0 });
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]); const [drones, setDrones] = useState<Drone[]>([]);
  const [status, setStatus] = useState("ALL"); const [filterDroneId, setFilterDroneId] = useState(""); const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [taskPage, setTaskPage] = useState(1); const [taskPages, setTaskPages] = useState(0); const [taskTotal, setTaskTotal] = useState(0); const [exporting, setExporting] = useState(false); const [open, setOpen] = useState(false); const [form, setForm] = useState(blank); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [busyTaskId, setBusyTaskId] = useState<string>(); const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError("");
    try {
      const [healthResponse, taskResponse, droneResponse] = await Promise.all([api.get("/maintenance/health", { signal: controller.signal }), api.get("/maintenance", { params: { status, droneId: filterDroneId, dateFrom, dateTo, timezoneOffsetMinutes: new Date().getTimezoneOffset(), page: taskPage, limit: TASK_PAGE_SIZE }, signal: controller.signal }), api.get("/drones", { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const total = taskResponse.data.meta?.total ?? taskResponse.data.data.length;
      const pages = taskResponse.data.meta?.pages ?? 0;
      setHealth(healthResponse.data.data.items); setSummary(healthResponse.data.data.summary); setTaskTotal(total); setTaskPages(pages); setDrones(droneResponse.data.data);
      if (taskPage > Math.max(pages, 1)) { setTasks([]); setTaskPage(Math.max(pages, 1)); return; }
      setTasks(taskResponse.data.data);
    } catch (reason: any) { if (!isCanceledRequest(reason)) setError(errorMessage(reason)); } finally { if (requestRef.current === controller) { requestRef.current = null; if (!controller.signal.aborted) setLoading(false); } }
  };
  useEffect(() => { setTaskPage(1); }, [status, filterDroneId, dateFrom, dateTo]);
  useEffect(() => { void load(); return () => requestRef.current?.abort(); }, [status, filterDroneId, dateFrom, dateTo, taskPage]);
  useEffect(() => { const refresh = () => { void load(); }; socket.auth = { token: localStorage.getItem("drone-token") }; socket.on("maintenance:updated", refresh); socket.on("flight:status", refresh); socket.on("connect", refresh); if (!socket.connected) socket.connect(); return () => { socket.off("maintenance:updated", refresh); socket.off("flight:status", refresh); socket.off("connect", refresh); }; }, [status, filterDroneId, dateFrom, dateTo, taskPage]);

  const schedule = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return; setError(""); setSaving(true);
    try { await api.post("/maintenance", { ...form, scheduledFor: new Date(form.scheduledFor).toISOString() }); setOpen(false); setForm(blank); notify("Maintenance scheduled", "success"); await load(); } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };
  const updateStatus = async (task: MaintenanceTask, next: MaintenanceStatus) => {
    if (busyTaskId) return;
    setBusyTaskId(task._id);
    try {
      if ((next === "CANCELLED" || next === "COMPLETED") && !await confirm({ title: next === "COMPLETED" ? "Complete maintenance" : "Cancel maintenance", message: `${task.type.replaceAll("_", " ")} for ${typeof task.droneId === "string" ? "this drone" : task.droneId.droneCode} will be marked ${next.toLowerCase()}.`, confirmLabel: next === "COMPLETED" ? "Complete" : "Cancel", danger: next === "CANCELLED" })) return;
      await api.patch(`/maintenance/${task._id}`, { status: next }); notify(`Maintenance ${next.toLowerCase().replace("_", " ")}`, "success"); await load();
    } catch (reason) { notify(errorMessage(reason), "error"); } finally { setBusyTaskId(undefined); }
  };

  const exportAll = async () => {
    if (!taskTotal || loading || exporting || saving || busyTaskId) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/maintenance/export", {
        params: {
          status,
          droneId: filterDroneId,
          dateFrom,
          dateTo,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        },
        responseType: "blob",
      });
      downloadBlob(
        `maintenance-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${taskTotal} maintenance records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Maintenance export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return <>
    <PageTitle eyebrow="RELIABILITY" title="Fleet health & maintenance" text="Prioritize service using recent telemetry, flight outcomes and safety events." action={<div className="action-row"><button className="secondary" onClick={() => void exportAll()} disabled={!taskTotal || loading || exporting || saving || !!busyTaskId}><Download />{exporting ? "Exporting..." : "Export all matching"}</button>{user?.role === "ADMIN" && <button className="primary" onClick={() => setOpen(true)}><CalendarPlus />Schedule maintenance</button>}</div>} />
    {error && !open && <div className="form-error page-error">{error}</div>}
    <div className="metric-grid"><Metric label="AVERAGE HEALTH" value={summary.averageScore} unit="/100" icon={<Gauge />} /><Metric label="HEALTHY" value={summary.healthy} icon={<Check />} /><Metric label="WATCH" value={summary.watch} icon={<Activity />} /><Metric label="SERVICE DUE" value={summary.serviceDue} icon={<Wrench />} /></div>
    <Panel title="Aircraft health — last 30 days"><div className="health-grid">{health.map((item) => <article className="health-card" key={item.drone._id}><header><div className={`health-score ${item.status.toLowerCase()}`}><b>{item.score}</b><small>/100</small></div><div><strong>{item.drone.droneCode}</strong><span>{item.drone.name} · {item.drone.model}</span></div><StatusBadge status={item.status} /></header><div className="health-metrics"><span><b>{item.metrics.flights}</b>Flights</span><span><b>{formatDuration(item.metrics.durationSeconds)}</b>Air time</span><span><b>{item.metrics.criticalAlerts + item.metrics.warningAlerts}</b>Alerts</span><span><b>{item.metrics.openMaintenance}</b>Open tasks</span></div><ul>{item.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul><Link className="health-card-link" to={`/drones/${item.drone._id}`}>View aircraft</Link></article>)}{!loading && !health.length && <Empty title="No active aircraft" text="Register a drone to begin health monitoring." />}</div></Panel>
    <Panel title="Maintenance tasks"><div className="toolbar maintenance-filters"><span className="history-label"><Clock3 />Service schedule</span><select aria-label="Maintenance status" value={status} onChange={(event) => setStatus(event.target.value)}><option>ALL</option><option>SCHEDULED</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>CANCELLED</option></select><select aria-label="Maintenance aircraft" value={filterDroneId} onChange={(event) => setFilterDroneId(event.target.value)}><option value="">All aircraft</option>{drones.map((drone) => <option key={drone._id} value={drone._id}>{drone.droneCode}</option>)}</select><label>FROM<input aria-label="Maintenance date from" type="date" max={dateTo || undefined} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>TO<input aria-label="Maintenance date to" type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><span className="result-count">{taskTotal} tasks</span></div><div className="table-wrap"><table><thead><tr><th>Scheduled</th><th>Aircraft</th><th>Service</th><th>Notes</th><th>Status</th><th /></tr></thead><tbody>{tasks.map((task) => { const taskBusy = busyTaskId === task._id; return <tr key={task._id}><td>{new Date(task.scheduledFor).toLocaleString()}</td><td>{typeof task.droneId === "string" ? "—" : <><b>{task.droneId.droneCode}</b><small className="table-sub">{task.droneId.name}</small></>}</td><td>{task.type.replaceAll("_", " ")}</td><td>{task.notes || "—"}</td><td><StatusBadge status={task.status} /></td><td>{user?.role === "ADMIN" && <div className="row-actions maintenance-actions">{task.status === "SCHEDULED" && <button className="secondary small" disabled={!!busyTaskId} onClick={() => updateStatus(task, "IN_PROGRESS")}><Play />{taskBusy ? "Starting…" : "Start"}</button>}{task.status === "IN_PROGRESS" && <button className="secondary small" disabled={!!busyTaskId} onClick={() => updateStatus(task, "COMPLETED")}><Check />{taskBusy ? "Completing…" : "Complete"}</button>}{["SCHEDULED", "IN_PROGRESS"].includes(task.status) && <button className="icon-btn danger-text" aria-label={`Cancel ${task.type.toLowerCase()} maintenance`} title="Cancel" disabled={!!busyTaskId} onClick={() => updateStatus(task, "CANCELLED")}><X /></button>}</div>}</td></tr>; })}</tbody></table>{!loading && !tasks.length && <Empty title="No maintenance tasks" text="Schedule an inspection or adjust the current filter." />}{loading && <div className="loading">Loading fleet health…</div>}</div><div className="pagination"><button className="secondary small" disabled={taskPage <= 1 || loading || !!busyTaskId} onClick={() => setTaskPage((value) => value - 1)}>Previous</button><span>Page {taskPage} of {Math.max(taskPages, 1)}</span><button className="secondary small" disabled={taskPage >= taskPages || loading || !!busyTaskId} onClick={() => setTaskPage((value) => value + 1)}>Next</button></div></Panel>
    {open && <div className="modal-layer"><form className="modal" onSubmit={schedule}><header><div><p className="eyebrow">SERVICE PLANNING</p><h2>Schedule maintenance</h2></div><button type="button" className="icon-btn" aria-label="Close maintenance form" onClick={() => { setOpen(false); setError(""); }}><X /></button></header>{error && <div className="form-error">{error}</div>}<div className="form-grid"><label>Aircraft<select value={form.droneId} onChange={(event) => setForm({ ...form, droneId: event.target.value })} required><option value="">Select aircraft</option>{drones.map((drone) => <option value={drone._id} key={drone._id}>{drone.droneCode} — {drone.name}</option>)}</select></label><label>Service type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MaintenanceType })}><option>INSPECTION</option><option>BATTERY</option><option>PROPELLER</option><option>FIRMWARE</option><option>REPAIR</option></select></label><label>Scheduled for<input type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} required /></label><label>Notes<input value={form.notes} maxLength={1000} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Work scope or observed issue" /></label></div><footer><button type="button" className="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Scheduling…" : "Schedule task"}</button></footer></form></div>}
  </>;
}
