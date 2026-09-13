import { AlertRule } from "./models.js";

export const ALERT_RULE_KEYS = ["BATTERY_LOW", "GPS_WEAK", "SIGNAL_LOW", "GEOFENCE_BREACH"] as const;
export type AlertRuleKey = typeof ALERT_RULE_KEYS[number];
export type RuntimeAlertRule = { key: AlertRuleKey; label: string; metric: "BATTERY_PERCENT" | "GPS_SATELLITES" | "SIGNAL_PERCENT" | "GEOFENCE"; unit: string; enabled: boolean; threshold: number | null; severity: "WARNING" | "CRITICAL"; autoAction: "NONE" | "RETURN_HOME" | "LAND" };

export const defaultAlertRules: RuntimeAlertRule[] = [
  { key: "BATTERY_LOW", label: "Low battery", metric: "BATTERY_PERCENT", unit: "%", enabled: true, threshold: 30, severity: "CRITICAL", autoAction: "NONE" },
  { key: "GPS_WEAK", label: "Weak GPS", metric: "GPS_SATELLITES", unit: "satellites", enabled: true, threshold: 6, severity: "WARNING", autoAction: "NONE" },
  { key: "SIGNAL_LOW", label: "Low communication signal", metric: "SIGNAL_PERCENT", unit: "%", enabled: true, threshold: 30, severity: "CRITICAL", autoAction: "NONE" },
  { key: "GEOFENCE_BREACH", label: "Geofence breach", metric: "GEOFENCE", unit: "boundary", enabled: true, threshold: null, severity: "CRITICAL", autoAction: "RETURN_HOME" },
];

export async function ensureAlertRules() {
  await AlertRule.bulkWrite(defaultAlertRules.map((rule) => ({ updateOne: { filter: { key: rule.key }, update: { $setOnInsert: rule }, upsert: true } })) as any, { ordered: false });
  return AlertRule.find({ key: { $in: ALERT_RULE_KEYS } }).sort({ key: 1 });
}

export async function getAlertRuleMap() {
  const rules = await ensureAlertRules();
  return Object.fromEntries(rules.map((rule: any) => [rule.key, { key: rule.key, label: rule.label, metric: rule.metric, unit: rule.unit, enabled: rule.enabled, threshold: rule.threshold ?? null, severity: rule.severity, autoAction: rule.autoAction }])) as Record<AlertRuleKey, RuntimeAlertRule>;
}
