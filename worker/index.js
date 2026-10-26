/**
 * Cloudflare Worker entry point.
 *
 * Serves the static app from the ASSETS binding, handles the DeepSeek proxy,
 * and provides account/progress APIs backed by Cloudflare D1.
 *
 * Login modes:
 *   - Cloudflare Access: when this Worker is protected by an Access
 *     application, `ctx.access.getIdentity()` identifies the visitor. No
 *     password is needed and progress is keyed by the Access identity.
 *   - Built-in accounts: email/password with an HttpOnly session cookie.
 *     Used when Access is not configured and by the local Node server.
 */
import { handleChat } from "../shared/deepseek.js";
import { handleAccountRequest } from "../shared/account.js";
import { createD1Repo } from "./d1-repo.js";

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

function secureResponse(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
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

async function readAccessUser(ctx) {
  if (!ctx?.access) return null;
  try {
    const identity = await ctx.access.getIdentity();
    if (!identity?.email) return null;
    return {
      email: identity.email,
      name: identity.name || "",
      externalId: identity.user_uuid
        ? `cf-access:${identity.user_uuid}`
        : `cf-access-email:${String(identity.email).toLowerCase()}`,
    };
  } catch {
    return null;
  }
}

function databaseBinding(env) {
  return env.DB || env.crac_a_quiz || null;
}

export default {
  async fetch(request, env, ctx) {
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
      return json({
        ok: true,
        runtime: "cloudflare-worker",
        version: "1.1.0",
      });
    }

    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/progress") {
      const db = databaseBinding(env);
      if (!db) {
        return json(
          {
            error: "云端账号服务暂未开启，请稍后再试或联系站点管理员。",
          },
          503,
        );
      }
      const response = await handleAccountRequest(request, {
        repo: createD1Repo(db),
        secureCookies: url.protocol === "https:",
        clientIp: request.headers.get("CF-Connecting-IP") || "",
        accessUser: await readAccessUser(ctx),
      });
      return secureResponse(response);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API not found" }, 404);
    }

    return serveAsset(request, env, url.pathname);
  },
};
