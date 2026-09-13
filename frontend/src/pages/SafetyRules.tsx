import { useEffect, useRef, useState } from "react";
import { Battery, RotateCcw, Satellite, Save, ShieldAlert, TowerControl } from "lucide-react";
import { useAuth } from "../auth";
import { PageTitle, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, errorMessage, socket } from "../lib";
import type { AlertRule } from "../types";

const icons = { BATTERY_LOW: Battery, GPS_WEAK: Satellite, SIGNAL_LOW: TowerControl, GEOFENCE_BREACH: ShieldAlert };

export default function SafetyRules() {
  const { user } = useAuth();
  const { notify, confirm } = useFeedback();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [saving, setSaving] = useState("");
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/alert-rules", { signal: controller.signal });
      if (!controller.signal.aborted) setRules(response.data.data);
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
    void load();
    return () => { requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    const refresh = () => { void load(); };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("alert-rules:updated", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => { socket.off("alert-rules:updated", refresh); socket.off("connect", refresh); };
  }, []);

  const change = (key: AlertRule["key"], values: Partial<AlertRule>) => setRules((current) => current.map((rule) => rule.key === key ? { ...rule, ...values } : rule));

  const save = async (rule: AlertRule) => {
    if (saving || resetting || user?.role !== "ADMIN") return;
    setSaving(rule.key);
    setError("");
    try {
      await api.patch(`/alert-rules/${rule.key}`, { enabled: rule.enabled, ...(rule.threshold === null ? {} : { threshold: rule.threshold }), severity: rule.severity, autoAction: rule.autoAction });
      notify(`${rule.label} rule saved`, "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving("");
    }
  };

  const reset = async () => {
    if (saving || resetting || user?.role !== "ADMIN") return;
    setResetting(true);
    setError("");
    try {
      if (!await confirm({ title: "Reset safety rules", message: "All thresholds, severities and automatic actions will return to the safe project defaults.", confirmLabel: "Reset rules", danger: true })) return;
      const response = await api.post("/alert-rules/reset");
      setRules(response.data.data);
      notify("Safety rules reset", "success");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setResetting(false);
    }
  };

  return <>
    <PageTitle eyebrow="SAFETY POLICY" title="Alert rules" text="Configure detection thresholds and automatic flight responses for newly started operations." action={user?.role === "ADMIN" && <button className="secondary" disabled={loading || !!saving || resetting} onClick={reset}><RotateCcw />{resetting ? "Resetting..." : "Reset defaults"}</button>} />
    {error && <div className="form-error page-error">{error}</div>}
    {loading && !rules.length && <div className="loading">Loading safety rules...</div>}
    <div className="rule-grid">{rules.map((rule) => { const Icon = icons[rule.key]; const isSaving = saving === rule.key; return <Panel key={rule.key} className={rule.enabled ? "rule-card" : "rule-card disabled-rule"}><header className="rule-title"><span><Icon /></span><div><b>{rule.label}</b><small>{rule.metric.replaceAll("_", " ")}</small></div><label className="switch"><input type="checkbox" checked={rule.enabled} disabled={user?.role !== "ADMIN" || !!saving || resetting} onChange={(event) => change(rule.key, { enabled: event.target.checked })} /><i /></label></header><div className="rule-fields"><label>{rule.threshold !== null ? "TRIGGER BELOW" : "DETECTION"}{rule.threshold !== null ? <div className="threshold-input"><input type="number" min={1} max={rule.key === "GPS_WEAK" ? 30 : 100} value={rule.threshold} disabled={user?.role !== "ADMIN" || !!saving || resetting} onChange={(event) => change(rule.key, { threshold: Number(event.target.value) })} /><span>{rule.unit}</span></div> : <span className="boundary-value">Assigned boundary</span>}</label><label>SEVERITY<select value={rule.severity} disabled={user?.role !== "ADMIN" || !!saving || resetting} onChange={(event) => change(rule.key, { severity: event.target.value as AlertRule["severity"] })}><option>WARNING</option><option>CRITICAL</option></select></label><label>AUTOMATIC RESPONSE<select value={rule.autoAction} disabled={user?.role !== "ADMIN" || !!saving || resetting} onChange={(event) => change(rule.key, { autoAction: event.target.value as AlertRule["autoAction"] })}><option value="NONE">Notify only</option><option value="RETURN_HOME">Return home</option><option value="LAND">Land immediately</option></select></label></div><footer><div><StatusBadge status={rule.enabled ? "ACTIVE" : "DISABLED"} /><small>Applies to new flights</small></div>{user?.role === "ADMIN" && <button className="primary" disabled={!!saving || resetting} onClick={() => save(rule)}><Save />{isSaving ? "Saving..." : "Save rule"}</button>}</footer></Panel>; })}</div>
    <Panel className="safety-note"><ShieldAlert /><div><b>Automatic responses are issued once per flight</b><p>If multiple rules trigger simultaneously, emergency landing takes precedence over return-home. Running flights retain the rule snapshot they started with.</p></div></Panel>
  </>;
}
