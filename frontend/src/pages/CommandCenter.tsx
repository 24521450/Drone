import { useEffect, useRef, useState } from "react";
import {
  CirclePause,
  CirclePlay,
  Download,
  House,
  LandPlot,
  RadioTower,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "../auth";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import { useFeedback } from "../feedback";
import type { Command, Flight } from "../types";

export default function CommandCenter() {
  const { user } = useAuth();
  const { notify, confirm } = useFeedback();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [flightId, setFlightId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [commandStatus, setCommandStatus] = useState("ALL");
  const [commandType, setCommandType] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0, pages: 0 });
  const requestRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const commandFilters = () => ({
    status: commandStatus,
    type: commandType,
    dateFrom,
    dateTo,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  });

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const [flightResponse, commandResponse] = await Promise.all([
        api.get("/flights", {
          params: { status: "ACTIVE", limit: 100 },
          signal: controller.signal,
        }),
        api.get("/commands", {
          params: { ...commandFilters(), page, limit: 25 },
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted) return;
      const nextFlights: Flight[] = flightResponse.data.data;
      setFlights(nextFlights);
      setCommands(commandResponse.data.data);
      const nextMeta = commandResponse.data.meta ?? {
        page,
        limit: 25,
        total: commandResponse.data.data.length,
        pages: 1,
      };
      setMeta(nextMeta);
      if (nextMeta.pages > 0 && page > nextMeta.pages) setPage(nextMeta.pages);
      setFlightId((current) =>
        nextFlights.some((item) => item._id === current)
          ? current
          : nextFlights[0]?._id ?? "",
      );
    } catch (reason: any) {
      if (reason?.code !== "ERR_CANCELED" && reason?.name !== "CanceledError")
        setError(errorMessage(reason));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
    };
  }, [commandStatus, commandType, dateFrom, dateTo, page]);

  useEffect(() => {
    const refresh = () => {
      if (refreshTimerRef.current !== null)
        window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void load();
      }, 120);
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("command:status", refresh);
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socket.off("command:status", refresh);
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
    };
  }, [commandStatus, commandType, dateFrom, dateTo, page]);

  const issue = async (type: Command["type"]) => {
    if (!flightId || busy || user?.role !== "ADMIN") return;
    setBusy(true);
    setError("");
    try {
      if (["RETURN_HOME", "LAND"].includes(type)) {
        const approved = await confirm({
          title: type === "LAND" ? "Land aircraft" : "Return aircraft home",
          message:
            type === "LAND"
              ? "The current mission will be cancelled and the aircraft will land immediately."
              : "The current mission will be cancelled and the aircraft will return home.",
          confirmLabel: type === "LAND" ? "Land now" : "Return home",
          danger: type === "LAND",
        });
        if (!approved) return;
      }
      await api.post("/commands", { flightId, type });
      notify(`${type.replace("_", " ")} command completed`, "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Command failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const exportRows = async () => {
    if (!meta.total || loading || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/commands/export", {
        params: commandFilters(),
        responseType: "blob",
      });
      downloadBlob(
        `commands-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} command records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Command export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  const retry = async (command: Command) => {
    if (retryingId || busy || user?.role !== "ADMIN") return;
    if (["RETURN_HOME", "LAND"].includes(command.type)) {
      const approved = await confirm({
        title:
          command.type === "LAND"
            ? "Retry landing command"
            : "Retry return-home command",
        message:
          command.type === "LAND"
            ? "This will send the landing command to the active aircraft again."
            : "This will send the return-home command to the active aircraft again.",
        confirmLabel:
          command.type === "LAND" ? "Retry landing" : "Retry return home",
        danger: command.type === "LAND",
      });
      if (!approved) return;
    }
    setRetryingId(command._id);
    setError("");
    try {
      await api.post(`/commands/${command._id}/retry`);
      notify(`${command.type.replace("_", " ")} command retried`, "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Command retry failed", "error");
    } finally {
      setRetryingId(null);
    }
  };

  const selected = flights.find((flight) => flight._id === flightId);
  const phase = selected?.flightPhase ?? "MISSION";
  const adminReady = !!flightId && !busy && user?.role === "ADMIN";

  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS"
        title="Command center"
        text="Send immediate commands to active aircraft and audit every outcome."
      />
      {error && <div className="form-error page-error">{error}</div>}
      <Panel className="command-strip">
        <div>
          <RadioTower />
          <label>
            Active flight
            <select
              aria-label="Active flight"
              value={flightId}
              onChange={(event) => setFlightId(event.target.value)}
            >
              <option value="">No active flights</option>
              {flights.map((flight) => (
                <option key={flight._id} value={flight._id}>
                  {flight.flightCode} ·{" "}
                  {typeof flight.droneId === "string"
                    ? "Aircraft"
                    : flight.droneId.droneCode}
                </option>
              ))}
            </select>
          </label>
          {selected && <StatusBadge status={phase} />}
        </div>
        <div className="command-buttons">
          <button
            title={
              !adminReady || ["TAKEOFF", "MISSION"].includes(phase)
                ? ""
                : "Pause is only available during takeoff or mission flight"
            }
            className="secondary"
            disabled={!adminReady || !["TAKEOFF", "MISSION"].includes(phase)}
            onClick={() => void issue("PAUSE")}
          >
            <CirclePause /> Pause
          </button>
          <button
            title={phase === "PAUSED" ? "" : "Resume requires a paused flight"}
            className="secondary"
            disabled={!adminReady || phase !== "PAUSED"}
            onClick={() => void issue("RESUME")}
          >
            <CirclePlay /> Resume
          </button>
          <button
            className="primary"
            disabled={!adminReady || ["RETURN_HOME", "LANDING"].includes(phase)}
            onClick={() => void issue("RETURN_HOME")}
          >
            <House /> Return home
          </button>
          <button
            className="stop"
            disabled={!adminReady || phase === "LANDING"}
            onClick={() => void issue("LAND")}
          >
            <LandPlot /> Land now
          </button>
        </div>
      </Panel>
      <Panel
        title="Command audit log"
        action={
          <button
            className="secondary"
            onClick={() => void exportRows()}
            disabled={!meta.total || loading || exporting}
          >
            <Download /> {exporting ? "Exporting..." : "Export all matching"}
          </button>
        }
      >
        <div className="toolbar analytics-filters command-filters">
          <span className="history-label">Filter audit records</span>
          <label>
            FROM
            <input
              aria-label="Command date from"
              type="date"
              max={dateTo || undefined}
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            TO
            <input
              aria-label="Command date to"
              type="date"
              min={dateFrom || undefined}
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            TYPE
            <select
              aria-label="Command type"
              value={commandType}
              onChange={(event) => {
                setCommandType(event.target.value);
                setPage(1);
              }}
            >
              <option>ALL</option>
              <option>PAUSE</option>
              <option>RESUME</option>
              <option>RETURN_HOME</option>
              <option>LAND</option>
            </select>
          </label>
          <label>
            STATUS
            <select
              aria-label="Command status"
              value={commandStatus}
              onChange={(event) => {
                setCommandStatus(event.target.value);
                setPage(1);
              }}
            >
              <option>ALL</option>
              <option>REQUESTED</option>
              <option>ACKNOWLEDGED</option>
              <option>EXECUTING</option>
              <option>COMPLETED</option>
              <option>FAILED</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Aircraft</th>
                <th>Action</th>
                <th>Source</th>
                <th>Requested</th>
                <th>Outcome</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {commands.map((command) => (
                <tr key={command._id}>
                  <td className="mono">
                    {command.commandCode}
                    {command.retryOf && (
                      <small className="table-sub">
                        Retry of …{command.retryOf.slice(-6)}
                      </small>
                    )}
                  </td>
                  <td>
                    {typeof command.droneId === "string"
                      ? "—"
                      : command.droneId.droneCode}
                  </td>
                  <td>{command.type.replace("_", " ")}</td>
                  <td>{command.source}</td>
                  <td>{new Date(command.requestedAt).toLocaleString()}</td>
                  <td>
                    <StatusBadge status={command.status} />
                    {command.failureReason && (
                      <small className="table-sub danger-text">
                        {command.failureReason}
                      </small>
                    )}
                  </td>
                  <td>
                    {command.status === "FAILED" && user?.role === "ADMIN" && (() => {
                      const flightIsActive = flights.some(
                        (flight) => flight._id === command.flightId,
                      );
                      return (
                        <button
                          className="secondary small"
                          title={
                            flightIsActive
                              ? "Retry failed command"
                              : "The original flight is no longer active"
                          }
                          disabled={!!retryingId || busy || !flightIsActive}
                          onClick={() => void retry(command)}
                        >
                          <RotateCcw />
                          {retryingId === command._id
                            ? "Retrying..."
                            : flightIsActive
                              ? "Retry"
                              : "Unavailable"}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="loading">Loading command history...</div>}
          {!loading && !commands.length && (
            <Empty
              title="No matching commands"
              text="Start a flight or adjust the audit filters."
            />
          )}
        </div>
        <div className="pagination">
          <button
            className="secondary small"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {meta.page} of {Math.max(meta.pages, 1)} · {meta.total} commands
          </span>
          <button
            className="secondary small"
            disabled={page >= meta.pages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
    </>
  );
}
