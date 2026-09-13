import { useEffect, useMemo } from "react";
import { Circle, CircleMarker, LayerGroup, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { telemetryState } from "./lib";
import { aircraftIcon } from "./map-icons";
import { routePatternLabel, type Coordinate, type Drone, type Geofence, type Telemetry } from "./types";

function FlyToLatest({ point }: { point?: Telemetry }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    // A live packet can arrive while React is unmounting the map during
    // navigation. Avoid leaving Leaflet's zoom-transition callback alive
    // after the map pane has been removed.
    map.setView([point.latitude, point.longitude], map.getZoom(), { animate: false });
  }, [map, point?.sequence]);
  return null;
}

function FollowSelected({ point, droneId }: { point?: Telemetry; droneId?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 15), { animate: false });
  }, [droneId, map, point?.latitude, point?.longitude, point?.sequence]);
  return null;
}

function visibleGeofences(geofences: Geofence[] = [], includeInactive = false) {
  return geofences.filter((geofence) => includeInactive || geofence.isActive);
}

export function GeofenceLayers({ geofences = [], includeInactive = false }: { geofences?: Geofence[]; includeInactive?: boolean }) {
  return <>
    {visibleGeofences(geofences, includeInactive).map((geofence) => {
      if (geofence.type === "POLYGON" && (geofence.polygon?.length ?? 0) >= 3)
        return <Polygon key={geofence._id} positions={geofence.polygon!.map((point) => [point.latitude, point.longitude] as [number, number])} pathOptions={{ color: "#f59e0b", weight: 2, fillColor: "#f59e0b", fillOpacity: .08, dashArray: "7 6" }}><Tooltip>{geofence.name}</Tooltip></Polygon>;
      if (geofence.type === "CIRCLE" && geofence.center && geofence.radiusMeters)
        return <Circle key={geofence._id} center={[geofence.center.latitude, geofence.center.longitude]} radius={geofence.radiusMeters} pathOptions={{ color: "#f59e0b", weight: 2, fillColor: "#f59e0b", fillOpacity: .08, dashArray: "7 6" }}><Tooltip>{geofence.name}</Tooltip></Circle>;
      return null;
    })}
  </>;
}

export function GeofenceLegend({ geofences = [], includeInactive = false, title = "ACTIVE ZONES" }: { geofences?: Geofence[]; includeInactive?: boolean; title?: string }) {
  const items = visibleGeofences(geofences, includeInactive);
  if (!items.length) return null;
  return <div className="map-geofence-legend" aria-label="Active geofence legend">
    <header><span><i />{title}</span><small>{items.length}</small></header>
    {items.map((geofence) => <div key={geofence._id}><i /><span>{geofence.name}</span><small>{geofence.type === "CIRCLE" ? `${geofence.radiusMeters ?? 0} m` : `${geofence.polygon?.length ?? 0} pts`}</small></div>)}
  </div>;
}

export function FlightMap({ points, home, geofences = [], height = 390 }: { points: Telemetry[]; home?: Coordinate; geofences?: Geofence[]; height?: number }) {
  const latest = points.at(-1);
  const origin = home ?? { latitude: 10.762622, longitude: 106.660172 };
  const center: [number, number] = latest ? [latest.latitude, latest.longitude] : [origin.latitude, origin.longitude];
  return <div className="map-frame" style={{ height }}>
    <div className="map-orientation-legend" aria-label="Aircraft marker orientation"><span>▲</span> NOSE = HEADING</div>
    <GeofenceLegend geofences={geofences} />
    <MapContainer center={center} zoom={16} scrollWheelZoom className="map">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <GeofenceLayers geofences={geofences} />
      {points.length > 1 && <Polyline positions={points.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: "#3b82f6", weight: 3 }} />}
      {latest && <Marker position={center} icon={aircraftIcon({ heading: latest.heading })}><Tooltip permanent direction="top">DRONE</Tooltip></Marker>}
      <CircleMarker center={[origin.latitude, origin.longitude]} radius={5} pathOptions={{ color: "#22c55e", fillOpacity: .8 }}><Tooltip>Home</Tooltip></CircleMarker>
      <FlyToLatest point={latest} />
    </MapContainer>
  </div>;
}

const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#22d3ee", "#fb7185", "#a3e635", "#f97316", "#c084fc"];

function geofenceBoundsPoints(geofences: Geofence[]) {
  return geofences.flatMap((geofence) => {
    if (geofence.type === "POLYGON")
      return (geofence.polygon ?? []).map((point) => [point.latitude, point.longitude] as [number, number]);
    if (!geofence.center) return [];
    const radius = geofence.radiusMeters ?? 0;
    const latitudeDelta = radius / 111_320;
    const longitudeDelta = radius / (111_320 * Math.max(Math.cos((geofence.center.latitude * Math.PI) / 180), 0.1));
    return [
      [geofence.center.latitude - latitudeDelta, geofence.center.longitude - longitudeDelta],
      [geofence.center.latitude + latitudeDelta, geofence.center.longitude + longitudeDelta],
    ] as [number, number][];
  });
}

