export type MediaType = "PHOTO" | "VIDEO";
export type MediaSensorType = "RGB" | "THERMAL" | "MULTISPECTRAL";

export type MediaTelemetryInput = {
  timestamp?: Date | string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
};

export type MediaFlightInput = {
  id: string;
  droneId: string;
  droneCode?: string;
  missionId?: string;
  startedAt: Date | string;
  status?: string;
  telemetry?: MediaTelemetryInput;
};

export type MediaAsset = {
  mediaId: string;
  mediaType: MediaType;
  sensorType: MediaSensorType;
  capturedAt: string;
  droneId: string;
  droneCode: string;
  flightId: string;
  missionId?: string;
  latitude: number;
  longitude: number;
  altitude: number;
  durationSeconds?: number;
  fileLocation: string;
  status: "AVAILABLE";
  virtual: boolean;
};

export type MediaLibrary = {
  generatedAt: string;
  source: "SIMULATED_CAPTURE";
  sourceLabel: string;
  summary: {
    total: number;
    photos: number;
    videos: number;
    rgb: number;
    thermal: number;
    multispectral: number;
    latestCapture: string | null;
  };
  items: MediaAsset[];
};

/**
 * Build the counters shown next to a media query. Keeping this calculation
 * in one place prevents the API from accidentally returning the full catalog
 * counters for a filtered result set.
 */
export function summarizeMediaItems(items: MediaAsset[]): MediaLibrary["summary"] {
  let photos = 0;
  let videos = 0;
  let rgb = 0;
  let thermal = 0;
  let multispectral = 0;
  let latestCapture: string | null = null;
  let latestCaptureTime = Number.NaN;

  for (const item of items) {
    if (item.mediaType === "PHOTO") photos += 1;
    if (item.mediaType === "VIDEO") videos += 1;
    if (item.sensorType === "RGB") rgb += 1;
    if (item.sensorType === "THERMAL") thermal += 1;
    if (item.sensorType === "MULTISPECTRAL") multispectral += 1;

    const capturedAtTime = Date.parse(item.capturedAt);
    if (
      latestCapture === null ||
      (!Number.isNaN(capturedAtTime) &&
        (Number.isNaN(latestCaptureTime) || capturedAtTime > latestCaptureTime))
    ) {
      latestCapture = item.capturedAt;
      latestCaptureTime = capturedAtTime;
    }
  }

  return {
    total: items.length,
    photos,
    videos,
    rgb,
    thermal,
    multispectral,
    latestCapture,
  };
}

const round = (value: number, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
};
const safeDate = (value: Date | string | undefined, fallback: Date) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const demoFlights: MediaFlightInput[] = [
  {
    id: "demo-flight-001",
    droneId: "demo-drone-001",
    droneCode: "DRONE-001",
    startedAt: "2026-09-13T06:40:00.000Z",
    status: "COMPLETED",
  },
  {
    id: "demo-flight-002",
    droneId: "demo-drone-002",
    droneCode: "DRONE-002",
    startedAt: "2026-09-13T07:25:00.000Z",
    status: "COMPLETED",
  },
  {
    id: "demo-flight-003",
    droneId: "demo-drone-003",
    droneCode: "DRONE-003",
    startedAt: "2026-09-13T08:10:00.000Z",
    status: "COMPLETED",
  },
  {
    id: "demo-flight-004",
    droneId: "demo-drone-004",
    droneCode: "DRONE-004",
    startedAt: "2026-09-13T08:55:00.000Z",
    status: "COMPLETED",
  },
];

function createAssetsForFlight(
  flight: MediaFlightInput,
  index: number,
  now: Date,
  virtual: boolean,
): MediaAsset[] {
  const seed = hash(flight.id);
  const telemetry = flight.telemetry;
  const startedAt = safeDate(flight.startedAt, now);
  const baseCapture = telemetry?.timestamp
    ? safeDate(telemetry.timestamp, now)
    : new Date(Math.min(now.getTime(), startedAt.getTime() + 45_000));
  const centerLatitude = Number.isFinite(telemetry?.latitude)
    ? Number(telemetry!.latitude)
    : 10.7607 + (index % 2) * 0.0042;
  const centerLongitude = Number.isFinite(telemetry?.longitude)
    ? Number(telemetry!.longitude)
    : 106.652 + (index % 5) * 0.0042;
  const altitude = Number.isFinite(telemetry?.altitude)
    ? Math.max(0, Math.round(Number(telemetry!.altitude)))
    : 35 + (seed % 50);
  const captureDefinitions: Array<{
    mediaType: MediaType;
    sensorType: MediaSensorType;
    secondsAfter: number;
    durationSeconds?: number;
    extension: string;
  }> = [
    { mediaType: "PHOTO", sensorType: "RGB", secondsAfter: 0, extension: "jpg" },
    { mediaType: "PHOTO", sensorType: "THERMAL", secondsAfter: 18, extension: "jpg" },
    {
      mediaType: "VIDEO",
      sensorType: "MULTISPECTRAL",
      secondsAfter: 36,
      durationSeconds: 18 + (seed % 12),
      extension: "mp4",
    },
  ];
  return captureDefinitions.map((definition, captureIndex) => {
    const mediaId = `media-${flight.id}-${definition.sensorType.toLowerCase()}-${definition.mediaType.toLowerCase()}`;
    const capturedAt = new Date(
      Math.min(now.getTime(), baseCapture.getTime() + definition.secondsAfter * 1_000),
    );
    const latitude = centerLatitude + ((seed % 17) - 8) * 0.00001 + captureIndex * 0.000012;
    const longitude = centerLongitude + (((seed >>> 8) % 17) - 8) * 0.00001 + captureIndex * 0.000009;
    return {
      mediaId,
      mediaType: definition.mediaType,
      sensorType: definition.sensorType,
      capturedAt: capturedAt.toISOString(),
      droneId: flight.droneId,
      droneCode: flight.droneCode ?? `AIRCRAFT-${index + 1}`,
      flightId: flight.id,
      ...(flight.missionId ? { missionId: flight.missionId } : {}),
      latitude: round(latitude),
      longitude: round(longitude),
      altitude,
      ...(definition.durationSeconds
        ? { durationSeconds: definition.durationSeconds }
        : {}),
      fileLocation: `/demo-media/${mediaId}.${definition.extension}`,
      status: "AVAILABLE" as const,
      virtual,
    };
  });
}

export function buildMediaLibrary(input: {
  now?: Date;
  flights?: MediaFlightInput[];
} = {}): MediaLibrary {
  const now = input.now ?? new Date();
  const virtual = !(input.flights?.length);
  const flights = virtual ? demoFlights : input.flights!;
  const items = flights
    .flatMap((flight, index) => createAssetsForFlight(flight, index, now, virtual))
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  return {
    generatedAt: now.toISOString(),
    source: "SIMULATED_CAPTURE",
    sourceLabel: "Demo media catalog",
    summary: summarizeMediaItems(items),
    items,
  };
}
