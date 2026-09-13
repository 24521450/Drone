# 🚁 Drone Dashboard

> **Tên định hướng:** Drone Monitoring & Intelligent Flight Platform  
> **Mục tiêu:** Xây dựng một trung tâm điều hành drone realtime, kết nối embedded/flight controller, communication layer, backend, database, dashboard, AI và lớp Field Intelligence.

---

## 0. Tầm nhìn sản phẩm

Dashboard không chỉ là website hiển thị vài thông số. Nó là **Human–Machine Interface (HMI)** của toàn bộ hệ thống drone.

Nguyên tắc cốt lõi:

> **Nhìn vào dashboard trong 5–10 giây là biết drone đang ở đâu, đang làm gì, đang hoạt động thế nào, có vấn đề gì không và nhiệm vụ đang tiến triển ra sao.**

Kiến trúc sản phẩm được định hướng theo 5 lớp:

```text
┌────────────────────────────────────────────────────────┐
│                 DRONE PLATFORM                         │
├────────────────────────────────────────────────────────┤
│  OPERATIONS  │  VEHICLE  │  MISSION  │  DATA  │  AI   │
└───────┬──────┴─────┬─────┴─────┬─────┴────┬───┴───┬───┘
        │            │           │          │       │
   Live Flight   Health       Planner    Telemetry Intelligence
   Command      Maintenance   Waypoints  History   Prediction
   Alerts       Sensors       Geofence   Replay    Recommendation
        │            │           │          │       │
        └────────────┴───────────┴──────────┴───────┘
                              │
                    🌱 FIELD INTELLIGENCE
                              │
                 Plot / Crop / Disease / Stress
```

---

# 1. Mockup tổng thể

![Complete Drone Dashboard Mockup](drone_dashboard_complete_mockup.png)

**Hình trên là mockup kiến trúc giao diện tổng thể**, gồm 21 khu vực/module chính của platform. Đây là **concept architecture**, không phải bản thiết kế pixel-final.

---

# 2. Information Architecture

Navigation đề xuất:

```text
🚁 DRONE PLATFORM
│
├── OVERVIEW
│
├── OPERATIONS
│   ├── Live Flight
│   ├── Command Center
│   ├── Missions
│   └── Alerts
│
├── FLEET
│   ├── Drones
│   ├── Drone Health
│   └── Maintenance
│
├── DATA
│   ├── Telemetry
│   ├── Flight History
│   ├── Flight Replay
│   └── Media
│
├── MAP & FIELD
│   ├── Live Map
│   ├── Geofence
│   └── Field Intelligence
│
├── INTELLIGENCE
│   ├── AI Insights
│   ├── Anomaly Detection
│   ├── Flight Risk
│   └── Predictive Maintenance
│
└── SYSTEM
    ├── Weather / Environment
    ├── Users & Roles
    ├── Audit Logs
    ├── System Status
    └── Settings
```

---

# 3. Dashboard #1 — Overview

## 3.1. Mục tiêu

Màn hình quan trọng nhất. Chỉ dùng để trả lời nhanh 5 câu hỏi:

1. Drone đang ở đâu?
2. Drone đang làm gì?
3. Drone đang hoạt động thế nào?
4. Có vấn đề gì không?
5. Nhiệm vụ/lịch sử gần đây thế nào?

## 3.2. Layout

```text
┌──────────────────────────────────────────────────────────┐
│ DRONE COMMAND CENTER                     SYSTEM ONLINE   │
├──────────────────────────────────────────────────────────┤
│ Drone-001   ONLINE   AUTO   Battery 82%   Flight 08:32 │
├─────────┬─────────┬─────────┬─────────┬────────────────┤
│Battery  │Altitude │Speed    │GPS      │Signal          │
│82%      │42.6 m   │8.4 m/s  │15 sats  │94%             │
├───────────────────────────────────┬──────────────────────┤
│                                   │                      │
│          LIVE MAP                 │   ACTIVE MISSION    │
│        Drone + Route              │   Progress 52%      │
│        + Home + Geofence          │   WP3 / WP5         │
│                                   │                      │
├──────────────────────┬────────────┴──────────────────────┤
│ TELEMETRY            │ DRONE HEALTH                     │
│ Altitude / Speed     │ Score + component status         │
│ Battery / Temp       │ Battery / GPS / IMU / Motor      │
├──────────────────────┴───────────────────────────────────┤
│ ACTIVE ALERTS / RECENT EVENTS / SYSTEM STATUS            │
└──────────────────────────────────────────────────────────┘
```

## 3.3. Thành phần chính

- Drone online/offline.
- Battery %, voltage, current.
- Altitude.
- Speed.
- GPS + satellites.
- Communication signal.
- Flight mode.
- Flight time.
- Live map.
- Flight path.
- Current mission.
- Mini telemetry charts.
- Drone Health.
- Alert summary.
- System status.

