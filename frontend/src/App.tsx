import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminOnly, Protected } from "./auth";
import { Layout } from "./components";
import { runtimeConfig } from "./config";
import Login from "./pages/Login";

const Overview = lazy(() => import("./pages/Overview"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Drones = lazy(() => import("./pages/Drones"));
const DroneDetail = lazy(() => import("./pages/DroneDetail"));
const LiveFlight = lazy(() => import("./pages/LiveFlight"));
const HistoryList = lazy(() => import("./pages/History").then((module) => ({ default: module.HistoryList })));
const HistoryDetail = lazy(() => import("./pages/History").then((module) => ({ default: module.HistoryDetail })));
const Users = lazy(() => import("./pages/Users"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Maintenance = lazy(() => import("./pages/Maintenance"));
const Environment = lazy(() => import("./pages/Environment"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const FieldIntelligence = lazy(() => import("./pages/FieldIntelligence"));
const Media = lazy(() => import("./pages/Media"));
const FlightSchedule = lazy(() => import("./pages/FlightSchedule"));
const SafetyRules = lazy(() => import("./pages/SafetyRules"));
const Missions = lazy(() => import("./pages/Missions"));
const Geofences = lazy(() => import("./pages/Geofences"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Replay = lazy(() => import("./pages/Replay"));
const Telemetry = lazy(() => import("./pages/Telemetry"));

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI render error", error, info); }
  render() {
    if (this.state.hasError) return <main className="app-error"><div><p className="eyebrow">SYSTEM RECOVERY</p><h1>This view could not be rendered</h1><p>Reload the interface to reconnect to the latest operational state.</p><button className="primary" onClick={() => window.location.reload()}>Reload interface</button></div></main>;
    return this.props.children;
  }
}

function App() {
  return <Suspense fallback={<div className="loading">Loading interfaceâ€¦</div>}><Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<Protected><Layout /></Protected>}>
      <Route path="/overview" element={<Overview />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/drones" element={<Drones />} />
      <Route path="/drones/:id" element={<DroneDetail />} />
      <Route path="/maintenance" element={<Maintenance />} />
      <Route path="/environment" element={<Environment />} />
      <Route path="/system-status" element={<SystemStatus />} />
      <Route path="/field-intelligence" element={<FieldIntelligence />} />
      <Route path="/media" element={<Media />} />
      <Route path="/live" element={<LiveFlight />} />
      <Route path="/telemetry" element={<Telemetry />} />
      <Route path="/missions" element={<Missions />} />
      <Route path="/missions/:id" element={<Missions />} />
      <Route path="/schedule" element={<FlightSchedule />} />
      <Route path="/command-center" element={<CommandCenter />} />
      <Route path="/geofences" element={<Geofences />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/safety-rules" element={<SafetyRules />} />
      <Route path="/history" element={<HistoryList />} />
      <Route path="/history/:id" element={<HistoryDetail />} />
      <Route path="/history/:id/replay" element={<Replay />} />
      <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
      <Route path="/audit-log" element={<AdminOnly><AuditLog /></AdminOnly>} />
    </Route>
    <Route path="*" element={<Navigate to="/overview" replace />} />
  </Routes></Suspense>;
}

export default function RootApp() {
  if (runtimeConfig.error) return <main className="app-error" role="alert"><div><p className="eyebrow">DEPLOYMENT CONFIGURATION</p><h1>Frontend configuration is incomplete</h1><p>{runtimeConfig.error}</p><p className="config-hint">Set the variables in the hosting provider and rebuild the static site.</p></div></main>;
  return <AppErrorBoundary><App /></AppErrorBoundary>;
}
