import { useEffect, useRef, useState } from "react";
import { Download, MapPin, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useAuth } from "../auth";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import { GeofenceEditorMap } from "../operation-maps";
import { useFeedback } from "../feedback";
import type { Coordinate, Geofence } from "../types";

const HOME = { latitude: 10.762622, longitude: 106.660172 };
const pageSize = 25;

export default function Geofences() {
  const { user } = useAuth();
  const { notify, confirm } = useFeedback();
  const [items, setItems] = useState<Geofence[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pages: 0, total: 0 });
  const [selected, setSelected] = useState<Geofence>();
  const [name, setName] = useState("");
  const [type, setType] = useState<"POLYGON" | "CIRCLE">("POLYGON");
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [center, setCenter] = useState<Coordinate>();
  const [home, setHome] = useState<Coordinate>(HOME);
  const [radius, setRadius] = useState(180);
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/geofences", {
        params: { search, status, page, limit: pageSize },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const nextMeta = response.data.meta ?? {
        page,
        pages: response.data.data.length ? 1 : 0,
        total: response.data.data.length,
      };
      const nextItems = response.data.data as Geofence[];
      setMeta(nextMeta);
      if (page > Math.max(nextMeta.pages, 1)) {
        setItems([]);
        setPage(Math.max(nextMeta.pages, 1));
        return;
      }
      setItems(nextItems);
      setSelected((current) =>
        current
          ? nextItems.find((item) => item._id === current._id) ?? current
          : current,
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
    const timer = window.setTimeout(() => void load(), 200);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [search, status, page]);

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    const refresh = () => {
      void load();
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("geofence:updated", refresh);
    socket.on("mission:status", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("geofence:updated", refresh);
      socket.off("mission:status", refresh);
      socket.off("connect", refresh);
    };
  }, [search, status, page]);

  const reset = () => {
    setSelected(undefined);
    setName("");
    setType("POLYGON");
    setPoints([]);
    setCenter(undefined);
    setHome(HOME);
    setRadius(180);
    setActive(true);
    setError("");
  };

  const edit = (geofence: Geofence) => {
    setSelected(geofence);
    setName(geofence.name);
    setType(geofence.type);
    setPoints(geofence.polygon ?? []);
    setCenter(geofence.center);
    setHome(geofence.homePosition);
    setRadius(geofence.radiusMeters ?? 180);
    setActive(geofence.isActive);
    setError("");
  };

  const save = async () => {
    if (saving || user?.role !== "ADMIN") return;
    setError("");
    setSaving(true);
    try {
      const body = {
        name,
        type,
        polygon: type === "POLYGON" ? points : undefined,
        center: type === "CIRCLE" ? center : undefined,
        radiusMeters: type === "CIRCLE" ? radius : undefined,
        homePosition: home,
        isActive: active,
      };
      selected
        ? await api.patch(`/geofences/${selected._id}`, body)
        : await api.post("/geofences", body);
      notify("Geofence saved", "success");
      reset();
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || removing || saving || user?.role !== "ADMIN") return;
    setRemoving(true);
    try {
      if (
        !await confirm({
          title: "Archive geofence",
          message: "Existing flight records will keep their safety history.",
          confirmLabel: "Archive",
          danger: true,
        })
      )
        return;
      await api.delete(`/geofences/${selected._id}`);
      notify("Geofence archived", "success");
      reset();
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRemoving(false);
    }
  };

  const exportAll = async () => {
    if (!meta.total || loading || exporting || saving || removing) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/geofences/export", {
        params: { search, status },
        responseType: "blob",
      });
      downloadBlob(
        `geofences-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} geofence records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("Geofence export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  const shapeReady = type === "POLYGON" ? points.length >= 3 : !!center;
  return (
    <>
      <PageTitle
        eyebrow="SAFETY"
        title="Geofences"
        text="Define approved operating areas. A breach creates a critical alert and triggers return-to-home."
        action={
          <div className="action-row">
            <button
              className="secondary"
              disabled={!meta.total || loading || exporting || saving || removing}
              onClick={() => void exportAll()}
            >
              <Download />
              {exporting ? "Exporting..." : "Export all matching"}
            </button>
            {user?.role === "ADMIN" && (
              <button
                className="secondary"
                disabled={saving || removing}
                onClick={reset}
              >
                <Plus />
                New zone
              </button>
            )}
          </div>
        }
      />
      {error && <div className="form-error page-error">{error}</div>}
      <div className="geo-layout">
        <Panel title="Safety zones">
          <div className="toolbar geofence-filters">
            <div className="search">
              <Search />
              <input
                aria-label="Search geofences"
                placeholder="Search zone name..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Geofence status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option>ACTIVE</option>
              <option>INACTIVE</option>
            </select>
            <span className="result-count">{meta.total} zones</span>
          </div>
          <div className="zone-list">
            {loading && <div className="loading">Loading safety zones...</div>}
            {!loading &&
              items.map((geofence) => (
                <button
                  key={geofence._id}
                  className={
                    selected?._id === geofence._id
                      ? "zone-item selected"
                      : "zone-item"
                  }
                  disabled={saving || removing}
                  onClick={() => edit(geofence)}
                >
                  <div>
                    <b>{geofence.name}</b>
                    <small>
                      {geofence.type} · {geofence.type === "POLYGON"
                        ? `${geofence.polygon?.length ?? 0} vertices`
                        : `${geofence.radiusMeters} m radius`}
                    </small>
                  </div>
                  <StatusBadge
                    status={geofence.isActive ? "ACTIVE" : "INACTIVE"}
                  />
                </button>
              ))}
            {!loading && !items.length && (
              <Empty
                title="No safety zones"
                text="Adjust the filters or create a polygon or circular boundary."
              />
            )}
          </div>
          <div className="pagination">
            <button
              className="secondary small"
              disabled={page <= 1 || loading || saving || removing}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(meta.pages, 1)}
            </span>
            <button
              className="secondary small"
              disabled={page >= meta.pages || loading || saving || removing}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </Panel>
        <Panel title={selected ? "Edit zone" : "Create zone"}>
          <div className="geo-form">
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Main campus boundary"
                disabled={saving || removing}
              />
            </label>
            <label>
              Shape
              <select
                value={type}
                disabled={saving || removing}
                onChange={(event) => {
                  setType(event.target.value as "POLYGON" | "CIRCLE");
                  setPoints([]);
                  setCenter(undefined);
                }}
              >
                <option>POLYGON</option>
                <option>CIRCLE</option>
              </select>
            </label>
            {type === "CIRCLE" && (
              <label>
                Radius (meters)
                <input
                  type="number"
                  min={20}
                  max={10000}
                  value={radius}
                  disabled={saving || removing}
                  onChange={(event) => setRadius(Number(event.target.value))}
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={active}
                disabled={saving || removing}
                onChange={(event) => setActive(event.target.checked)}
              />
              Active for missions
            </label>
          </div>
          <GeofenceEditorMap
            type={type}
            points={points}
            center={center}
            radius={radius}
            home={home}
            interactive={!saving && !removing}
            onMapClick={(point) =>
              type === "POLYGON"
                ? setPoints((value) => [...value, point])
                : setCenter(point)
            }
            onMovePoint={(index, point) =>
              type === "POLYGON"
                ? setPoints((value) =>
                    value.map((current, number) =>
                      number === index ? point : current,
                    ),
                  )
                : setCenter(point)
            }
          />
          <div className="panel-actions">
            <span className="home-readout">
              Home {home.latitude.toFixed(5)}, {home.longitude.toFixed(5)}
            </span>
            <button
              className="secondary"
              disabled={
                saving ||
                removing ||
                (type === "CIRCLE" ? !center : !points.length)
              }
              onClick={() => setHome(type === "CIRCLE" ? center! : points[0])}
            >
              <MapPin />
              Move home inside
            </button>
            <button
              className="secondary"
              disabled={saving || removing}
              onClick={() =>
                type === "POLYGON" ? setPoints([]) : setCenter(undefined)
              }
            >
              <RotateCcw />
              Clear shape
            </button>
            {selected && (
              <button
                className="stop"
                disabled={user?.role !== "ADMIN" || saving || removing}
                onClick={() => void remove()}
              >
                <Trash2 />
                {removing ? "Archiving..." : "Archive"}
              </button>
            )}
            <button
              className="primary"
              onClick={() => void save()}
              disabled={
                user?.role !== "ADMIN" ||
                saving ||
                removing ||
                !name ||
                !shapeReady
              }
            >
              <Save />
              {saving ? "Saving..." : "Save zone"}
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}