## 3.4. UX rule

**Không nhồi toàn bộ raw telemetry lên Overview.** Overview là nơi ưu tiên thông tin có khả năng ảnh hưởng đến vận hành.

---

# 4. Dashboard #2 — Live Flight

## 4.1. Mục tiêu

Theo dõi **một chuyến bay đang diễn ra theo thời gian thực**.

## 4.2. UI

```text
┌──────────────────────────────────────────────────────────┐
│ LIVE FLIGHT    DRONE-001    🟢 IN FLIGHT    AUTO        │
├───────────────────┬──────────────────────────────────────┤
│ Flight telemetry  │                                      │
│ Altitude: 120 m   │             LIVE MAP                 │
│ Speed: 8.5 m/s    │       Drone + heading + route       │
│ Distance: 1.2 km  │                                      │
│ Battery: 92%      │                                      │
├───────────────────┴──────────────────────┬───────────────┤
│ LIVE CAMERA                               │ Mission       │
│ Video stream                              │ WP 3 / 8      │
│ [REC] [PHOTO] [ZOOM]                     │ Progress 37%  │
├───────────────────────────────────────────┴───────────────┤
│ Altitude chart │ Speed chart │ Battery chart │ Alerts    │
└──────────────────────────────────────────────────────────┘
```

## 4.3. Realtime indicators

- Position.
- Heading.
- Altitude.
- Ground speed.
- Battery.
- GPS.
- Signal.
- Current waypoint.
- Flight mode.
- Last telemetry update.
- Camera status.

## 4.4. Trạng thái

```text
PREFLIGHT → TAKEOFF → IN FLIGHT → MISSION → RETURN HOME → LANDING → COMPLETED
```

---

# 5. Dashboard #3 — Command Center

## 5.1. Mục tiêu

Là trung tâm gửi lệnh điều khiển từ operator xuống drone.

## 5.2. Các command MVP

```text
[ TAKE OFF ]
[ LAND ]
[ RETURN HOME ]
[ PAUSE MISSION ]
[ RESUME ]
```

## 5.3. Luồng command

```text
Operator
   ↓
Select command
   ↓
Authorization check
   ↓
Confirmation
   ↓
Send command
   ↓
Drone ACK
   ↓
Executing
   ↓
Completed / Failed
```

## 5.4. Bắt buộc khi triển khai thật

- Authentication.
- Authorization.
- Confirmation.
- Failsafe.
- Timeout.
- Command ID.
- ACK.
- Retry policy.
- Logging.
- Emergency handling.

## 5.5. Command history

```text
18:32:01  Operator  RETURN_HOME   SENT
18:32:02  Drone-001 ACK           RECEIVED
18:32:04  Drone-001 RTH           EXECUTING
18:35:21  Drone-001 LAND          COMPLETED
```

---

# 6. Dashboard #4 — Mission Planner

## 6.1. Mục tiêu

Không chỉ **theo dõi mission** mà còn **tạo và chỉnh sửa mission**.

## 6.2. Thành phần

```text
Mission
├── Name
├── Drone
├── Date / Schedule
├── Waypoints
├── Altitude
├── Speed
├── Heading
├── Loiter time
├── Camera action
├── Survey pattern
├── Geofence
└── Return Home condition
```

## 6.3. Map planner

```text
               WP2 ●
                  │
           WP1 ●──┘
             \
              ● WP3
                \
                 ● WP4

Altitude: 50 m
Speed:    8 m/s
Pattern:  GRID

[ SAVE MISSION ] [ START MISSION ]
```

## 6.4. Mission status

```text
DRAFT
SCHEDULED
READY
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
```

---

# 7. Dashboard #5 — Alerts

## 7.1. Mục tiêu

Tập trung mọi vấn đề vận hành vào một nơi.

## 7.2. Mức độ

```text
🟢 INFO
🟡 WARNING
🔴 CRITICAL
```

## 7.3. Alert types

- Battery low.
- Battery critical.
- GPS weak.
- GPS lost.
- Communication lost.
- High temperature.
- Geofence breach.
- Abnormal telemetry.
- Mission failure.
- Drone offline.
- Motor abnormal.
- Sensor unavailable.

## 7.4. Alert lifecycle

```text
DETECTED
 ↓
CREATED
 ↓
NOTIFIED
 ↓
ACKNOWLEDGED
 ↓
RESOLVED
```

## 7.5. Alert UI

```text
🔴 CRITICAL — GPS SIGNAL LOST
Drone: DRONE-001
Time: 18:32:21
Status: ACTIVE

[Acknowledge] [View Drone] [View Map]
```

---

