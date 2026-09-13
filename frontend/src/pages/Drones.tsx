import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Edit3, Eye, Plus, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import { useFeedback } from "../feedback";
import type { Drone } from "../types";

const blank = { droneCode: "", name: "", model: "", serialNumber: "", firmware: "1.0.0" };

export default function Drones() {
  const { user } = useAuth();
  const { notify, confirm } = useFeedback();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [editing, setEditing] = useState<Drone | null | "new">(null);
  const [form, setForm] = useState(blank);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pages: 0, total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyDroneId, setBusyDroneId] = useState<string>();
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/drones", { params: { search, status, page, limit: 25 }, signal: controller.signal });
      if (controller.signal.aborted) return;
      const nextMeta = response.data.meta ?? { page, pages: response.data.data.length ? 1 : 0, total: response.data.data.length };
      setMeta(nextMeta);
      if (page > Math.max(nextMeta.pages, 1)) { setDrones([]); setPage(Math.max(nextMeta.pages, 1)); return; }
      setDrones(response.data.data);
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
    const timer = window.setTimeout(() => void load(), 200);
    return () => { window.clearTimeout(timer); requestRef.current?.abort(); };
  }, [search, status, page]);

  useEffect(() => { setPage(1); }, [search, status]);

  useEffect(() => {
    const refresh = () => { void load(); };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("drone:updated", refresh);
    socket.on("fleet:updated", refresh);
    socket.on("flight:status", refresh);
    socket.on("maintenance:updated", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("drone:updated", refresh);
      socket.off("fleet:updated", refresh);
      socket.off("flight:status", refresh);
      socket.off("maintenance:updated", refresh);
      socket.off("connect", refresh);
    };
  }, [search, status, page]);

  const open = (drone?: Drone) => {
    setEditing(drone ?? "new");
    setError("");
    setForm(drone ? { droneCode: drone.droneCode, name: drone.name, model: drone.model, serialNumber: drone.serialNumber, firmware: drone.firmware } : blank);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !editing) return;
    setError("");
    setSaving(true);
    try {
      editing === "new" ? await api.post("/drones", form) : await api.patch(`/drones/${editing._id}`, form);
      setEditing(null);
      notify("Drone saved", "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (drone: Drone) => {
    if (busyDroneId || saving) return;
    setBusyDroneId(drone._id);
    try {
      if (!await confirm({ title: "Archive drone", message: `${drone.droneCode} will be removed from the active fleet.`, confirmLabel: "Archive", danger: true })) return;
      await api.delete(`/drones/${drone._id}`);
      notify("Drone archived", "success");
      void load();
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusyDroneId(undefined);
    }
  };

  const exportAll = async () => {
    if (!meta.total || loading || exporting || saving || busyDroneId) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/drones/export", {
        params: { search, status },
        responseType: "blob",
      });
      downloadBlob(
        `drones-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} drone records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Drone export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return <>
    <PageTitle eyebrow="FLEET" title="Drone management" text="Register and monitor every aircraft in your operation." action={<div className="action-row"><button className="secondary" disabled={!meta.total || loading || exporting || saving || !!busyDroneId} onClick={() => void exportAll()}><Download />{exporting ? "Exporting..." : "Export all matching"}</button>{user?.role === "ADMIN" && <button className="primary" disabled={saving || !!busyDroneId} onClick={() => open()}><Plus size={17} />Add drone</button>}</div>} />
    {error && !editing && <div className="form-error page-error">{error}</div>}
    <Panel>
      <div className="toolbar"><div className="search"><Search /><input aria-label="Search drones" placeholder="Search drone, model or serial..." value={search} onChange={(e) => setSearch(e.target.value)} /></div><select aria-label="Drone status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All statuses</option><option>ONLINE</option><option>IN_FLIGHT</option><option>WARNING</option><option>OFFLINE</option></select><span className="result-count">{meta.total} drones</span></div>
      <div className="table-wrap"><table><thead><tr><th>Drone</th><th>Model</th><th>Serial number</th><th>Battery</th><th>Status</th><th /></tr></thead><tbody>{drones.map((drone) => <tr key={drone._id}><td><b>{drone.droneCode}</b><small className="table-sub">{drone.name}</small></td><td>{drone.model}<small className="table-sub">Firmware {drone.firmware}</small></td><td className="mono">{drone.serialNumber}</td><td><div className="battery-cell"><div className="battery-mini"><i style={{ width: `${drone.battery}%` }} /></div>{Math.round(drone.battery)}%</div></td><td><StatusBadge status={drone.status} /></td><td><div className="row-actions"><Link className="icon-btn" to={`/drones/${drone._id}`} title="View" aria-label={`View ${drone.droneCode}`}><Eye /></Link>{user?.role === "ADMIN" && <><button className="icon-btn" disabled={saving || !!busyDroneId} onClick={() => open(drone)} title="Edit" aria-label={`Edit ${drone.droneCode}`}><Edit3 /></button><button className="icon-btn danger-text" disabled={saving || !!busyDroneId} onClick={() => archive(drone)} title="Archive" aria-label={`Archive ${drone.droneCode}`}><Trash2 /></button></>}</div></td></tr>)}</tbody></table>{loading && <div className="loading">Loading aircraft...</div>}{!loading && !drones.length && <Empty title="No drones found" text="Adjust the filters or register a new drone." />}</div>
      <div className="pagination"><button className="secondary small" disabled={page <= 1 || loading || !!busyDroneId} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(meta.pages, 1)}</span><button className="secondary small" disabled={page >= meta.pages || loading || !!busyDroneId} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    </Panel>
    {editing && <div className="modal-layer"><form className="modal" onSubmit={save}><header><div><p className="eyebrow">FLEET RECORD</p><h2>{editing === "new" ? "Register drone" : "Edit drone"}</h2></div><button type="button" className="icon-btn" disabled={saving} aria-label="Close drone form" onClick={() => setEditing(null)}><X /></button></header>{error && <div className="form-error">{error}</div>}<div className="form-grid">{Object.entries(form).map(([key, value]) => <label key={key}>{({ droneCode: "Drone code", name: "Display name", model: "Model", serialNumber: "Serial number", firmware: "Firmware" } as any)[key]}<input value={value} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required /></label>)}</div><footer><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving..." : "Save drone"}</button></footer></form></div>}
  </>;
}
