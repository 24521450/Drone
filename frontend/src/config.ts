type FrontendEnv = {
  PROD?: boolean;
  VITE_API_URL?: string;
  VITE_SOCKET_URL?: string;
};

const isHttpUrl = (value?: string) => {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.host);
  } catch {
    return false;
  }
};

const isApiUrl = (value?: string) => {
  if (!isHttpUrl(value)) return false;
  try {
    const url = new URL(value!.trim());
    return /^\/api\/v1\/?$/.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
};

export function validateRuntimeConfig(env: FrontendEnv) {
  const apiUrl = env.VITE_API_URL?.trim() || "http://localhost:4000/api/v1";
  const socketUrl = env.VITE_SOCKET_URL?.trim() || "http://localhost:4000";
  if (!env.PROD) return { apiUrl, socketUrl, error: "" };
  const missing = [
    !isApiUrl(env.VITE_API_URL) ? "VITE_API_URL" : "",
    !isHttpUrl(env.VITE_SOCKET_URL) ? "VITE_SOCKET_URL" : "",
  ].filter(Boolean);
  const apiHint =
    env.VITE_API_URL && !isApiUrl(env.VITE_API_URL)
      ? " VITE_API_URL must end with /api/v1."
      : "";
  return {
    apiUrl,
    socketUrl,
    error: missing.length
      ? `Production frontend configuration is incomplete. Set ${missing.join(" and ")} before deploying.${apiHint}`
      : "",
  };
}

export const runtimeConfig = validateRuntimeConfig(import.meta.env);