# 8. Dashboard #6 — Fleet / Drones

## 8.1. Mục tiêu

Quản lý nhiều drone thay vì hard-code một drone.

## 8.2. Fleet table

```text
ID        MODEL     STATUS      BATTERY   FLIGHT TIME
DRONE-001 X-Series  🟢 IN FLIGHT  92%       2h 14m
DRONE-002 X-Series  🟢 ONLINE     78%       1h 32m
DRONE-003 X-Series  🟡 WARNING    64%       0h 58m
DRONE-004 X-Series  🔴 OFFLINE    0%        12h 21m
```

## 8.3. Drone profile

```text
Drone ID
Model
Serial Number
Firmware
Hardware Revision
Flight Controller
GPS Module
Communication Module
Battery
Sensors
Total Flight Hours
Battery Cycles
Last Maintenance
Last Seen
```

## 8.4. Drone lifecycle

```text
REGISTERED → READY → ONLINE → IN FLIGHT → MAINTENANCE → RETIRED
```

---

# 9. Dashboard #7 — Drone Health

## 9.1. Mục tiêu

Biến raw telemetry thành đánh giá dễ hiểu về sức khỏe drone.

## 9.2. Health score

```text
              87
            /100

Battery          90
GPS             100
Communication    95
Temperature      85
IMU             100
Motor            74
```

## 9.3. Nguyên tắc

Health Score là **chỉ số hỗ trợ vận hành**, không phải chẩn đoán tuyệt đối.

## 9.4. UI tốt hơn

```text
87 / 100   🟢 GOOD

Main issue:
Motor #3 temperature abnormal

Recommendation:
Inspect motor #3 after landing
```

---

# 10. Dashboard #8 — Maintenance

## 10.1. Mục tiêu

Theo dõi lịch sử và tình trạng bảo trì từng thành phần.

## 10.2. Components

```text
Battery
Motors
ESC
Propellers
GPS
IMU
Camera
Flight Controller
Communication Module
```

## 10.3. Ví dụ Battery

```text
Battery #03
Health: 82%
Cycles: 124
Temperature: 38°C
Degradation: 18%
Status: 🟡 SERVICE SOON

Next check: 50 flight cycles
```

## 10.4. Ví dụ Motor

```text
Motor #1  🟢 NORMAL
Motor #2  🟢 NORMAL
Motor #3  🔴 INSPECTION REQUIRED
Motor #4  🟢 NORMAL
```

## 10.5. Maintenance history

```text
Date        Component    Action          Engineer
08/09/26    Motor #3     Inspection      User A
01/09/26    Battery #2   Replacement     User B
20/08/26    Propeller    Replacement     User A
```

---

# 11. Dashboard #9 — Telemetry

## 11.1. Mục tiêu

Trang chuyên sâu để kỹ thuật viên/analyst xem dữ liệu sensor.

## 11.2. Nhóm dữ liệu

### Battery

- Percentage.
- Voltage.
- Current.
- Temperature.

### Flight

- Altitude.
- Speed.
- Flight mode.
- Flight time.
- Distance home.

### GPS

- Latitude.
- Longitude.
- Satellites.
- Fix/status.
- HDOP nếu có.

### Communication

- Signal.
- RSSI.
- Latency.
- Packet loss.
- Last heartbeat.

### Orientation

- Roll.
- Pitch.
- Yaw.

### Hardware

- Motor telemetry.
- ESC.
- IMU.
- Temperature.

## 11.3. Chart selection

```text
[ Altitude ] [ Speed ] [ Battery ] [ Voltage ]
[ Current ]  [ Temp ]  [ Signal ]  [ Custom ]
```

## 11.4. Data quality

```text
🟢 VALID
🟡 STALE
🟠 ESTIMATED
🔴 INVALID / MISSING
```

---

# 12. Dashboard #10 — Flight History

## 12.1. Mục tiêu

Lưu và phân tích các chuyến bay đã hoàn thành.

## 12.2. Các trường

- Flight ID.
- Drone ID.
- Mission ID.
- Start time.
- End time.
- Duration.
- Distance.
- Max altitude.
- Max speed.
- Battery consumption.
- Route.
- Alerts.
- Result.

## 12.3. Analytics tổng hợp

```text
Total Flights       124
Total Flight Time   32h 18m
Average Duration    15m 38s
Average Battery     14.2% / 10m
Alerts              12
Critical Incidents  2
```

---

# 13. Dashboard #11 — Flight Replay

## 13.1. Mục tiêu

Phát lại một chuyến bay theo telemetry lịch sử.

## 13.2. Data

```text
timestamp
latitude
longitude
altitude
heading
speed
```

## 13.3. Playback engine

