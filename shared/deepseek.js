/**
 * Shared DeepSeek proxy used by both Cloudflare Workers and Pages Functions.
 *
 * The browser sends the user's API key in `x-deepseek-key`. The serverless
 * handler forwards the request to DeepSeek and streams SSE back. The key is
 * never stored.
 */

const DEFAULT_BASE = "https://api.deepseek.com";
const MAX_BODY = 2 * 1024 * 1024;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
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
    parsed = new URL(String(baseUrl || DEFAULT_BASE).trim());
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Base URL 只支持 http/https");
  }
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  if (parsed.protocol === "http:" && !localHosts.includes(parsed.hostname)) {
    throw new Error("非本地地址必须使用 HTTPS");
  }
  if (
    parsed.protocol === "https:" &&
    isPrivateHost(parsed.hostname) &&
    !localHosts.includes(parsed.hostname)
  ) {
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

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

export async function handleChat(request) {
  const url = new URL(request.url);
  if (!sameOrigin(request, url)) {
    return json({ error: "只允许本站页面调用 AI 代理" }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY) {
    return json({ error: "请求内容过大" }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const messages = payload?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) {
    return json({ error: "messages 参数不正确" }, 400);
  }

  const model = String(payload.model || "deepseek-flash").slice(0, 80);
  const stream = Boolean(payload.stream);
  const maxTokens = Math.max(16, Math.min(Number(payload.max_tokens) || 1200, 8000));
  const apiKey = String(request.headers.get("x-deepseek-key") || "").trim();

  if (!apiKey) {
    return json({ error: "未配置 DeepSeek API Key，请到设置中填写本地 Key。" }, 400);
  }
  if (apiKey.length > 300) {
    return json({ error: "API Key 格式不正确" }, 400);
  }

  let endpoint;
  try {
    endpoint = buildEndpoint(payload.baseUrl || DEFAULT_BASE);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const upstreamBody = {
    model,
    messages: messages
      .filter((message) => message && typeof message.content === "string")
      .map((message) => ({
        role: ["system", "user", "assistant"].includes(message.role)
          ? message.role
          : "user",
        content: message.content,
      })),
    stream,
    max_tokens: maxTokens,
  };

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
    });
  } catch {
    return json({ error: "无法连接 DeepSeek，请检查网络或 Base URL" }, 502);
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return json(
      { error: messageFromError(text, upstream.status) },
      upstream.status === 401 || upstream.status === 403 ? 401 : 502,
    );
  }

  if (stream) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function handleHealth(runtime = "cloudflare-worker") {
  return json({
    ok: true,
    runtime,
    version: "1.1.0",
  });
}
