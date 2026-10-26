/**
 * Account and per-user progress API shared by Cloudflare Workers, Cloudflare
 * Pages Functions and the local Node server.
 *
 * Authentication comes from one of two places:
 *   1. Cloudflare Access (`ctx.access.getIdentity()`), when the Worker is
 *      protected by an Access application.
 *   2. A signed-in session cookie created by the built-in email/password
 *      account flow below.
 *
 * The repo object is supplied by each runtime and must implement the methods
 * used in `resolveUser`, `handleRegister`, `handleLogin` and the progress
 * handlers. See worker/d1-repo.js and server/account-repo.js.
 */

import {
  hashPassword,
  normalizeEmail,
  randomId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from "./crypto.js";

export const SESSION_COOKIE = "crac_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_PROGRESS_BYTES = 1_800_000;
const MAX_RECORDS = 120;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 20;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeKey(key) {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function cookieHeader(token, { secure = true, maxAge = SESSION_TTL_MS / 1000 } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAge)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, "请求内容过大");
  }
  let text;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, "无法读取请求内容");
  }
  if (byteLength(text) > maxBytes) {
    throw new HttpError(413, "请求内容过大");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) throw new HttpError(400, "邮箱格式不正确");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new HttpError(400, "邮箱格式不正确");
  }
  return email;
}

function validatePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8) throw new HttpError(400, "密码至少需要 8 位");
  if (password.length > 128) throw new HttpError(400, "密码不能超过 128 位");
  return password;
}

