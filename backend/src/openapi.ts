import { ROUTE_PATTERNS } from "./types.js";

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Drone Monitoring API",
    version: "1.0.0",
    description:
      "REST API for users, drones, realtime simulations, flights and alerts.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Coordinate: {
        type: "object",
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
      },
      Waypoint: {
        type: "object",
        required: ["order", "latitude", "longitude", "altitude", "speed"],
        properties: {
          order: { type: "integer" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          altitude: { type: "number", minimum: 10, maximum: 150 },
          speed: { type: "number", minimum: 1, maximum: 20 },
        },
      },
      RoutePattern: {
        type: "string",
        enum: [...ROUTE_PATTERNS],
        description:
          "Demo navigation path generated around the drone home position.",
      },
      Telemetry: {
        type: "object",
        required: [
          "flightId",
          "droneId",
          "timestamp",
          "sequence",
          "battery",
          "latitude",
          "longitude",
          "altitude",
          "speed",
          "heading",
          "gpsSatellites",
          "signal",
          "flightMode",
          "routePattern",
          "flightPhase",
        ],
        properties: {
          flightId: { type: "string" },
          droneId: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          sequence: { type: "integer" },
          battery: { type: "number", minimum: 0, maximum: 100 },
          latitude: { type: "number" },
          longitude: { type: "number" },
          altitude: { type: "number" },
          speed: { type: "number" },
          heading: {
            type: "number",
            minimum: 0,
            maximum: 360,
            description: "Compass heading in degrees clockwise from north",
          },
          gpsSatellites: { type: "integer" },
          signal: { type: "number", minimum: 0, maximum: 100 },
          flightMode: { type: "string" },
          routePattern: { $ref: "#/components/schemas/RoutePattern" },
          flightPhase: { type: "string" },
          waypointIndex: {
            type: "integer",
            minimum: 0,
            description: "Current mission waypoint (1-based); 0 is home/takeoff",
          },
          waypointCount: {
            type: "integer",
            minimum: 1,
            description: "Total mission waypoints; omitted for free-flight simulations",
          },
        },
      },
      HealthSnapshot: {
        type: "object",
        required: ["status", "database", "uptimeSeconds", "timestamp"],
        properties: {
          status: { type: "string", enum: ["online", "degraded"] },
          database: { type: "string", enum: ["connected", "disconnected"] },
          databaseLatencyMs: { type: "number", nullable: true },
          uptimeSeconds: { type: "integer" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      ApiError: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        servers: [{ url: "/" }],
        summary: "Public liveness and database health",
        responses: {
          "200": {
            description: "Service health snapshot",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { $ref: "#/components/schemas/HealthSnapshot" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        servers: [{ url: "/" }],
        summary: "Public readiness probe",
        responses: {
          "200": { description: "Service is ready to receive traffic" },
          "503": {
            description: "Database is not ready",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Sign in",
        responses: {
          "200": { description: "Authenticated" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/me": {
      get: {
        summary: "Current user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "User profile" } },
      },
    },
    "/auth/logout": {
      post: {
        summary: "Sign out and record the session event",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Signed out" } },
      },
    },
    "/users": {
      get: {
        summary: "List users with optional filters and pagination (admin)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
          {
            name: "role",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ADMIN", "VIEWER"],
              default: "ALL",
            },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "DISABLED"],
              default: "ALL",
            },
          },
          {
            name: "page",
            in: "query",
            description:
              "When page or limit is supplied, the response includes pagination metadata.",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        ],
        responses: {
          "200": {
            description:
              "User list; paginated responses include page, limit, total and pages metadata",
          },
        },
      },
      post: {
        summary: "Create user (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/users/export": {
      get: {
        summary: "Export filtered user records as CSV (admin)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
          {
            name: "role",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ADMIN", "VIEWER"],
              default: "ALL",
            },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "DISABLED"],
              default: "ALL",
            },
          },
        ],
        responses: {
          "200": { description: "CSV user export" },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/drones": {
      get: {
        summary: "List drones, optionally paginated",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "OFFLINE", "ONLINE", "IN_FLIGHT", "WARNING"],
              default: "ALL",
            },
          },
          {
            name: "demo",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
          },
          {
            name: "page",
            in: "query",
            description:
              "When page or limit is supplied, the response includes pagination metadata.",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        ],
        responses: {
          "200": {
            description:
              "Drone list; paginated responses include page, limit, total and pages metadata",
          },
        },
      },
      post: {
        summary: "Create drone (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/drones/export": {
      get: {
        summary: "Export filtered drone records as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "OFFLINE", "ONLINE", "IN_FLIGHT", "WARNING"],
              default: "ALL",
            },
          },
          {
            name: "demo",
            in: "query",
            schema: { type: "string", enum: ["true", "false"] },
          },
        ],
        responses: {
          "200": { description: "CSV drone export" },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/drones/seed-demo": {
      post: {
        summary: "Create or complete the 10-drone demo fleet (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Demo fleet ready" } },
      },
    },
    "/drones/prepare-demo": {
      post: {
        summary: "Recharge and reconnect the idle demo fleet (admin)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Demo fleet prepared" },
          "409": { description: "Fleet is in flight or maintenance" },
        },
      },
    },
    "/drones/readiness": {
      get: {
        summary: "Fleet preflight readiness checks",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Readiness summary and checks" } },
      },
    },
    "/drones/{id}": {
      get: {
        summary: "Drone detail",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Drone" } },
      },
      patch: {
        summary: "Update drone (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        summary: "Archive drone (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Archived" } },
      },
    },
    "/drones/{id}/readiness": {
      get: {
        summary: "Aircraft preflight readiness checks",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Readiness checklist" } },
      },
    },
    "/geofences": {
      get: {
        summary: "List geofences with optional filters and pagination",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "INACTIVE"],
              default: "ALL",
            },
          },
          {
            name: "page",
            in: "query",
            description:
              "When page or limit is supplied, the response includes pagination metadata.",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        ],
        responses: {
          "200": {
            description:
              "Geofence list; paginated responses include page, limit, total and pages metadata",
          },
        },
      },
      post: {
        summary: "Create geofence (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/geofences/export": {
      get: {
        summary: "Export filtered geofence records as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "INACTIVE"],
              default: "ALL",
            },
          },
        ],
        responses: {
          "200": { description: "CSV geofence export" },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/geofences/{id}": {
      get: {
        summary: "Geofence detail",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Geofence" } },
      },
      patch: {
        summary: "Update geofence (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        summary: "Archive geofence (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Archived" } },
      },
    },
    "/mission-templates": {
      get: {
        summary: "List mission templates",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Template catalog" } },
      },
    },
    "/mission-templates/generate": {
      post: {
        summary: "Generate waypoint route from a template",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Generated ordered waypoints" } },
      },
    },
    "/missions": {
      get: {
        summary: "List missions",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Mission list" } },
      },
      post: {
        summary: "Create mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Created" } },
      },
    },
    "/missions/{id}": {
      get: {
        summary: "Mission detail",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Mission" } },
      },
      patch: {
        summary: "Update mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        summary: "Archive mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Archived" } },
      },
    },
    "/missions/{id}/start": {
      post: {
        summary: "Start mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Mission started" } },
      },
    },
    "/missions/{id}/validate": {
      post: {
        summary: "Validate mission and calculate estimates",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Validation issues, distance, duration and battery estimate",
          },
        },
      },
    },
    "/missions/{id}/duplicate": {
      post: {
        summary: "Duplicate mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Mission copy created" } },
      },
    },
    "/mission-schedule": {
      get: {
        summary:
          "List scheduled missions with status counts and due-today total",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics",
          },
        ],
        responses: { "200": { description: "Mission schedule queue" } },
      },
    },
    "/mission-schedule/export": {
      get: {
        summary: "Export all filtered scheduled missions as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "scheduleStatus",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: [
                "ALL",
                "SCHEDULED",
                "PROCESSING",
                "STARTED",
                "FAILED",
                "CANCELLED",
              ],
              default: "ALL",
            },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics",
          },
        ],
        responses: {
          "200": {
            description: "CSV mission schedule export",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/missions/{id}/schedule": {
      post: {
        summary: "Schedule automatic mission start (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Mission scheduled" } },
      },
      delete: {
        summary: "Cancel scheduled mission (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Schedule cancelled" } },
      },
    },
    "/commands": {
      get: {
        summary: "List flight commands",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: { "200": { description: "Command list" } },
      },
      post: {
        summary: "Issue flight command (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Command accepted" } },
      },
    },
    "/commands/{id}/retry": {
      post: {
        summary: "Retry a failed flight command (admin)",
        security: [{ bearerAuth: [] }],
        responses: {
          "201": { description: "Retry command accepted" },
          "404": { description: "Original command not found" },
          "409": {
            description:
              "Original command is not failed or its flight is no longer active",
          },
        },
      },
    },
    "/commands/export": {
      get: {
        summary: "Export all filtered flight commands as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
          {
            name: "flightId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: [
                "ALL",
                "REQUESTED",
                "ACKNOWLEDGED",
                "EXECUTING",
                "COMPLETED",
                "FAILED",
              ],
              default: "ALL",
            },
          },
          {
            name: "type",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "PAUSE", "RESUME", "RETURN_HOME", "LAND"],
              default: "ALL",
            },
          },
        ],
        responses: {
          "200": {
            description: "CSV command export",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/commands/fleet": {
      post: {
        summary:
          "Issue pause, resume, return-home or landing commands to active fleet flights",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["flightIds", "type"],
                properties: {
                  flightIds: {
                    type: "array",
                    minItems: 1,
                    maxItems: 10,
                    items: { type: "string" },
                  },
                  type: {
                    type: "string",
                    enum: ["PAUSE", "RESUME", "RETURN_HOME", "LAND"],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "All fleet commands completed" },
          "207": { description: "Some fleet commands failed" },
        },
      },
    },
    "/flights/simulate": {
      post: {
        summary:
          "Start simulated flight with up to three anomaly scenarios (admin)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["droneId"],
                properties: {
                  droneId: { type: "string" },
                  scenario: {
                    type: "string",
                    enum: ["NORMAL", "LOW_BATTERY", "GPS_WEAK"],
                    default: "NORMAL",
                  },
                  anomalies: {
                    type: "array",
                    maxItems: 3,
                    items: {
                      type: "string",
                      enum: [
                        "LOW_BATTERY",
                        "GPS_WEAK",
                        "SIGNAL_LOSS",
                        "WIND_DRIFT",
                        "GPS_DRIFT",
                        "EMERGENCY_LANDING",
                      ],
                    },
                  },
                  routePattern: { $ref: "#/components/schemas/RoutePattern" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Simulation started" } },
      },
    },
    "/flights/simulate-fleet": {
      post: {
        summary:
          "Start 10 simulated flights with independent route patterns (admin)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["assignments"],
                properties: {
                  assignments: {
                    type: "array",
                    minItems: 10,
                    maxItems: 10,
                    items: {
                      type: "object",
                      required: ["droneId", "routePattern"],
                      properties: {
                        droneId: { type: "string" },
                        routePattern: {
                          $ref: "#/components/schemas/RoutePattern",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Fleet simulation started" } },
      },
    },
    "/flights/stop-fleet": {
      post: {
        summary: "Stop a fleet simulation (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Fleet simulation completed" } },
      },
    },
    "/flights/{id}/stop": {
      post: {
        summary: "Stop simulated flight (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Flight completed" } },
      },
    },
    "/flights": {
      get: {
        summary: "Flight history",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "COMPLETED", "FAILED"],
              default: "ALL",
            },
          },
          {
            name: "droneId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: { "200": { description: "Paginated flights" } },
      },
    },
    "/flights/active/telemetry": {
      get: {
        summary: "Latest telemetry for every active flight",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 500, default: 120 },
            description: "Maximum telemetry points returned per active flight",
          },
        ],
        responses: {
          "200": {
            description: "Grouped telemetry for active flights",
          },
          "400": { description: "Invalid limit" },
        },
      },
    },
    "/flights/export": {
      get: {
        summary: "Export filtered flight history as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "COMPLETED", "FAILED"],
              default: "ALL",
            },
          },
          {
            name: "droneId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: {
          "200": {
            description: "CSV file with filtered flight records",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the row limit" },
        },
      },
    },
    "/flights/{id}": {
      get: {
        summary: "Flight detail",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Flight with alerts and command timeline" },
        },
      },
    },
    "/flights/{id}/telemetry": {
      get: {
        summary: "Flight telemetry packets with optional date range",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 5000, default: 1000 },
            description: "Maximum packets returned, ordered by sequence",
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: {
          "200": {
            description: "Telemetry points ordered by sequence",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Telemetry" },
                    },
                  },
                },
              },
            },
          },
          "404": { description: "Flight not found" },
        },
      },
    },
    "/flights/{id}/telemetry/export": {
      get: {
        summary: "Export all telemetry packets for a flight as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: {
          "200": {
            description: "CSV telemetry export",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "404": { description: "Flight not found" },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/flights/{id}/replay": {
      get: {
        summary: "Complete replay data",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Flight, telemetry, alerts and commands" },
        },
      },
    },
    "/alerts": {
      get: {
        summary: "List alerts",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: { "200": { description: "Alerts" } },
      },
    },
    "/alerts/export": {
      get: {
        summary: "Export filtered alerts as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"],
              default: "ALL",
            },
          },
          {
            name: "severity",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "WARNING", "CRITICAL"],
              default: "ALL",
            },
          },
          {
            name: "type",
            in: "query",
            required: false,
            schema: { type: "string", default: "ALL" },
          },
          {
            name: "droneId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters",
          },
        ],
        responses: {
          "200": {
            description: "CSV file with filtered alerts",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the row limit" },
        },
      },
    },
    "/alerts/{id}/acknowledge": {
      patch: {
        summary: "Acknowledge alert",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Acknowledged" } },
      },
    },
    "/alerts/bulk-acknowledge": {
      post: {
        summary: "Acknowledge up to 100 alerts (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Bulk acknowledgement result" } },
      },
    },
    "/alerts/{id}/resolve": {
      patch: {
        summary: "Resolve alert with an operator note (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Resolved alert" } },
      },
    },
    "/alert-rules": {
      get: {
        summary: "List configurable safety rules",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Alert rule configuration" } },
      },
    },
    "/alert-rules/{key}": {
      patch: {
        summary: "Update a safety rule (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Rule updated" } },
      },
    },
    "/alert-rules/reset": {
      post: {
        summary: "Reset safety rules to defaults (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Rules reset" } },
      },
    },
    "/audit-events": {
      get: {
        summary: "List administrative audit events",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local start date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local end date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics",
          },
        ],
        responses: { "200": { description: "Paginated audit history" } },
      },
    },
    "/audit-events/export": {
      get: {
        summary: "Export all filtered administrative audit events as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "action",
            in: "query",
            required: false,
            schema: { type: "string", default: "ALL" },
          },
          {
            name: "resourceType",
            in: "query",
            required: false,
            schema: { type: "string", default: "ALL" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
          },
        ],
        responses: {
          "200": {
            description: "CSV audit export",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/maintenance/health": {
      get: {
        summary: "Fleet health scores and maintenance risk",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Health score for every active drone" },
        },
      },
    },
    "/maintenance": {
      get: {
        summary: "List maintenance tasks",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
              default: "ALL",
            },
          },
          {
            name: "droneId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
            description: "Inclusive operator-local scheduled date",
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics",
          },
        ],
        responses: { "200": { description: "Paginated maintenance tasks" } },
      },
      post: {
        summary: "Schedule maintenance (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "201": { description: "Maintenance scheduled" } },
      },
    },
    "/maintenance/export": {
      get: {
        summary: "Export filtered maintenance tasks as CSV",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ALL", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
              default: "ALL",
            },
          },
          {
            name: "droneId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "dateFrom",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
          },
          {
            name: "dateTo",
            in: "query",
            required: false,
            schema: { type: "string", format: "date" },
          },
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
          },
        ],
        responses: {
          "200": {
            description: "CSV maintenance export",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "413": { description: "Export exceeds the maximum row count" },
        },
      },
    },
    "/maintenance/{id}": {
      patch: {
        summary: "Update maintenance task (admin)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Maintenance updated" } },
      },
    },
    "/dashboard/summary": {
      get: {
        summary: "Dashboard summary",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Metrics" } },
      },
    },
    "/system/status": {
      get: {
        summary: "Runtime service and connection status",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Database, WebSocket and adapter status for the current backend process",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        generatedAt: { type: "string", format: "date-time" },
                        source: { type: "string", enum: ["RUNTIME"] },
                        sourceLabel: { type: "string" },
                        overallStatus: {
                          type: "string",
                          enum: ["ONLINE", "DEGRADED"],
                        },
                        services: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              key: { type: "string" },
                              label: { type: "string" },
                              status: {
                                type: "string",
                                enum: [
                                  "ONLINE",
                                  "DEGRADED",
                                  "OFFLINE",
                                  "SIMULATED",
                                  "NOT_CONFIGURED",
                                ],
                              },
                              detail: { type: "string" },
                              latencyMs: { type: "number", nullable: true },
                            },
                          },
                        },
                        connection: {
                          type: "object",
                          properties: {
                            websocketClients: { type: "integer", minimum: 0 },
                            uptimeSeconds: { type: "integer", minimum: 0 },
                            nodeVersion: { type: "string" },
                            memoryRssMb: { type: "number", minimum: 0 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/insights": {
      get: {
        summary: "Rule-based operational risk and recommendations",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Current flight risk, evidence-backed insights and recommended actions",
          },
        },
      },
    },
    "/environment": {
      get: {
        summary: "Current environment conditions and flight risk",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Deterministic demo weather conditions combined with active-flight telemetry indicators",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        generatedAt: { type: "string", format: "date-time" },
                        source: { type: "string", enum: ["SIMULATED"] },
                        sourceLabel: { type: "string" },
                        refreshIntervalSeconds: { type: "integer", minimum: 1 },
                        station: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            latitude: { type: "number" },
                            longitude: { type: "number" },
                          },
                        },
                        conditions: {
                          type: "object",
                          properties: {
                            temperatureC: { type: "number" },
                            humidityPercent: { type: "number" },
                            windSpeedMps: { type: "number" },
                            windDirectionDeg: { type: "number" },
                            windDirection: { type: "string" },
                            rainMm: { type: "number" },
                            rainStatus: {
                              type: "string",
                              enum: ["NONE", "LIGHT", "MODERATE", "HEAVY"],
                            },
                            visibilityKm: { type: "number" },
                            visibilityStatus: {
                              type: "string",
                              enum: ["GOOD", "REDUCED", "POOR"],
                            },
                            pressureHpa: { type: "number" },
                            uvIndex: { type: "number" },
                          },
                        },
                        flightRisk: {
                          type: "object",
                          properties: {
                            score: { type: "integer", minimum: 0, maximum: 100 },
                            level: {
                              type: "string",
                              enum: ["LOW", "WATCH", "HIGH", "CRITICAL"],
                            },
                            factors: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  key: { type: "string" },
                                  severity: {
                                    type: "string",
                                    enum: ["INFO", "WARNING", "CRITICAL"],
                                  },
                                  label: { type: "string" },
                                  message: { type: "string" },
                                  score: { type: "integer", minimum: 0 },
                                },
                              },
                            },
                          },
                        },
                        fleet: {
                          type: "object",
                          properties: {
                            activeFlights: { type: "integer", minimum: 0 },
                            atRiskFlights: { type: "integer", minimum: 0 },
                            telemetryCoveragePercent: {
                              type: "integer",
                              minimum: 0,
                              maximum: 100,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/environment/export": {
      get: {
        summary: "Export an environment risk snapshot",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "CSV containing the current simulated conditions, fleet context and risk factors",
            content: { "text/csv": {} },
          },
        },
      },
    },
    "/field-intelligence": {
      get: {
        summary: "Field health and crop-stress overview",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "Deterministic demo plot analysis with health, disease, water and nutrient indicators",
          },
        },
      },
    },
    "/media": {
      get: {
        summary: "Browse simulated camera media",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "type",
            in: "query",
            schema: { type: "string", enum: ["ALL", "PHOTO", "VIDEO"], default: "ALL" },
          },
          {
            name: "sensorType",
            in: "query",
            schema: { type: "string", enum: ["ALL", "RGB", "THERMAL", "MULTISPECTRAL"], default: "ALL" },
          },
          { name: "droneId", in: "query", schema: { type: "string", format: "objectId" } },
          { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
          { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Paginated media metadata and catalog summary",
          },
        },
      },
    },
    "/media/export": {
      get: {
        summary: "Export simulated camera media metadata",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "CSV containing media metadata and file locations",
            content: { "text/csv": {} },
          },
        },
      },
    },
    "/insights/export": {
      get: {
        summary: "Export an operational insight snapshot",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description:
              "CSV containing the current fleet risk summary and evidence-backed insights",
            content: { "text/csv": {} },
          },
        },
      },
    },
    "/analytics": {
      get: {
        summary: "Time-range operational analytics",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "timezoneOffsetMinutes",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: -840,
              maximum: 840,
              default: 0,
            },
            description:
              "Operator timezone offset using Date#getTimezoneOffset() semantics for date filters and daily grouping",
          },
        ],
        responses: {
          "200": {
            description:
              "Flight trends, totals, alerts, routes and mission outcomes",
          },
          "400": { description: "Invalid date range" },
        },
      },
    },
  },
};
