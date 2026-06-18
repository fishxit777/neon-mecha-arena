export function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || "3000", 10);
  const isProduction = env.NODE_ENV === "production";
  const localOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://0.0.0.0:${port}`
  ];
  const configuredOrigins = (env.PUBLIC_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port,
    adminToken: env.ADMIN_TOKEN || (isProduction ? "" : "change-me-to-a-32-character-random-token"),
    publicOrigins: [...new Set([...configuredOrigins, ...localOrigins])],
    sessionSecret: env.SESSION_SECRET || "local-session-secret",
    isProduction
  };
}

export function isOriginAllowed(origin, config) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (!config.isProduction && isDevelopmentHost(url.hostname)) {
      return true;
    }
    if (!config.isProduction && isQuickTunnelHost(url.hostname)) {
      return true;
    }
  } catch {
    return false;
  }
  return config.publicOrigins.includes(origin);
}

export function isOriginAllowedForHost(origin, requestHost, config) {
  if (isOriginAllowed(origin, config)) return true;
  if (!origin || !requestHost) return false;

  try {
    const originUrl = new URL(origin);
    const normalizedRequestHost = normalizeHost(requestHost);
    return normalizedRequestHost.length > 0 && originUrl.host.toLowerCase() === normalizedRequestHost;
  } catch {
    return false;
  }
}

export function requireAdminToken(inputToken, config) {
  return typeof inputToken === "string" && inputToken.length > 0 && inputToken === config.adminToken;
}

export function isDevelopmentHost(hostname) {
  return isLoopbackHost(hostname) || isPrivateLanHost(hostname);
}

export function isQuickTunnelHost(hostname) {
  return String(hostname || "").toLowerCase().endsWith(".trycloudflare.com");
}

export function isLoopbackHost(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(String(hostname || "").toLowerCase());
}

export function isPrivateLanHost(hostname) {
  const parts = String(hostname || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function normalizeHost(host) {
  return String(host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
}
