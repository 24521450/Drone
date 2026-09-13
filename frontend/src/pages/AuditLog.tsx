import { useEffect, useRef, useState } from "react";
import { Download, Filter, ShieldCheck } from "lucide-react";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import type { AuditEvent } from "../types";

type AuditMeta = { page: number; pages: number; total: number; actions: string[]; resourceTypes: string[] };

export default function AuditLog() {
  const { notify } = useFeedback();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<AuditMeta>({ page: 1, pages: 0, total: 0, actions: [], resourceTypes: [] });
  const [filters, setFilters] = useState({ action: "ALL", resourceType: "ALL", dateFrom: "", dateTo: "", page: 1 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/audit-events", { params: { ...filters, limit: 25 }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems(response.data.data);
      setMeta(response.data.meta);
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
    const refresh = () => { void load(); };
    const timer = window.setInterval(refresh, 30_000);
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("audit:created", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    refresh();
    return () => {
      window.clearInterval(timer);
      socket.off("audit:created", refresh);
      socket.off("connect", refresh);
      requestRef.current?.abort();
    };
  }, [filters.action, filters.resourceType, filters.dateFrom, filters.dateTo, filters.page]);

  const setFilter = (key: "action" | "resourceType" | "dateFrom" | "dateTo", value: string) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const exportRows = async () => {
    if (!meta.total || loading || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/audit-events/export", { params: { action: filters.action, resourceType: filters.resourceType, dateFrom: filters.dateFrom, dateTo: filters.dateTo, timezoneOffsetMinutes: new Date().getTimezoneOffset() }, responseType: "blob" });
      downloadBlob(`audit-events-${new Date().toISOString().slice(0, 10)}.csv`, response.data);
      notify(`${meta.total} audit events exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Audit export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return <>
    <PageTitle eyebrow="GOVERNANCE" title="Administrative audit log" text={`${meta.total} immutable records of session and administrative actions.`} action={<button className="secondary" onClick={() => void exportRows()} disabled={!meta.total || loading || exporting}><Download />{exporting ? "Exporting..." : "Export all matching"}</button>} />
    {error && <div className="form-error page-error">{error}</div>}
    <Panel>
      <div className="toolbar alert-filters"><Filter /><label>FROM<input aria-label="Audit date from" type="date" max={filters.dateTo || undefined} value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label><label>TO<input aria-label="Audit date to" type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} /></label><select aria-label="Audit action" value={filters.action} onChange={(event) => setFilter("action", event.target.value)}><option>ALL</option>{meta.actions.map((action) => <option key={action}>{action}</option>)}</select><select aria-label="Audit resource type" value={filters.resourceType} onChange={(event) => setFilter("resourceType", event.target.value)}><option>ALL</option>{meta.resourceTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
      <div className="table-wrap"><table><thead><tr><th>Occurred</th><th>Actor</th><th>Action</th><th>Resource</th><th>Endpoint</th><th>Result</th></tr></thead><tbody>{items.map((item) => <tr key={item._id}><td>{new Date(item.occurredAt).toLocaleString()}</td><td>{typeof item.actorId === "string" ? "Unknown user" : <><b>{item.actorId.name}</b><small className="table-sub">{item.actorId.email}</small></>}</td><td><span className="audit-action"><ShieldCheck />{item.action.replaceAll("_", " ")}</span></td><td>{item.resourceType}<small className="table-sub mono">{item.resourceId || "Batch operation"}</small></td><td><span className="mono">{item.method} {item.route}</span></td><td><StatusBadge status={`${item.statusCode} SUCCESS`} /></td></tr>)}</tbody></table>{!loading && !items.length && <Empty title="No audit events" text="Session sign-ins and successful administrative changes will appear here." />}{loading && <div className="loading">Loading audit history...</div>}</div>
      <div className="pagination"><button className="secondary small" disabled={meta.page <= 1 || loading} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {meta.page} of {Math.max(meta.pages, 1)}</span><button className="secondary small" disabled={meta.page >= meta.pages || loading} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></div>
    </Panel>
  </>;
}
