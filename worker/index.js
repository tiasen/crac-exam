/**
 * Cloudflare Worker entry point.
 *
 * Serves the static app from the ASSETS binding and handles the DeepSeek
 * proxy routes. The browser key is read from `x-deepseek-key` and forwarded
 * only for the current request.
 */
import { handleChat, handleHealth } from "../shared/deepseek.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function serveAsset(request, env, pathname) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  if (
    pathname === "/" ||
    pathname.endsWith(".html") ||
    pathname.startsWith("/data/")
  ) {
    headers.set("Cache-Control", "no-store");
  } else if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return handleChat(request);
    }

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }
      return handleHealth("cloudflare-worker");
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API not found" }, 404);
    }

    return serveAsset(request, env, url.pathname);
  },
};
