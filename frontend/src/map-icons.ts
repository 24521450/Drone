import L from "leaflet";

type AircraftIconOptions = {
  heading?: number;
  color?: string;
  selected?: boolean;
  status?: "LIVE" | "WAITING" | "STALE" | "STANDBY";
};

/** A small, compass-oriented aircraft glyph for live and replay maps. */
export function aircraftIcon({ heading = 0, color = "#3b82f6", selected = false, status = "LIVE" }: AircraftIconOptions = {}) {
  const safeHeading = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0;
  const statusClass = status === "STALE" ? " stale" : status === "STANDBY" ? " standby" : "";
  const className = `${selected ? "aircraft-marker selected" : "aircraft-marker"}${statusClass}`;
  return L.divIcon({
    className: "aircraft-icon-wrap",
    html: `<span class="${className}" style="--aircraft-color:${color};--aircraft-heading:${safeHeading}deg"></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