```text
Telemetry History
      ↓
Sort by timestamp
      ↓
Interpolate if needed
      ↓
Move drone marker
      ↓
Draw route
      ↓
Sync charts
```

## 13.4. UI

```text
[▶ PLAY] [⏸ PAUSE] [1x] [2x] [5x]

00:00 ─────────────── 12:42

MAP + DRONE MARKER + ROUTE

Altitude 120m
Speed 8.5m/s
Battery 72%
```

---

# 14. Dashboard #12 — Live Map

## 14.1. Mục tiêu

Là thành phần trực quan quan trọng nhất khi drone đang bay.

## 14.2. Map layers

```text
☑ Drones
☑ Flight Path
☑ Missions
☑ Geofence
☑ Home
☑ Fields
☑ Plots
☑ Weather
☑ Alerts
```

## 14.3. Drone marker

Marker phải:

- Realtime.
- Xoay theo heading.
- Hiển thị altitude.
- Có trạng thái online/warning/offline.
- Có popup drone information.

## 14.4. Route

```text
P1 → P2 → P3 → P4 → P5
```

Mỗi telemetry point có thể lưu:

```text
timestamp
latitude
longitude
altitude
heading
```

---

# 15. Dashboard #13 — Geofence

## 15.1. Mục tiêu

Định nghĩa vùng được phép hoạt động.

## 15.2. UI

```text
┌───────────────────────────────┐
│                               │
│            🛸                 │
│                               │
│        SAFE ZONE              │
│                               │
└───────────────────────────────┘
```

## 15.3. Thông tin

- Boundary.
- Drone position.
- Distance to boundary.
- Breach status.
- Restricted zones.
- Home/base station.

## 15.4. Breach flow

```text
Drone approaches boundary
          ↓
Warning threshold
          ↓
Critical threshold
          ↓
GEOFENCE BREACH
          ↓
Alert / Failsafe policy
```

---

# 16. Dashboard #14 — Camera / Media

## 16.1. Mục tiêu

Quản lý live video, ảnh và dữ liệu cảm biến hình ảnh.

## 16.2. Media types

```text
RGB Camera
Thermal Camera
Multispectral
Video
Photo
```

## 16.3. Media browser

```text
MEDIA
├── All
├── Images
├── Videos
├── Drone-001
├── Mission-01
└── Today
```

## 16.4. Metadata bắt buộc

Mỗi media object nên có:

```text
Media ID
Timestamp
Drone ID
Flight ID
Mission ID
Latitude
Longitude
Altitude
Sensor Type
File location
```

## 16.5. Luồng

```text
Camera
 ↓
Capture
 ↓
Metadata
 ↓
Storage
 ↓
Map location
 ↓
AI analysis
```

---

# 17. Dashboard #15 — Field Intelligence

## 17.1. Mục tiêu

Biến hệ thống từ **Drone Monitoring** thành **Drone-based Intelligent Field Monitoring System**.

## 17.2. Cấu trúc

```text
FIELD
│
├── Field Overview
├── Plots
├── Survey Missions
├── Plant Health
├── Disease
├── Water Stress
├── Nutrient Stress
├── Images
└── Inspection History
```

## 17.3. Field overview

```text
FIELD #01
Area: 3.2 ha

Plot 01 🟢 NORMAL
Plot 02 🟡 WATER STRESS
Plot 03 🔴 POSSIBLE DISEASE
Plot 04 🟢 NORMAL
```

## 17.4. Plot detail

```text
PLOT 03
Health Score: 61
Disease Risk: 78%
Water Stress: 31%
Nutrient Stress: 12%

Latest scan: 08/09/2026 14:32
```

## 17.5. Map overlay

```text
RGB / Thermal / Multispectral
          ↓
     AI segmentation
          ↓
      Plot polygon
          ↓
 Disease / Water / Nutrient layer
```

---

# 18. Dashboard #16 — AI Insights

## 18.1. Mục tiêu

AI phải trở thành **intelligence layer**, không phải một card trang trí.

## 18.2. AI categories

### Anomaly Detection

- Motor abnormality.
- Battery abnormality.
- GPS anomaly.
- Telemetry anomaly.

### Prediction

- Battery prediction.
- Flight risk.
- Maintenance prediction.

### Recommendation

- Inspect motor.
- Return home.
- Service battery.
- Review mission.

### Field AI

- Disease detection.
- Water stress.
- Nutrient stress.

## 18.3. AI insight card

```text
🧠 AI INSIGHT

Anomaly detected

Current power consumption is 34%
higher than normal.

Possible cause:
Motor / Propeller abnormality

Confidence: 87%

Recommendation:
Inspect motor #3
```

## 18.4. Nguyên tắc

AI recommendation phải luôn đi kèm:

```text
Prediction
+ Evidence
+ Confidence
+ Recommended action
```

---

