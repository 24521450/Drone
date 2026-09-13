export type HealthInputs = {
  battery: number;
  lastSeen?: Date | string | null;
  flights: number;
  failedFlights: number;
  criticalAlerts: number;
  warningAlerts: number;
  overdueMaintenance: number;
  openMaintenance: number;
};

export type HealthResult = { score: number; status: "HEALTHY" | "WATCH" | "SERVICE_DUE"; reasons: string[] };

export function calculateDroneHealth(input: HealthInputs, now = new Date()): HealthResult {
  let score = 100;
  const reasons: string[] = [];
  if (input.battery < 25) { score -= 20; reasons.push("Battery is below 25%"); }
  else if (input.battery < 50) { score -= 8; reasons.push("Battery should be charged before flight"); }

  const seenAt = input.lastSeen ? new Date(input.lastSeen) : null;
  const staleDays = seenAt && Number.isFinite(seenAt.getTime()) ? (now.getTime() - seenAt.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (staleDays > 7) { score -= 15; reasons.push("No telemetry received for more than 7 days"); }
  else if (staleDays > 1) { score -= 5; reasons.push("Telemetry has been stale for more than 24 hours"); }

  if (input.flights > 0) {
    const failureRate = input.failedFlights / input.flights;
    const penalty = Math.round(Math.min(30, failureRate * 40));
    if (penalty > 0) { score -= penalty; reasons.push(`${Math.round(failureRate * 100)}% flight failure rate in the last 30 days`); }
  }
  if (input.criticalAlerts > 0) { score -= Math.min(20, input.criticalAlerts * 5); reasons.push(`${input.criticalAlerts} critical safety event${input.criticalAlerts === 1 ? "" : "s"} in the last 30 days`); }
  if (input.warningAlerts > 0) { score -= Math.min(10, input.warningAlerts * 2); reasons.push(`${input.warningAlerts} warning event${input.warningAlerts === 1 ? "" : "s"} in the last 30 days`); }
  if (input.overdueMaintenance > 0) { score -= 25; reasons.push(`${input.overdueMaintenance} overdue maintenance task${input.overdueMaintenance === 1 ? "" : "s"}`); }
  else if (input.openMaintenance > 0) { score -= 3; reasons.push(`${input.openMaintenance} scheduled maintenance task${input.openMaintenance === 1 ? "" : "s"}`); }

  score = Math.max(0, Math.min(100, score));
  const status = score < 60 || input.overdueMaintenance > 0 ? "SERVICE_DUE" : score < 80 ? "WATCH" : "HEALTHY";
  return { score, status, reasons: reasons.length ? reasons : ["No current maintenance concerns"] };
}
