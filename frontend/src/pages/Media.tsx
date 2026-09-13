import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Download,
  Image,
  PlaySquare,
  RefreshCw,
  Search,
  Video,
  X,
} from "lucide-react";
import { PageTitle, Empty, Metric, Panel, StatusBadge } from "../components";
import { useFeedback } from "../feedback";
import { api, downloadBlob, errorMessage, isCanceledRequest, socket } from "../lib";
import type { Drone, MediaAsset, MediaLibrarySummary, MediaSensorType, MediaType } from "../types";

const pageSize = 12;
const emptySummary: MediaLibrarySummary = {
  total: 0,
  photos: 0,
  videos: 0,
  rgb: 0,
  thermal: 0,
  multispectral: 0,
  latestCapture: null,
};

export default function Media() {
  const { notify } = useFeedback();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaAsset>();
  const [summary, setSummary] = useState<MediaLibrarySummary>(emptySummary);
  const [sourceLabel, setSourceLabel] = useState("");
  const [type, setType] = useState<"ALL" | MediaType>("ALL");
  const [sensorType, setSensorType] = useState<"ALL" | MediaSensorType>("ALL");
  const [droneId, setDroneId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const dronesRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    dronesRequestRef.current = controller;
    api.get("/drones", { params: { status: "ALL" }, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted)
          setDrones((response.data.data ?? []) as Drone[]);
      })
      .catch((reason) => {
        if (!isCanceledRequest(reason)) setError(errorMessage(reason));
      })
      .finally(() => {
        if (dronesRequestRef.current === controller) dronesRequestRef.current = null;
      });
    return () => {
      controller.abort();
      if (dronesRequestRef.current === controller) dronesRequestRef.current = null;
    };
  }, []);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/media", {
        params: {
          type,
          sensorType,
          droneId: droneId || undefined,
          dateFrom,
          dateTo,
          page,
          limit: pageSize,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems(response.data.data as MediaAsset[]);
      setSummary(response.data.summary ?? emptySummary);
      setSourceLabel(response.data.sourceLabel ?? "");
      const nextMeta = response.data.meta ?? { page, pages: 0, total: 0 };
      setTotal(nextMeta.total ?? 0);
      setPages(nextMeta.pages ?? 0);
      if (page > Math.max(nextMeta.pages ?? 0, 1)) setPage(Math.max(nextMeta.pages ?? 0, 1));
    } catch (reason) {
      if (!isCanceledRequest(reason)) setError(errorMessage(reason));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 120);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [type, sensorType, droneId, dateFrom, dateTo, page]);

  useEffect(() => {
    setPage(1);
  }, [type, sensorType, droneId, dateFrom, dateTo]);

  useEffect(() => {
    const refresh = () => void load();
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("flight:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("flight:status", refresh);
      socket.off("connect", refresh);
    };
  }, [type, sensorType, droneId, dateFrom, dateTo, page]);

  useEffect(() => {
    if (!selectedMedia) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMedia(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedMedia]);

  const exportAll = async () => {
    if (!total || loading || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/media/export", {
        params: { type, sensorType, droneId: droneId || undefined, dateFrom, dateTo },
        responseType: "blob",
      });
      downloadBlob(`media-${new Date().toISOString().slice(0, 10)}.csv`, response.data);
      notify(`${total} media records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Media export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return <>
    <PageTitle
      eyebrow="DATA / CAMERA MEDIA"
      title="Media library"
      text="Review simulated RGB, thermal and multispectral captures with flight-linked metadata."
      action={<button className="secondary" onClick={() => void exportAll()} disabled={!total || loading || exporting}><Download />{exporting ? "Exporting..." : "Export all matching"}</button>}
    />
    {error && <div className="form-error page-error"><span>{error}</span><button className="secondary small" onClick={() => void load()} disabled={loading}><RefreshCw />Retry</button></div>}
    <div className="metric-grid media-metrics"><Metric label="TOTAL MEDIA" value={summary.total} icon={<Camera />} /><Metric label="PHOTOS" value={summary.photos} icon={<Image />} /><Metric label="VIDEOS" value={summary.videos} icon={<Video />} /><Metric label="LATEST CAPTURE" value={summary.latestCapture ? new Date(summary.latestCapture).toLocaleTimeString() : "—"} icon={<PlaySquare />} /></div>
      <Panel title="Media browser" action={<span className="media-source"><i />{sourceLabel || "Loading catalog"}</span>}>
      <div className="toolbar media-filters"><div className="search"><Search /><span className="media-filter-label">CAPTURE FILTERS</span></div><select aria-label="Media drone" value={droneId} onChange={(event) => setDroneId(event.target.value)}><option value="">All drones</option>{drones.map((drone) => <option key={drone._id} value={drone._id}>{drone.droneCode}</option>)}</select><select aria-label="Media type" value={type} onChange={(event) => setType(event.target.value as "ALL" | MediaType)}><option value="ALL">All media</option><option value="PHOTO">Photos</option><option value="VIDEO">Videos</option></select><select aria-label="Media sensor" value={sensorType} onChange={(event) => setSensorType(event.target.value as "ALL" | MediaSensorType)}><option value="ALL">All sensors</option><option value="RGB">RGB</option><option value="THERMAL">Thermal</option><option value="MULTISPECTRAL">Multispectral</option></select><label>FROM<input aria-label="Media date from" type="date" max={dateTo || undefined} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>TO<input aria-label="Media date to" type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><span className="result-count">{total} captures</span></div>
      <div className="media-grid">{loading && !items.length && <div className="loading">Loading media catalog...</div>}{!loading && !items.length && <Empty title="No media matches" text="Adjust the filters or start a simulated flight to capture metadata." />}{items.map((item) => <div className="media-card-trigger" key={item.mediaId} onClick={() => setSelectedMedia(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedMedia(item); } }} role="button" tabIndex={0} aria-label={`View details for ${item.mediaId}`}><MediaCard item={item} /></div>)}</div>
      <div className="pagination"><button className="secondary small" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(pages, 1)}</span><button className="secondary small" disabled={!pages || page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div>
    </Panel>
    {selectedMedia && <MediaDetails item={selectedMedia} onClose={() => setSelectedMedia(undefined)} />}
  </>;
}

function MediaCard({ item }: { item: MediaAsset }) {
  const typeClass = item.mediaType.toLowerCase();
  const sensorClass = item.sensorType.toLowerCase();
  return <article className="media-card"><div className={`media-preview ${typeClass} ${sensorClass}`}><span>{item.mediaType === "VIDEO" ? <Video /> : <Image />}</span><b>{item.sensorType}</b><small>{item.mediaType}{item.durationSeconds ? ` · ${item.durationSeconds}s` : ""}</small></div><div className="media-card-body"><header><div><strong>{item.droneCode}</strong><small>{new Date(item.capturedAt).toLocaleString()}</small></div><StatusBadge status={item.virtual ? "DEMO" : item.status} /></header><div className="media-meta"><span><b>GPS</b>{item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}</span><span><b>ALTITUDE</b>{item.altitude} m</span><span><b>FLIGHT</b>{item.flightId}</span>{item.missionId && <span><b>MISSION</b>{item.missionId}</span>}</div><footer><small className="mono">{item.fileLocation}</small><span className="media-ready">AVAILABLE</span></footer></div></article>;
}

function MediaDetails({ item, onClose }: { item: MediaAsset; onClose: () => void }) {
  const typeClass = item.mediaType.toLowerCase();
  const sensorClass = item.sensorType.toLowerCase();
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal media-modal" role="dialog" aria-modal="true" aria-labelledby="media-details-title"><header><div><p className="eyebrow">MEDIA METADATA</p><h2 id="media-details-title">{item.droneCode} · {item.sensorType}</h2></div><button type="button" className="icon-btn" aria-label="Close media details" onClick={onClose}><X /></button></header><div className={`media-modal-preview ${typeClass} ${sensorClass}`}><span>{item.mediaType === "VIDEO" ? <Video /> : <Image />}</span><strong>{item.mediaType}</strong><small>{item.virtual ? "Demo placeholder · no external file" : item.fileLocation}</small></div><dl className="media-detail-grid"><div><dt>CAPTURED</dt><dd>{new Date(item.capturedAt).toLocaleString()}</dd></div><div><dt>SENSOR</dt><dd>{item.sensorType}</dd></div><div><dt>GPS</dt><dd>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</dd></div><div><dt>ALTITUDE</dt><dd>{item.altitude} m</dd></div><div><dt>FLIGHT</dt><dd className="mono">{item.flightId}</dd></div><div><dt>MISSION</dt><dd className="mono">{item.missionId ?? "—"}</dd></div><div><dt>DURATION</dt><dd>{item.durationSeconds ? `${item.durationSeconds} s` : "Still image"}</dd></div><div><dt>STATUS</dt><dd><StatusBadge status={item.virtual ? "DEMO" : item.status} /></dd></div></dl><footer><span className="media-modal-note">{item.virtual ? "This preview represents deterministic demo metadata only." : "Capture metadata is linked to the latest flight telemetry."}</span><button type="button" className="secondary" onClick={onClose}>Close</button></footer></section></div>;
}
