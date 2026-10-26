import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_AI_BASE = "https://api.deepseek.com";
const MAX_BODY = 2 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function safeResolve(baseDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = path.resolve(baseDir, `.${decoded}`);
  if (target !== baseDir && !target.startsWith(`${baseDir}${path.sep}`)) {
    return null;
  }
  return target;
}

async function serveStatic(req, res, pathname) {
  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }

  const baseDir = PUBLIC_DIR;
  const target = safeResolve(baseDir, pathname);
  if (!target) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    const data = await readFile(target);
    const extension = path.extname(target).toLowerCase();
    const type = MIME_TYPES[extension] || "application/octet-stream";
    const isHtml = extension === ".html";
    const isData = pathname.startsWith("/data/");
    const cacheControl = isHtml || isData ? "no-store" : extension === ".js" || extension === ".css" ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": cacheControl,
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

function buildEndpoint(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl || DEFAULT_AI_BASE).trim());
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Base URL 只支持 http/https");
  }
  if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("非本地地址必须使用 HTTPS");
  }
  if (parsed.protocol === "https:" && isPrivateHost(parsed.hostname) && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("不允许访问内网地址");
  }
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/chat/completions")) {
    pathname = `${pathname}/chat/completions`;
  }
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function messageFromError(text, status) {
  try {
    const payload = JSON.parse(text);
    const message = payload?.error?.message || payload?.message;
    if (message) return String(message);
  } catch {
    // Ignore.
  }
  return `DeepSeek 上游请求失败（HTTP ${status}）`;
}

async function handleChat(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: "只允许本站页面调用本地 AI 代理" });
    return;
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const messages = payload.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) {
    sendJson(res, 400, { error: "messages 参数不正确" });
    return;
  }
  const model = String(payload.model || "deepseek-flash").slice(0, 80);
  const stream = Boolean(payload.stream);
  const maxTokens = Math.max(16, Math.min(Number(payload.max_tokens) || 1200, 8000));
  const apiKey = String(req.headers["x-deepseek-key"] || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "未配置 DeepSeek API Key，请到设置中填写。" });
    return;
  }
  if (apiKey.length > 300) {
    sendJson(res, 400, { error: "API Key 格式不正确" });
    return;
  }

  let endpoint;
  try {
    endpoint = buildEndpoint(payload.baseUrl || DEFAULT_AI_BASE);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const upstreamBody = {
    model,
    messages: messages
      .filter((message) => message && typeof message.content === "string")
      .map((message) => ({
        role: ["system", "user", "assistant"].includes(message.role) ? message.role : "user",
        content: message.content,
      })),
    stream,
    max_tokens: maxTokens,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const abortOnClose = () => controller.abort();
  req.on("aborted", abortOnClose);
  res.on("close", () => {
    if (!res.writableEnded) abortOnClose();
  });

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      if (!res.writableEnded) sendJson(res, 504, { error: "DeepSeek 请求超时，请稍后重试" });
      return;
    }
    if (!res.writableEnded) sendJson(res, 502, { error: "无法连接 DeepSeek，请检查网络或 Base URL" });
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    clearTimeout(timeout);
    const message = messageFromError(text, upstream.status);
    sendJson(res, upstream.status === 401 || upstream.status === 403 ? 401 : 502, { error: message });
    return;
  }

  if (stream) {
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    try {
      for await (const chunk of upstream.body) {
        if (res.writableEnded) break;
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.warn("Stream interrupted:", error?.message || error);
      if (!res.writableEnded) res.end();
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  try {
    const text = await upstream.text();
    clearTimeout(timeout);
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(text);
  } catch {
    clearTimeout(timeout);
    if (!res.writableEnded) sendJson(res, 502, { error: "读取 DeepSeek 响应失败" });
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname = "/";
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = url.pathname;
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      node: process.version,
      version: "1.0.0",
    });
    return;
  }
  if (pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "API not found" });
    return;
  }

  await serveStatic(req, res, pathname);
  if (process.env.DEBUG) {
    console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。可以运行 PORT=4174 npm start 使用其他端口。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  A 类题库 · 本地学习网站");
  console.log("  ─────────────────────────────");
  console.log(`  本机访问   http://localhost:${PORT}`);
  if (HOST === "0.0.0.0" || HOST === "::") {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
      }
    }
    addresses.forEach((address) => console.log(`  局域网     http://${address}:${PORT}`));
  }
  console.log("  DeepSeek   请在网页设置中填写本地 API Key");
  console.log("  ─────────────────────────────");
  console.log("  按 Ctrl+C 停止服务");
  console.log("");
});
