# Drone Monitoring Platform

Ứng dụng web điều hành và giám sát drone realtime dành cho project môn học. Phiên bản hiện tại hỗ trợ đội demo 10 drone, chế độ bay đơn/fleet, chín lộ trình chuyên biệt và giao diện dark minimal.

> **Phạm vi demo:** camera/media, thời tiết, AI/ML, drone link và MQTT đều là adapter mô phỏng hoặc chưa cấu hình. Không dùng dữ liệu demo để điều khiển thiết bị thật.

## Công nghệ

- Frontend: React, TypeScript, Vite, Tailwind CSS, React Leaflet, Recharts.
- Backend: Node.js, Express, TypeScript, Mongoose, Socket.IO.
- Database: MongoDB.
- API docs: OpenAPI/Swagger.

## Tính năng hiện có

- Dashboard, quản lý drone, phân quyền `ADMIN` / `VIEWER`.
- Mô phỏng realtime một drone hoặc đội 10 drone qua Socket.IO.
- Fleet view hiển thị độ phủ telemetry theo từng drone (`LIVE`, `WAITING`, `STALE`) và tự đánh dấu packet quá 5 giây.
- Chín lộ trình demo: `RANDOM`, `STAR`, `SQUARE`, `CIRCLE`, `GRID`, `TRIANGLE`, `SPIRAL`, `FIGURE_EIGHT`, `ZIGZAG`.
- Mission Planner: tạo waypoint trên bản đồ, kéo điểm, đổi thứ tự và chạy mission thật.
- Mission telemetry ghi nhận waypoint hiện tại và tiến độ tuyến (`WP x/n`, phần trăm) trong Live Flight, Telemetry, Replay và CSV export.
- Command Center: `PAUSE`, `RESUME`, `RETURN_HOME`, `LAND`, retry command thất bại và audit log.
- Flight History: route, telemetry, alerts và command timeline cho từng chuyến bay.
- Operational insights: đánh giá risk rule-based từ alert, battery, signal, GPS, telemetry stale và maintenance, kèm evidence/confidence/recommendation và CSV snapshot.
- Environment: điều kiện nhiệt độ, độ ẩm, gió, mưa, tầm nhìn, UV/áp suất mô phỏng deterministic, kết hợp telemetry để tính flight risk và export CSV.
- Field Intelligence: tổng hợp plot từ geofence hoặc 4 plot demo, hiển thị health score, disease/water/nutrient stress và thời điểm scan.
- Media library: catalog ảnh/video mô phỏng theo RGB, thermal và multispectral, liên kết flight/GPS/altitude và export metadata CSV.
- System Status: kiểm tra runtime backend, database, WebSocket, uptime/memory và phân biệt rõ các adapter mô phỏng hoặc chưa cấu hình.
- Geofence hình tròn hoặc polygon; vi phạm tự tạo cảnh báo critical và return-to-home.
- Flight Replay có play/pause, scrub timeline và tốc độ `1x`, `2x`, `5x`.
- Alert Center có bộ lọc, phân trang và luồng acknowledge.

## Cấu trúc repository

```text
.
├── backend/src/
│   ├── routes.ts, models.ts, auth.ts       # REST API, models, JWT/RBAC
│   ├── simulator.ts, route-engine.ts       # flight/telemetry simulator
│   ├── services/                            # insights, environment, field, media, system
│   │   ├── *-service.ts                     # domain adapters, scoring, runtime checks
│   │   └── *.test.ts                         # service tests
│   └── *.test.ts                            # unit/integration tests
├── frontend/src/
│   ├── pages/                               # màn hình theo module
│   ├── components.tsx, styles.css            # shell và dark design system
│   └── lib.ts, realtime.ts, auth.tsx         # API, socket, auth
├── e2e/                                      # Playwright navigation/fleet/responsive
├── scripts/                                  # smoke + workspace cleanup
├── render.yaml                               # Render API + static site
└── playwright.config.ts / package.json
```

Artifact build/cache (`dist`, `test-results`, `coverage`, `*.tsbuildinfo`) đã được ignore; dùng `npm run clean` để dọn.

## Chạy local

Yêu cầu Node.js 20+ và npm, cùng MongoDB local hoặc MongoDB Atlas.

```bash
npm install

# macOS/Linux
cp backend/.env.example backend/.env

# PowerShell
Copy-Item backend/.env.example backend/.env
```

Các biến backend trong `backend/.env`:

| Biến | Ý nghĩa |
| --- | --- |
| `NODE_ENV` | `development` hoặc `production` |
| `PORT` | Cổng API, mặc định `4000` |
| `MONGODB_URI` | URI MongoDB local/Atlas |
| `JWT_SECRET` | Secret ký JWT; production tối thiểu 32 ký tự |
| `CLIENT_ORIGIN` | Frontend origin, nhiều origin ngăn cách bằng dấu phẩy |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Tài khoản admin tạo lúc server khởi động |

Frontend mặc định trỏ tới API local. Khi đổi host, tạo `frontend/.env` từ `.env.example`:

```text
VITE_API_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

Khởi động với MongoDB hoặc database tạm:

```bash
npm run dev          # frontend + backend, MongoDB local/Atlas
npm run dev:memory   # MongoMemoryServer; dữ liệu mất khi tắt
```

- Website: `http://localhost:5173`
- API base URL: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api-docs`
- OpenAPI JSON: `http://localhost:4000/api-docs.json`
- Health check: `http://localhost:4000/health`
- Readiness probe: `http://localhost:4000/ready`

