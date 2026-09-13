import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { aircraftIcon } from "./map-icons";
import { GeofenceLayers } from "./map-display";
import type { Coordinate, Geofence, Waypoint } from "./types";

const DEFAULT: Coordinate = { latitude: 10.762622, longitude: 106.660172 };
const dotIcon = (label: string, tone = "blue") => L.divIcon({ className: "map-pin-wrap", html: `<span class="map-pin ${tone}">${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function MapClick({ onClick }: { onClick: (point: Coordinate) => void }) {
  useMapEvents({ click: (event) => onClick({ latitude: event.latlng.lat, longitude: event.latlng.lng }) });
  return null;
}

export function MissionEditorMap({ home = DEFAULT, waypoints, geofence, invalidIndexes = [], onAdd, onMove, interactive = true }: { home?: Coordinate; waypoints: Waypoint[]; geofence?: Geofence; invalidIndexes?: number[]; onAdd: (point: Coordinate) => void; onMove: (index: number, point: Coordinate) => void; interactive?: boolean }) {
  const center: [number, number] = [home.latitude, home.longitude];
  return <div className="map-frame editor-map"><MapContainer center={center} zoom={16} className="map" scrollWheelZoom>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {interactive && <MapClick onClick={onAdd} />}
    {geofence?.type === "POLYGON" && <Polygon positions={(geofence.polygon ?? []).map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#f59e0b", fillOpacity: .08 }} />}
    {geofence?.type === "CIRCLE" && geofence.center && <Circle center={[geofence.center.latitude, geofence.center.longitude]} radius={geofence.radiusMeters ?? 100} pathOptions={{ color: "#f59e0b", fillOpacity: .08 }} />}
    <Marker position={center} icon={dotIcon("H", "green")}><Tooltip>Home</Tooltip></Marker>
    {waypoints.length > 0 && <Polyline positions={[center, ...waypoints.map((p) => [p.latitude, p.longitude] as [number, number])]} pathOptions={{ color: "#60a5fa", weight: 3, dashArray: "7 6" }} />}
    {waypoints.map((point, index) => <Marker key={index} position={[point.latitude, point.longitude]} icon={dotIcon(String(index + 1), invalidIndexes.includes(index) ? "red" : "blue")} draggable={interactive} eventHandlers={interactive ? { dragend: (event) => { const p = event.target.getLatLng(); onMove(index, { latitude: p.lat, longitude: p.lng }); } } : undefined}><Tooltip permanent direction="top">WP {index + 1}{invalidIndexes.includes(index) ? " · OUTSIDE" : ""}</Tooltip></Marker>)}
  </MapContainer></div>;
}

export function GeofenceEditorMap({ type, points, center, radius, home, onMapClick, onMovePoint, interactive = true }: { type: "POLYGON" | "CIRCLE"; points: Coordinate[]; center?: Coordinate; radius: number; home: Coordinate; onMapClick: (point: Coordinate) => void; onMovePoint: (index: number, point: Coordinate) => void; interactive?: boolean }) {
  return <div className="map-frame editor-map"><MapContainer center={[home.latitude, home.longitude]} zoom={16} className="map" scrollWheelZoom>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{interactive && <MapClick onClick={onMapClick} />}
    {type === "POLYGON" && points.length > 1 && <Polygon positions={points.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#f59e0b", fillOpacity: .12 }} />}
    {type === "CIRCLE" && center && <Circle center={[center.latitude, center.longitude]} radius={radius} pathOptions={{ color: "#f59e0b", fillOpacity: .12 }} />}
    <Marker position={[home.latitude, home.longitude]} icon={dotIcon("H", "green")} />
    {type === "POLYGON" && points.map((point, index) => <Marker key={index} position={[point.latitude, point.longitude]} icon={dotIcon(String(index + 1), "amber")} draggable={interactive} eventHandlers={interactive ? { dragend: (event) => { const p = event.target.getLatLng(); onMovePoint(index, { latitude: p.lat, longitude: p.lng }); } } : undefined} />)}
    {type === "CIRCLE" && center && <Marker position={[center.latitude, center.longitude]} icon={dotIcon("C", "amber")} draggable={interactive} eventHandlers={interactive ? { dragend: (event) => { const p = event.target.getLatLng(); onMovePoint(0, { latitude: p.lat, longitude: p.lng }); } } : undefined} />}
  </MapContainer></div>;
}

export function ReplayEventMap({ points, index, home, planned = [], events = [], geofences = [] }: { points: Array<{ latitude: number; longitude: number; heading?: number; timestamp?: string }>; index: number; home?: Coordinate; planned?: Coordinate[]; events?: Array<Coordinate & { label: string; severity: string; time?: string }>; geofences?: Geofence[] }) {
  const visible = useMemo(() => points.slice(0, index + 1), [points, index]);
  const latest = visible.at(-1); const origin = home ?? DEFAULT;
  const visibleEvents = useMemo(() => events.filter((event) => !event.time || !latest?.timestamp || new Date(event.time).getTime() <= new Date(latest.timestamp).getTime()), [events, latest]);
  return <div className="map-frame replay-map"><div className="map-orientation-legend" aria-label="Aircraft marker orientation"><span>▲</span> NOSE = HEADING</div><MapContainer center={[latest?.latitude ?? origin.latitude, latest?.longitude ?? origin.longitude]} zoom={16} className="map" scrollWheelZoom>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <GeofenceLayers geofences={geofences} includeInactive />
    {planned.length > 1 && <Polyline positions={planned.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#94a3b8", weight: 2, opacity: .65, dashArray: "7 7" }} />}
    {visible.length > 1 && <Polyline positions={visible.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#60a5fa", weight: 3 }} />}
    <CircleMarker center={[origin.latitude, origin.longitude]} radius={5} pathOptions={{ color: "#22c55e", fillOpacity: .9 }} />
    {latest && <Marker position={[latest.latitude, latest.longitude]} icon={aircraftIcon({ heading: latest.heading })}><Tooltip permanent>DRONE</Tooltip></Marker>}
    <ReplayFollowLatest point={latest} />
    {visibleEvents.map((event, eventIndex) => <CircleMarker key={eventIndex} center={[event.latitude, event.longitude]} radius={5} pathOptions={{ color: event.severity === "CRITICAL" ? "#ef4444" : "#f59e0b", fillOpacity: .9 }}><Tooltip>{event.label}</Tooltip></CircleMarker>)}
  </MapContainer></div>;
}

function ReplayFollowLatest({ point }: { point?: { latitude: number; longitude: number } }) { const map = useMap(); useEffect(() => { if (point) map.setView([point.latitude, point.longitude], map.getZoom(), { animate: false }); }, [map, point?.latitude, point?.longitude]); return null; }
