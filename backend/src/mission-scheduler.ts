import type { Server } from "socket.io";
import { Mission } from "./models.js";
import { startMission } from "./simulator.js";

let timer: NodeJS.Timeout | undefined;
let processing = false;

export async function processDueMissions(io: Server, now = new Date()) {
  if (processing) return [];
  processing = true;
  const outcomes: Array<{ missionId: string; status: "STARTED" | "WAITING" | "FAILED"; flightId?: string; error?: string }> = [];
  try {
    const due = await Mission.find({ isArchived: false, status: "READY", scheduleStatus: "SCHEDULED", scheduledFor: { $lte: now } }).sort({ scheduledFor: 1 }).limit(25);
    const weights = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
    due.sort((a: any, b: any) => weights[a.priority as keyof typeof weights] - weights[b.priority as keyof typeof weights] || +new Date(a.scheduledFor) - +new Date(b.scheduledFor));
    for (const candidate of due) {
      const mission = await Mission.findOneAndUpdate({ _id: candidate._id, scheduleStatus: "SCHEDULED", status: "READY" }, { scheduleStatus: "PROCESSING", $unset: { scheduleError: 1 } }, { returnDocument: "after" });
      if (!mission) continue;
      try {
        const flight = await startMission(io, String(mission._id));
        await Mission.findByIdAndUpdate(mission._id, { scheduleStatus: "STARTED", $unset: { scheduleError: 1 } });
        outcomes.push({ missionId: String(mission._id), status: "STARTED", flightId: String(flight._id) });
      } catch (reason: any) {
        const message = typeof reason?.message === "string" ? reason.message : "Unable to start scheduled mission";
        const waiting = /active flight|active simulator|already in flight|maintenance is currently in progress/i.test(message);
        await Mission.findByIdAndUpdate(mission._id, { scheduleStatus: waiting ? "SCHEDULED" : "FAILED", scheduleError: waiting ? "Waiting for assigned drone to become available" : message });
        outcomes.push({ missionId: String(mission._id), status: waiting ? "WAITING" : "FAILED", error: message });
      }
    }
    if (outcomes.length) io.emit("mission:schedule", outcomes);
    return outcomes;
  } finally { processing = false; }
}

export function startMissionScheduler(io: Server) {
  if (timer) return;
  const run = () => {
    void processDueMissions(io).catch((error) => console.error("Mission scheduler tick failed", error));
  };
  run();
  timer = setInterval(run, 5_000);
  timer.unref();
}

export function stopMissionScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
