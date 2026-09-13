import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: ToastTone };
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; danger?: boolean };
type FeedbackValue = { notify: (message: string, tone?: ToastTone) => void; confirm: (options: ConfirmOptions) => Promise<boolean> };

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (answer: boolean) => void }) | null>(null);
  const toastTimers = useRef<Set<number>>(new Set());
  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random(); setToasts((items) => [...items, { id, message, tone }]);
    const timer = window.setTimeout(() => { toastTimers.current.delete(timer); setToasts((items) => items.filter((item) => item.id !== id)); }, 4200);
    toastTimers.current.add(timer);
  }, []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setDialog((current) => { current?.resolve(false); return { ...options, resolve }; });
  }), []);
  const close = useCallback((answer: boolean) => {
    setDialog((current) => { current?.resolve(answer); return null; });
  }, []);
  useEffect(() => () => { toastTimers.current.forEach((timer) => window.clearTimeout(timer)); toastTimers.current.clear(); }, []);
  useEffect(() => {
    const onCriticalAlert = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) notify(`Critical alert: ${detail.message}`, "error");
    };
    window.addEventListener("drone:critical-alert", onCriticalAlert);
    return () => window.removeEventListener("drone:critical-alert", onCriticalAlert);
  }, [notify]);
  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(false); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, close]);
  return <FeedbackContext.Provider value={{ notify, confirm }}>{children}<div className="toast-stack" aria-live="polite" aria-atomic="true">{toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <CheckCircle2 /> : toast.tone === "error" ? <XCircle /> : <Info />}<span>{toast.message}</span><button className="icon-btn" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><X /></button></div>)}</div>{dialog && <div className="modal-layer"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message"><span className={dialog.danger ? "confirm-icon danger" : "confirm-icon"}><AlertTriangle /></span><h2 id="confirm-dialog-title">{dialog.title}</h2><p id="confirm-dialog-message">{dialog.message}</p><footer><button className="secondary" onClick={() => close(false)}>Cancel</button><button autoFocus className={dialog.danger ? "stop" : "primary"} onClick={() => close(true)}>{dialog.confirmLabel ?? "Confirm"}</button></footer></div></div>}</FeedbackContext.Provider>;
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("FeedbackProvider is missing");
  return value;
}
