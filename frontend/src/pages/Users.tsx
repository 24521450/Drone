import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Plus, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Empty, PageTitle, Panel, StatusBadge } from "../components";
import { api, downloadBlob, errorMessage, socket } from "../lib";
import { useFeedback } from "../feedback";
import type { User } from "../types";

const initialForm = { name: "", email: "", password: "", role: "VIEWER" };
const pageSize = 25;

export default function Users() {
  const { user: current } = useAuth();
  const { notify, confirm } = useFeedback();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pages: 0, total: 0 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string>();
  const requestRef = useRef<AbortController | null>(null);

  const load = async () => {
    if (current?.role !== "ADMIN") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/users", {
        params: { search, role, status, page, limit: pageSize },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const nextMeta = response.data.meta ?? {
        page,
        pages: response.data.data.length ? 1 : 0,
        total: response.data.data.length,
      };
      setMeta(nextMeta);
      if (page > Math.max(nextMeta.pages, 1)) {
        setUsers([]);
        setPage(Math.max(nextMeta.pages, 1));
        return;
      }
      setUsers(response.data.data);
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
    if (current?.role !== "ADMIN") return;
    const timer = window.setTimeout(() => void load(), 200);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [current?.role, search, role, status, page]);

  useEffect(() => {
    setPage(1);
  }, [search, role, status]);

  useEffect(() => {
    if (current?.role !== "ADMIN") return;
    const refresh = () => {
      void load();
    };
    socket.auth = { token: localStorage.getItem("drone-token") };
    socket.on("user:updated", refresh);
    socket.on("connect", refresh);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("user:updated", refresh);
      socket.off("connect", refresh);
    };
  }, [current?.role, search, role, status, page]);

  if (current?.role !== "ADMIN") return <Navigate to="/overview" replace />;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await api.post("/users", form);
      setOpen(false);
      setForm(initialForm);
      notify("User created", "success");
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (user: User) => {
    if (busyUserId || saving) return;
    setBusyUserId(user.id);
    try {
      if (
        !await confirm({
          title: user.isActive ? "Disable user" : "Enable user",
          message: `${user.name} will ${user.isActive ? "lose" : "regain"} access to the platform.`,
          confirmLabel: user.isActive ? "Disable" : "Enable",
          danger: user.isActive,
        })
      )
        return;
      await api.patch(`/users/${user.id}`, { isActive: !user.isActive });
      notify(`User ${user.isActive ? "disabled" : "enabled"}`, "success");
      void load();
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusyUserId(undefined);
    }
  };

  const exportAll = async () => {
    if (!meta.total || loading || exporting || saving || busyUserId) return;
    setExporting(true);
    setError("");
    try {
      const response = await api.get("/users/export", {
        params: { search, role, status },
        responseType: "blob",
      });
      downloadBlob(
        `users-${new Date().toISOString().slice(0, 10)}.csv`,
        response.data,
      );
      notify(`${meta.total} user records exported`, "success");
    } catch (reason) {
      setError(errorMessage(reason));
      notify("User export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="Users and access"
        text="Control who can view and operate the platform."
        action={
          <div className="action-row">
            <button
              className="secondary"
              disabled={!meta.total || loading || exporting || saving || !!busyUserId}
              onClick={() => void exportAll()}
            >
              <Download />
              {exporting ? "Exporting..." : "Export all matching"}
            </button>
            <button
              className="primary"
              disabled={saving || !!busyUserId}
              onClick={() => {
                setError("");
                setOpen(true);
              }}
            >
              <Plus />
              Add user
            </button>
          </div>
        }
      />
      {error && !open && <div className="form-error page-error">{error}</div>}
      <Panel>
        <div className="toolbar users-filters">
          <div className="search">
            <Search />
            <input
              aria-label="Search users"
              placeholder="Search name or email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="User role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="ALL">All roles</option>
            <option>ADMIN</option>
            <option>VIEWER</option>
          </select>
          <select
            aria-label="User status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option>ACTIVE</option>
            <option>DISABLED</option>
          </select>
          <span className="result-count">{meta.total} users</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <span>
                        <UserRound />
                      </span>
                      <b>{user.name}</b>
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className="role">
                      <ShieldCheck />
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={user.isActive ? "ACTIVE" : "DISABLED"} />
                  </td>
                  <td>
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td>
                    <button
                      className="secondary small"
                      disabled={user.id === current.id || saving || !!busyUserId}
                      onClick={() => void toggle(user)}
                    >
                      {busyUserId === user.id
                        ? "Updating..."
                        : user.isActive
                          ? "Disable"
                          : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="loading">Loading users...</div>}
          {!loading && !users.length && (
            <Empty
              title="No users found"
              text="Adjust the filters or create a viewer account for your teammate."
            />
          )}
        </div>
        <div className="pagination">
          <button
            className="secondary small"
            disabled={page <= 1 || loading || !!busyUserId}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.max(meta.pages, 1)}
          </span>
          <button
            className="secondary small"
            disabled={page >= meta.pages || loading || !!busyUserId}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
      {open && (
        <div className="modal-layer">
          <form className="modal" onSubmit={create}>
            <header>
              <div>
                <p className="eyebrow">ACCESS CONTROL</p>
                <h2>Create user</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                disabled={saving}
                aria-label="Close user form"
                onClick={() => setOpen(false)}
              >
                <X />
              </button>
            </header>
            {error && <div className="form-error">{error}</div>}
            <div className="form-grid">
              <label>
                Full name
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  minLength={2}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  required
                />
              </label>
              <label>
                Temporary password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  minLength={8}
                  required
                />
              </label>
              <label>
                Role
                <select
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                >
                  <option>VIEWER</option>
                  <option>ADMIN</option>
                </select>
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? "Creating..." : "Create user"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
