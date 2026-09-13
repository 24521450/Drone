import { useState, type FormEvent } from "react";
import { Activity, ArrowRight, LockKeyhole, Mail, Plane } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api, errorMessage } from "../lib";

export default function Login() {
  const { user, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@drone.local");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  if (user) return <Navigate to="/overview" replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const response = await api.post("/auth/login", { email, password });
      setSession(response.data.data.user, response.data.data.token);
      navigate((location.state as any)?.from ?? "/overview", { replace: true });
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  };
  return <div className="login-page"><div className="login-visual"><div className="login-grid" /><div className="orb one" /><div className="orb two" /><div className="visual-copy"><div className="brand"><span className="brand-mark"><Plane /></span><div><b>DRONE</b><small>MONITORING</small></div></div><div><span className="kicker"><Activity size={14} /> Real-time operations platform</span><h1>Eyes on every flight.</h1><p>Monitor your fleet, understand every signal, and keep operations moving from one focused command center.</p></div><div className="system-strip"><span className="live-dot" /> System ready <b>99.9%</b></div></div></div>
    <main className="login-form-wrap"><form className="login-form" onSubmit={submit}><div className="mobile-brand"><Plane /> DRONE MONITOR</div><p className="eyebrow">SECURE ACCESS</p><h2>Welcome back</h2><span>Sign in to access the flight command center.</span>
      {error && <div className="form-error">{error}</div>}
      <label>Email address<div className="input-icon"><Mail /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></label>
      <label>Password<div className="input-icon"><LockKeyhole /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></div></label>
      <button className="primary full" disabled={loading}>{loading ? "Signing in..." : <>Sign in <ArrowRight size={17} /></>}</button>
      <small className="demo-note">Demo admin credentials are prefilled for local development.</small>
    </form></main></div>;
}