# 19. Dashboard #17 — Weather / Environment

## 19.1. Mục tiêu

Đưa điều kiện môi trường vào đánh giá flight risk và field intelligence.

## 19.2. Dữ liệu

```text
Temperature
Humidity
Wind speed
Wind direction
Rain
Visibility
Pressure (optional)
UV (optional)
```

## 19.3. UI

```text
ENVIRONMENT

Temperature     31°C
Humidity         72%
Wind            4.2 m/s NE
Rain             None
Visibility       Good

Flight Risk      🟢 LOW
```

## 19.4. Kết hợp AI

```text
Weather
 +
Battery
 +
Altitude
 +
Distance
 +
Signal
 +
Historical flights
        ↓
Flight Risk Prediction
```

---

# 20. Dashboard #18 — Users & RBAC

## 20.1. Mục tiêu

Quản lý quyền truy cập hệ thống.

## 20.2. Roles

```text
Admin
Operator
Engineer
Analyst
Viewer
```

## 20.3. Example permissions

| Capability | Admin | Operator | Engineer | Analyst | Viewer |
|---|---:|---:|---:|---:|---:|
| View Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Control Drone | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| Manage Mission | ✅ | ✅ | ✅ | ❌ | ❌ |
| View Telemetry | ✅ | ✅ | ✅ | ✅ | ✅ |
| Maintenance | ✅ | ⚠️ | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ | ❌ | ❌ |
| System Settings | ✅ | ❌ | ✅ | ❌ | ❌ |
```

## 20.4. Security baseline

- Authentication.
- Authorization.
- Session management.
- Token expiration.
- Role-based permissions.
- Command authorization.
- Audit trail.

---

# 21. Dashboard #19 — Audit Logs

## 21.1. Mục tiêu

Theo dõi mọi hành động quan trọng trong hệ thống.

## 21.2. Ví dụ

```text
TIME      USER       ACTION             RESOURCE
18:32:01  Operator   RETURN_HOME        DRONE-001
18:32:04  System     COMMAND_ACK        DRONE-001
18:35:21  Operator   MISSION_COMPLETE   FLIGHT-1024
18:41:10  Admin      USER_ROLE_CHANGED  USER-003
```

## 21.3. Nên log

- Login/logout.
- Command.
- Mission modification.
- Geofence modification.
- Drone registration.
- Firmware/config changes.
- Maintenance actions.
- User permission changes.
- Alert acknowledgement.

---

# 22. Dashboard #20 — System Status

## 22.1. Mục tiêu

Theo dõi chính dashboard/platform backend.

## 22.2. Services

```text
Frontend          🟢 ONLINE
Backend           🟢 ONLINE
Database          🟢 ONLINE
WebSocket         🟢 ONLINE
Drone Link        🟢 ONLINE
AI Service        🟢 ONLINE
Storage           🟢 ONLINE
MQTT              🟢 ONLINE
```

## 22.3. Connection metrics

```text
Connection Type: 4G
RSSI: -67 dBm
Latency: 42 ms
Packet Loss: 0.4%
Heartbeat: 1.2 sec
Reconnect Count: 2
Uptime: 99.8%
```

## 22.4. Realtime system alert

```text
🔴 WebSocket degraded
Latency > 500 ms
Affected drones: 2
```

---

# 23. Dashboard #21 — Analytics

## 23.1. Mục tiêu

Từ dữ liệu lịch sử tạo thành insight vận hành.

## 23.2. KPI

```text
Total Flights
Total Flight Hours
Average Flight Duration
Battery Consumption
Average Speed
Average Altitude
Alert Count
Critical Incidents
Mission Success Rate
Drone Utilization
```

## 23.3. Fleet analytics

```text
Drone utilization
Battery degradation
Maintenance frequency
Alert frequency
Mission success rate
Average distance
Average energy use
```

## 23.4. Chart examples

- Flights over time.
- Flight duration distribution.
- Battery consumption trend.
- Mission success rate.
- Alert trend.
- Maintenance trend.

---

# 24. Dashboard relationship

21 module không hoạt động độc lập mà liên kết với nhau:

```text
                    OVERVIEW
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   LIVE FLIGHT      ALERTS        DRONE HEALTH
        │              │              │
        ▼              ▼              ▼
   LIVE MAP       COMMAND        MAINTENANCE
        │              │              │
        ▼              ▼              ▼
     MISSION       COMMAND LOG       HISTORY
        │                             │
        └──────────────┬──────────────┘
                       ▼
                  ANALYTICS
                       │
                       ▼
                       AI
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       Drone Intelligence  Field Intelligence
```

---

# 25. Data flow toàn hệ thống

```text
┌──────────────┐
│   DRONE      │
│ Sensors/FC   │
└──────┬───────┘
       │
       │ Telemetry
       ▼