function FitFleet({ points, geofences = [] }: { points: Telemetry[]; geofences?: Geofence[] }) {
  const map = useMap();
  const boundsPoints = [...points.map((point) => [point.latitude, point.longitude] as [number, number]), ...geofenceBoundsPoints(visibleGeofences(geofences))];
  const fitKey = [
    ...points.map((point) => point.droneId),
    ...visibleGeofences(geofences).map((geofence) => {
      const shape = geofence.type === "POLYGON"
        ? (geofence.polygon ?? []).map((point) => `${point.latitude}:${point.longitude}`).join(",")
        : `${geofence.center?.latitude ?? ""}:${geofence.center?.longitude ?? ""}:${geofence.radiusMeters ?? ""}`;
      return `${geofence._id}:${shape}`;
    }),
  ].join("|");
  useEffect(() => {
    if (!boundsPoints.length) return;
    if (boundsPoints.length === 1) map.setView(boundsPoints[0], Math.max(map.getZoom(), 15), { animate: false });
    else map.fitBounds(boundsPoints, { padding: [35, 35], maxZoom: 16, animate: false });
  }, [fitKey]);
  return null;
}

export function FleetMap({ drones, pointsByDrone, routeByDrone = {}, telemetryStatusByDrone = {}, geofences = [], selectedDroneId, onSelect, height = 520 }: { drones: Drone[]; pointsByDrone: Record<string, Telemetry[]>; routeByDrone?: Record<string, string | undefined>; telemetryStatusByDrone?: Record<string, string>; geofences?: Geofence[]; selectedDroneId?: string; onSelect: (id: string) => void; height?: number }) {
  const latestPoints = useMemo(() => drones.map((drone) => pointsByDrone[drone._id]?.at(-1)).filter(Boolean) as Telemetry[], [drones, pointsByDrone]);
  const selectedPoint = selectedDroneId ? pointsByDrone[selectedDroneId]?.at(-1) : undefined;
  return <div className="map-frame" style={{ height }}>
    <div className="map-orientation-legend" aria-label="Aircraft marker orientation"><span>▲</span> NOSE = HEADING</div>
    <GeofenceLegend geofences={geofences} />
    {drones.length > 0 && <div className="fleet-map-legend" aria-label="Fleet route legend"><header>FLEET ROUTES <small>{drones.length}</small></header>{drones.map((drone, index) => { const route = routeByDrone[drone._id]; const status = telemetryStatusByDrone[drone._id] ?? (pointsByDrone[drone._id]?.length ? telemetryState(pointsByDrone[drone._id]?.at(-1)?.timestamp) : "STANDBY"); return <button type="button" key={drone._id} className={selectedDroneId === drone._id ? "fleet-map-legend-item selected" : "fleet-map-legend-item"} onClick={() => onSelect(drone._id)} title={`${route ? routePatternLabel(route) : "Waiting for route assignment"} · ${status}`}><i style={{ background: colors[index % colors.length] }} /><span><b>{drone.droneCode}</b><small>{route ? routePatternLabel(route) : "Waiting"} · {status}</small></span></button>; })}</div>}
    <MapContainer center={[10.762622, 106.660172]} zoom={14} scrollWheelZoom className="map">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <GeofenceLayers geofences={geofences} />
      {drones.map((drone, index) => {
        const points = pointsByDrone[drone._id] ?? [];
        const latest = points.at(-1);
        const color = colors[index % colors.length];
        const selected = selectedDroneId === drone._id;
        const status = telemetryStatusByDrone[drone._id] ?? (latest ? telemetryState(latest.timestamp) : "STANDBY");
        return <LayerGroup key={drone._id}>
          {points.length > 1 && <Polyline positions={points.map((point) => [point.latitude, point.longitude] as [number, number])} pathOptions={{ color, weight: selected ? 4 : 2, opacity: selectedDroneId && !selected ? .42 : .9 }} />}
          {latest && <Marker position={[latest.latitude, latest.longitude]} icon={aircraftIcon({ heading: latest.heading, color, selected, status: status as "LIVE" | "WAITING" | "STALE" | "STANDBY" })} eventHandlers={{ click: () => onSelect(drone._id) }}>
            <Tooltip permanent={selected} direction="top">{drone.droneCode}{status !== "LIVE" ? ` · ${status}` : ""}</Tooltip>
          </Marker>}
        </LayerGroup>;
      })}
      <FitFleet points={latestPoints} geofences={geofences} />
      <FollowSelected point={selectedPoint} droneId={selectedDroneId} />
    </MapContainer>
  </div>;
}