Tài khoản development mặc định trong `.env.example`:

```text
Email: admin@drone.local
Password: Admin123!
```

Hãy thay cả email và password qua biến môi trường khi deploy; không commit `.env` hoặc connection string.

## Demo flow

1. Đăng nhập bằng tài khoản admin.
2. Vào Drones và tạo một drone.
3. Vào Live Flight → Fleet View và chọn `Prepare demo fleet` nếu chưa có đủ 10 drone.
4. Kiểm tra hoặc đổi route `RANDOM`, `STAR`, `SQUARE`, `CIRCLE`, `GRID`, `TRIANGLE`, `SPIRAL`, `FIGURE_EIGHT`, `ZIGZAG` cho từng drone.
5. Chọn `Start 10 drones` và quan sát bản đồ fleet cập nhật mỗi giây.
6. Hệ thống gán ngẫu nhiên một cảnh báo pin yếu và một cảnh báo GPS yếu.
7. Mở Media để lọc theo drone/sensor, xem metadata modal và export CSV.
8. Mở Environment, Field Intelligence, Analytics và System Status để kiểm tra các lớp intelligence/runtime.
9. Dừng fleet và mở Flight History → Replay để xem route, telemetry và cảnh báo đã lưu.

## API chính

```text
POST   /api/v1/auth/login
GET    /api/v1/auth/me
GET    /api/v1/users
GET    /api/v1/users/export
POST   /api/v1/users
PATCH  /api/v1/users/:id
GET    /api/v1/drones
GET    /api/v1/drones/export
POST   /api/v1/drones
POST   /api/v1/drones/seed-demo
GET    /api/v1/drones/:id
PATCH  /api/v1/drones/:id
DELETE /api/v1/drones/:id
POST   /api/v1/flights/simulate
POST   /api/v1/flights/simulate-fleet
POST   /api/v1/flights/stop-fleet
POST   /api/v1/flights/:id/stop
POST   /api/v1/commands
POST   /api/v1/commands/fleet
POST   /api/v1/commands/:id/retry
GET    /api/v1/commands
GET    /api/v1/commands/export
GET    /api/v1/flights
GET    /api/v1/flights/active/telemetry
GET    /api/v1/flights/export
GET    /api/v1/flights/:id
GET    /api/v1/flights/:id/telemetry
GET    /api/v1/flights/:id/replay
GET    /api/v1/flights/:id/telemetry/export
GET    /api/v1/mission-templates
POST   /api/v1/mission-templates/generate
GET    /api/v1/mission-schedule
GET    /api/v1/geofences
GET    /api/v1/geofences/export
GET    /api/v1/alerts
GET    /api/v1/alerts/export
PATCH  /api/v1/alerts/:id/acknowledge
GET    /api/v1/maintenance/health
GET    /api/v1/maintenance
POST   /api/v1/maintenance              # ADMIN
PATCH  /api/v1/maintenance/:id           # ADMIN
GET    /api/v1/dashboard/summary
GET    /api/v1/environment
GET    /api/v1/environment/export
GET    /api/v1/field-intelligence
GET    /api/v1/media
GET    /api/v1/media/export
GET    /api/v1/system/status
GET    /api/v1/drones/readiness
GET    /api/v1/audit-events                 # ADMIN
GET    /api/v1/insights
GET    /api/v1/insights/export
GET    /api/v1/maintenance/export
```

Mọi endpoint dưới `/api/v1`, trừ login, yêu cầu header `Authorization: Bearer <token>`.
Hai endpoint `/health` và `/ready` là public để dùng cho monitoring/deployment.

## Build và test

```bash
npm run build       # typecheck + production build
npm test            # backend + frontend
npm run test:e2e    # Playwright với MongoMemoryServer riêng
npm run smoke       # health, readiness và OpenAPI
npm run clean       # xóa artifact build/cache do project tạo
```

E2E dùng `reuseExistingServer: true`. Khi API Atlas đang chạy ở port 4000, hãy dừng API trước khi chạy E2E để test không ghi dữ liệu demo vào database thật; sau đó khởi động lại `npm run dev -w backend`.

## Deploy

- Tạo MongoDB Atlas và allowlist IP của backend.
- Deploy backend bằng `render.yaml`; đặt `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- Deploy thư mục `frontend` lên Vercel/static host; đặt `VITE_API_URL` tới URL public `/api/v1` và `VITE_SOCKET_URL` tới origin API.
- Kiểm tra `/health`, `/ready` và `/api-docs.json` sau deploy.

Production config từ chối secret yếu, origin localhost và MongoDB localhost. Không commit password, JWT secret, `.env` hoặc connection string lên GitHub.

## Giới hạn hiện tại

- Media chưa upload file thật; `fileLocation` chỉ là placeholder metadata.
- Environment/Field Intelligence/Insights là deterministic hoặc rule-based adapter, chưa phải dự báo thời tiết/ML production.
- Drone link và MQTT chưa nối flight controller/broker thật.
- Khi thay adapter, giữ nguyên contract REST, source label và evidence/confidence để UI vẫn minh bạch.