┌──────────────────┐
│ COMMUNICATION    │
│ Wi-Fi / 4G /     │
│ LoRa / 5G        │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ INGESTION LAYER  │
│ Validation       │
│ Deduplication    │
│ Data quality     │
└──────┬───────────┘
       │
       ├───────────────┐
       ▼               ▼
   REALTIME         DATABASE
   PROCESSING           │
       │                │
       ├── Alerts       ├── Telemetry
       ├── Events       ├── Flights
       └── Health       ├── Missions
                        └── Maintenance
       │
       ├───────────────┐
       ▼               ▼
  WEBSOCKET          AI/ML
       │               │
       ▼               ▼
   FRONTEND       Insights / Risk
       │               │
       └───────┬───────┘
               ▼
          DASHBOARD
```

---

# 26. Telemetry data contract

Ví dụ contract nền tảng:

```json
{
  "drone_id": "DRONE-001",
  "flight_id": "FLIGHT-1024",
  "mission_id": "MISSION-003",
  "timestamp": "2026-09-08T21:30:20Z",
  "sequence": 10242,

  "battery": {
    "percentage": 82,
    "voltage": 16.4,
    "current": 8.2,
    "temperature": 41
  },

  "position": {
    "latitude": 10.762622,
    "longitude": 106.660172,
    "altitude": 42.6
  },

  "velocity": {
    "speed": 8.4
  },

  "gps": {
    "satellites": 15,
    "fix": "3D",
    "hdop": 0.9
  },

  "connection": {
    "type": "4G",
    "rssi": -67,
    "latency_ms": 42,
    "packet_loss": 0.4
  },

  "orientation": {
    "roll": 2.3,
    "pitch": -1.4,
    "yaw": 132
  },

  "flight_mode": "AUTO",
  "distance_home": 184,
  "flight_time": 512
}
```

### Ý nghĩa của `sequence`

Dùng để phát hiện:

- Packet bị mất.
- Packet đến sai thứ tự.
- Duplicate packet.
- Realtime stream bị gián đoạn.

---

# 27. Event architecture

Telemetry không nên chỉ đi thẳng vào UI. Nên có Event Processor.

```text
Telemetry
   ↓
Event Processor
   ↓
┌─────────────────────────────┐
│ BATTERY_LOW                 │
│ GPS_LOST                    │
│ SIGNAL_LOW                  │
│ TEMP_HIGH                   │
│ GEOFENCE_BREACH             │
│ MISSION_COMPLETED           │
│ MOTOR_ANOMALY               │
│ DRONE_OFFLINE               │
└─────────────────────────────┘
```

Ví dụ:

```text
Battery 28%
    ↓
BATTERY_LOW
    ↓
Alert Engine
    ↓
Dashboard Alert
    ↓
Notification
    ↓
Potential RTH policy
```

---

# 28. Command architecture

Command và telemetry phải được thiết kế thành **hai chiều khác nhau**.

```text
                   TELEMETRY
Drone ─────────────────────────→ Backend

                   COMMAND
Drone ←───────────────────────── Backend
```

Command lifecycle:

```text
REQUESTED
   ↓
AUTHORIZED
   ↓
SENT
   ↓
ACKNOWLEDGED
   ↓
EXECUTING
   ↓
COMPLETED / FAILED / TIMEOUT
```

---

# 29. Database concept

Database có thể được tổ chức theo các nhóm:

```text
USERS
├── users
├── roles
└── permissions

FLEET
├── drones
├── drone_hardware
├── batteries
├── motors
└── sensors

OPERATIONS
├── missions
├── waypoints
├── flights
├── telemetry
├── commands
└── alerts

MAP
├── geofences
├── fields
└── plots

MEDIA
├── images
├── videos
└── media_metadata

MAINTENANCE
├── maintenance_records
└── maintenance_items

AI
├── predictions
├── anomalies
└── recommendations

SYSTEM
├── audit_logs
└── system_events
```

---

# 30. Realtime architecture

Luồng realtime đề xuất:

```text
Drone
  ↓
Telemetry packet
  ↓
Backend validation
  ↓
Store telemetry
  ↓
Publish event
  ↓
WebSocket
  ↓
React state
  ↓
Selective component update
```

Không nên reload toàn dashboard mỗi khi có packet mới. Chỉ update component liên quan:

```text
Battery packet → Battery card
GPS packet     → Map
Speed packet   → Speed chart
Alert event    → Alert center
Mission event  → Mission panel
```

---

# 31. UX principles

## 31.1. Information hierarchy

```text
CRITICAL
   ↓
ACTIONABLE
   ↓
IMPORTANT
   ↓