function sanitizeName(value, email = "") {
  const fallback = email ? email.split("@")[0] : "学习者";
  const name = String(value ?? "").trim().slice(0, 32);
  return name || fallback.slice(0, 32);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

function sanitizeProgress(input) {
  if (!isObject(input)) throw new HttpError(400, "进度数据格式不正确");

  const wrong = {};
  if (isObject(input.wrong)) {
    for (const [id, entry] of Object.entries(input.wrong).slice(0, 2000)) {
      if (!id || id.length > 160 || !isSafeKey(id) || !isObject(entry)) continue;
      wrong[id] = entry;
    }
  }

  const records = (Array.isArray(input.records) ? input.records : [])
    .filter((record) => isObject(record) && typeof record.id === "string" && record.id.length <= 160)
    .slice(0, MAX_RECORDS);

  const analysis = {};
  if (isObject(input.analysis)) {
    for (const [id, entry] of Object.entries(input.analysis).slice(0, 120)) {
      if (!id || id.length > 160 || !isSafeKey(id) || !isObject(entry)) continue;
      if (typeof entry.text !== "string" || entry.text.length > 20_000) continue;
      analysis[id] = entry;
    }
  }

  const mnemonicOverrides = {};
  if (isObject(input.mnemonicOverrides)) {
    for (const [id, value] of Object.entries(input.mnemonicOverrides).slice(0, 1000)) {
      if (!id || id.length > 160 || !isSafeKey(id) || typeof value !== "string" || value.length > 1000) continue;
      mnemonicOverrides[id] = value;
    }
  }

  const progress = {
    wrong,
    records,
    analysis,
    mnemonicOverrides,
    activePractice: isObject(input.activePractice) ? input.activePractice : null,
    activeExam: isObject(input.activeExam) ? input.activeExam : null,
  };

  const serialized = JSON.stringify(progress);
  if (byteLength(serialized) > MAX_PROGRESS_BYTES) {
    throw new HttpError(413, "进度数据过大，请清理旧记录后重试");
  }
  return { progress, serialized };
}

async function checkRateLimit(repo, key, now, windowMs, max) {
  const attempt = await repo.getAttempt(key);
  return Boolean(attempt && now - attempt.lastAt < windowMs && attempt.count >= max);
}

async function bumpRateLimit(repo, key, now, windowMs) {
  return repo.bumpAttempt(key, now, windowMs);
}

async function resolveUser(request, { repo, accessUser }) {
  if (accessUser?.email) {
    const email = validateEmail(accessUser.email);
    const externalId = String(accessUser.externalId || `access-email:${email}`).slice(0, 200);
    const user = await repo.findOrCreateExternalUser({
      externalId,
      email,
      name: sanitizeName(accessUser.name, email),
      now: Date.now(),
    });
    return { user, provider: "access" };
  }

  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return { user: null, provider: "" };
  const tokenHash = await sha256Hex(token);
  const session = await repo.findSession(tokenHash, Date.now());
  if (!session) return { user: null, provider: "" };
  const user = await repo.findUserById(session.userId);
  if (!user) return { user: null, provider: "" };
  return { user, provider: "password" };
}

async function handleRegister(request, options, now) {
  if (options.accessUser?.email) {
    throw new HttpError(400, "当前站点使用统一登录，无需注册");
  }
  const ipHash = await sha256Hex(`ip|${options.clientIp || "unknown"}`);
  const registerKey = `register|${ipHash}`;
  if (await checkRateLimit(options.repo, registerKey, now, REGISTER_WINDOW_MS, REGISTER_MAX_ATTEMPTS)) {
    throw new HttpError(429, "注册请求过于频繁，请稍后再试");
  }
  await bumpRateLimit(options.repo, registerKey, now, REGISTER_WINDOW_MS);

  const body = await readJson(request);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const name = sanitizeName(body.name, email);

  const existing = await options.repo.findUserByEmail(email);
  if (existing) throw new HttpError(409, "该邮箱已经注册，请直接登录");

  const user = {
    id: randomId("usr"),
    email,
    name,
    passwordHash: await hashPassword(password),
    externalId: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await options.repo.createUser(user);
  } catch (error) {
    if (String(error?.message || error).toLowerCase().includes("unique")) {
      throw new HttpError(409, "该邮箱已经注册，请直接登录");
    }
    throw error;
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await options.repo.createSession({
    tokenHash,
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  return json(
    { user: publicUser(user), provider: "password" },
    201,
    { "Set-Cookie": cookieHeader(token, { secure: options.secureCookies }) },
  );
}

async function handleLogin(request, options, now) {
  if (options.accessUser?.email) {
    throw new HttpError(400, "当前站点使用统一登录，无需密码登录");
  }
  const body = await readJson(request);
  const email = validateEmail(body.email);
  const password = String(body.password ?? "");
  if (!password || password.length > 128) {
    throw new HttpError(400, "邮箱或密码不正确");
  }

  const ipHash = await sha256Hex(`ip|${options.clientIp || "unknown"}`);
  const attemptKey = await sha256Hex(`login|${email}|${ipHash}`);
  if (await checkRateLimit(options.repo, attemptKey, now, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS)) {
    throw new HttpError(429, "登录尝试次数过多，请 15 分钟后再试");
  }

  const user = await options.repo.findUserByEmail(email);
  const valid = Boolean(user?.passwordHash) && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    await bumpRateLimit(options.repo, attemptKey, now, LOGIN_WINDOW_MS);
    throw new HttpError(401, "邮箱或密码不正确");
  }

  await options.repo.clearAttempt(attemptKey);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await options.repo.createSession({
    tokenHash,
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  return json(
    { user: publicUser(user), provider: "password" },
    200,
    { "Set-Cookie": cookieHeader(token, { secure: options.secureCookies }) },
  );
}

async function handleLogout(request, options, now) {
  if (options.accessUser?.email) {
    return json({
      ok: true,
      provider: "access",
      logoutUrl: "/cdn-cgi/access/logout",
    });
  }

  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await options.repo.deleteSession(await sha256Hex(token));
  }
  return json(
    { ok: true, provider: "password" },
    200,
    {
      "Set-Cookie": cookieHeader("", {
        secure: options.secureCookies,
        maxAge: 0,
      }),
    },
  );
}

async function handleMe(request, options) {
  const { user, provider } = await resolveUser(request, options);
  if (!user) return json({ user: null, provider: "" });
  return json({ user: publicUser(user), provider });
}

async function handleGetProgress(request, options) {
  const { user, provider } = await resolveUser(request, options);
  if (!user) return json({ error: "请先登录" }, 401);
  const stored = await options.repo.getProgress(user.id);
  return json({
    provider,
    progress: stored ? JSON.parse(stored.data) : null,
    revision: stored?.revision || 0,
    updatedAt: stored?.updatedAt || 0,
  });
}

async function handlePutProgress(request, options, now) {
  const { user, provider } = await resolveUser(request, options);
  if (!user) return json({ error: "请先登录" }, 401);

  const body = await readJson(request, MAX_PROGRESS_BYTES + 200_000);
  const baseRevision = Number.isInteger(body.baseRevision) && body.baseRevision >= 0
    ? body.baseRevision
    : 0;
  const { serialized } = sanitizeProgress(body.progress);

  const result = await options.repo.saveProgress(user.id, serialized, baseRevision, now);
  if (!result.ok) {
    return json(
      {
        error: "进度已在其他设备更新",
        provider,
        progress: result.data ? JSON.parse(result.data) : null,
        revision: result.revision || 0,
        updatedAt: result.updatedAt || 0,
      },
      409,
    );
  }

  return json({
    ok: true,
    provider,
    revision: result.revision,
    updatedAt: result.updatedAt,
  });
}

/**
 * @param {Request} request
 * @param {{
 *   repo: object,
 *   secureCookies?: boolean,
 *   clientIp?: string,
 *   accessUser?: { email: string, name?: string, externalId?: string } | null,
 * }} options
 */
export async function handleAccountRequest(request, options = {}) {
  const now = Date.now();
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request, url)) {
      throw new HttpError(403, "只允许本站页面调用账号接口");
    }

    if (path === "/api/auth/me" && request.method === "GET") {
      return await handleMe(request, options);
    }
    if (path === "/api/auth/register" && request.method === "POST") {
      return await handleRegister(request, options, now);
    }
    if (path === "/api/auth/login" && request.method === "POST") {
      return await handleLogin(request, options, now);
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      return await handleLogout(request, options, now);
    }
    if (path === "/api/progress" && request.method === "GET") {
      return await handleGetProgress(request, options);
    }
    if (path === "/api/progress" && request.method === "PUT") {
      return await handlePutProgress(request, options, now);
    }

    return json({ error: "API not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error("[account]", error);
    return json({ error: "服务器内部错误，请稍后重试" }, 500);
  }
}