DETAIL
```

## 31.2. Status colors

```text
🟢 NORMAL / ONLINE
🟡 WARNING
🔴 CRITICAL / OFFLINE
🔵 INFORMATION
```

Màu phải được sử dụng nhất quán, không dùng màu tùy tiện.

## 31.3. Overview vs detail

```text
Overview
   ↓
Important information

Telemetry
   ↓
Detailed information

Alerts
   ↓
Problems

History
   ↓
Analysis

AI
   ↓
Prediction / Recommendation
```

---

# 32. Dashboard responsive layout

## Desktop

Khuyến nghị màn hình điều hành chính:

```text
1440px+

Sidebar 240–260px
Main content: flexible
Grid: 12 columns
```

## Tablet

```text
768–1439px

Collapsible sidebar
2-column cards
```

## Mobile

Không nên cố sao chép toàn bộ desktop dashboard. Chỉ giữ:

```text
Status
Battery
Critical Alerts
Map
Mission
```

Mobile nên ưu tiên **monitoring + alerts**, không phải thao tác điều khiển phức tạp.

---

# 33. Design system đề xuất

## Visual direction

- Dark command-center UI.
- High information density nhưng không rối.
- Card rõ ràng.
- Border/spacing nhất quán.
- Status indicator nổi bật.
- Map là visual anchor.
- Typography ưu tiên readability.

## Components dùng chung

```text
StatusBadge
MetricCard
AlertCard
DroneCard
MapPanel
ChartCard
HealthGauge
Timeline
DataTable
Modal
CommandButton
MissionProgress
SensorStatus
```

---

# 34. KPI quan trọng nhất trên Overview

Không nên có hàng chục KPI. Ưu tiên:

```text
1. Drone Status
2. Battery
3. Altitude
4. Speed
5. GPS
6. Signal
7. Current Mission
8. Critical Alerts
9. Health Score
10. System Status
```

---

# 35. Phase implementation

## 🔴 Phase 1 — Core Drone Monitoring

```text
Overview
Live Flight
Telemetry
Live Map
Flight Path
Battery
GPS
Altitude
Speed
Signal
Flight Mode
Flight Time
Basic Alerts
```

Mục tiêu: có telemetry realtime + UI realtime + map.

## 🟡 Phase 2 — Drone Operations Platform

```text
Command Center
Mission Planner
Flight History
Flight Replay
Geofence
Drone Health
Fleet Management
Maintenance
Camera / Media
Weather
```

Mục tiêu: từ monitoring thành operations platform.

## 🟢 Phase 3 — Intelligent Drone

```text
Health Score
Anomaly Detection
Battery Prediction
Predictive Maintenance
Flight Risk
AI Recommendation
Fleet Analytics
```

Mục tiêu: từ dashboard thành intelligent system.

## 🔵 Phase 4 — Agriculture / Field Intelligence

```text
Field
Plot
Plant Health
Disease Detection
Water Stress
Nutrient Stress
Image Analysis
Map Overlay
Historical Comparison
Field Recommendation
```

Mục tiêu: tạo **USP** và chuyển thành drone-based intelligent field monitoring.

---

# 36. Demo flow hoàn chỉnh

```text
START SYSTEM
    ↓
System status becomes ONLINE
    ↓
Drone connects
    ↓
Telemetry starts streaming
    ↓
Overview updates
    ↓
Drone appears on Live Map
    ↓
Takeoff
    ↓
Altitude / Speed / Battery update
    ↓
Mission starts
    ↓
Waypoint progress changes
    ↓
Flight path is drawn
    ↓
Camera captures image
    ↓
Image appears in Media
    ↓
Drone enters warning condition
    ↓
Alert appears
    ↓
Health Score changes
    ↓
AI identifies anomaly
    ↓
Recommendation shown
    ↓
Operator triggers Return Home
    ↓
Command ACK
    ↓
Drone returns
    ↓
Landing
    ↓
Flight saved to History
    ↓
Replay available
    ↓
Analytics updated
```

---

# 37. Architecture cuối cùng

```text
                              DRONE
                                │
                         ┌──────┴──────┐
                         │             │
                    TELEMETRY       COMMAND
                         │             ▲
                         ▼             │
                 COMMUNICATION LAYER   │
                         │             │
                         ▼             │
                  INGESTION / EVENT    │
                         │             │
              ┌──────────┼──────────┐  │
              │          │          │  │
              ▼          ▼          ▼  │
          DATABASE    REALTIME      AI  │
              │          │          │  │
              │          ▼          ▼  │
              │       WebSocket  Insight│
              │          │          │  │
              └──────────┼──────────┘  │
                         ▼             │
                    FRONTEND           │
                         │             │
        ┌────────────────┼─────────────────────────┐
        │                │                         │
        ▼                ▼                         ▼
    OPERATIONS        FLEET / DATA            FIELD / AI
        │                │                         │
 Live Flight        Telemetry                  Field
 Command            History                    Plot
 Missions            Replay                    Disease
 Alerts              Media                     Stress
 Map                 Analytics                 Recommendation
        │                │                         │
        └────────────────┴─────────────────────────┘
                         │
                         ▼
                HUMAN–MACHINE INTERFACE
```

---

# 38. Product definition

## Product name

**Drone Monitoring & Intelligent Flight Platform**

## Core value proposition

> A real-time platform that collects drone telemetry, visualizes flight information, manages missions and commands, monitors drone health, detects operational problems, stores flight history, manages media and gradually adds intelligent analysis for safety, predictive maintenance and field intelligence.

## Product evolution

```text
PHASE 1
Drone Monitoring
      ↓
PHASE 2
Drone Operations
      ↓
PHASE 3
Drone Intelligence
      ↓
PHASE 4
Field Intelligence
```

## Final vision

```text
                 FROM DATA
                    ↓
                  DRONE
                    ↓
                TELEMETRY
                    ↓
                PLATFORM
                    ↓
               INTELLIGENCE
                    ↓
                  FIELD
                    ↓
              ACTION / DECISION
```

---

# 39. MVP checklist

```text
[ ] React + TypeScript setup
[ ] Sidebar / routing
[ ] Overview
[ ] Live Flight
[ ] Telemetry cards
[ ] Live Map
[ ] Mock telemetry generator
[ ] REST API
[ ] WebSocket
[ ] Battery / GPS / altitude / speed
[ ] Basic alerts
[ ] Flight state machine
[ ] Telemetry database
[ ] Flight history
[ ] Real drone integration
```

---

# 40. Những phần không nên làm sớm

Trong MVP chưa cần:

```text
[ ] Complex AI
[ ] Predictive maintenance model
[ ] Full multi-drone autonomy
[ ] Complex mission marketplace
[ ] Advanced remote control
[ ] Large-scale fleet orchestration
```

Nên ưu tiên kiến trúc mở rộng được trước, sau đó tăng dần tính năng.

---

# 41. Tóm tắt 21 Dashboard / Module

| # | Module | Mục tiêu chính | Priority |
|---|---|---|---|
| 1 | Overview | Toàn cảnh hệ thống | 🔴 |
| 2 | Live Flight | Theo dõi chuyến bay realtime | 🔴 |
| 3 | Command Center | Gửi lệnh điều khiển | 🟡 |
| 4 | Mission Planner | Tạo/chỉnh mission | 🟡 |
| 5 | Alerts | Cảnh báo và sự kiện | 🔴 |
| 6 | Fleet / Drones | Quản lý drone | 🟡 |
| 7 | Drone Health | Đánh giá sức khỏe | 🟡 |
| 8 | Maintenance | Bảo trì thiết bị | 🟡 |
| 9 | Telemetry | Dữ liệu sensor chi tiết | 🔴 |
| 10 | Flight History | Lịch sử bay | 🟡 |
| 11 | Flight Replay | Phát lại chuyến bay | 🟡 |
| 12 | Live Map | Bản đồ realtime | 🔴 |
| 13 | Geofence | Vùng hoạt động | 🟡 |
| 14 | Camera / Media | Ảnh/video/payload | 🟡 |
| 15 | Field Intelligence | Giám sát khu vực/cây trồng | 🔵 |
| 16 | AI Insights | Anomaly/prediction/recommendation | 🔵 |
| 17 | Weather | Điều kiện môi trường | 🟡 |
| 18 | Users & RBAC | Người dùng và quyền | 🟡 |
| 19 | Audit Logs | Theo dõi hành động | 🟡 |
| 20 | System Status | Theo dõi platform | 🟡 |
| 21 | Analytics | KPI và phân tích lịch sử | 🔵 |

---

# 42. Kết luận thiết kế

Dashboard hoàn chỉnh nên được xem như **hệ thống điều hành drone**, không phải một trang web telemetry.

Các lớp chức năng quan trọng nhất là:

```text
                    ┌───────────────┐
                    │   OVERVIEW    │
                    └───────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   OPERATIONS            VEHICLE             MISSION
        │                   │                   │
   Live / Command        Health /             Planner /
   Alerts / Map          Maintenance          Waypoints
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                           DATA
                            │
                 Telemetry / History / Media
                            │
                            ▼
                           AI
                            │
                  Prediction / Anomaly
                            │
                            ▼
                    FIELD INTELLIGENCE
                            │
                  Disease / Water / Crop
                            │
                            ▼
                    ACTION / DECISION
```

> **Dashboard là HMI của toàn bộ hệ thống embedded + communication + backend + database + AI + field intelligence.**

---

