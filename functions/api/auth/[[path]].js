import { handleAccountRequest } from "../../../shared/account.js";
import { createD1Repo } from "../../../worker/d1-repo.js";

function secure(response) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB || env.crac_a_quiz;
  if (!db) {
    return secure(
      Response.json(
        {
          error:
            "云端账号服务暂未开启，请稍后再试或联系站点管理员。",
        },
        { status: 503 },
      ),
    );
  }

  const response = await handleAccountRequest(request, {
    repo: createD1Repo(db),
    secureCookies: new URL(request.url).protocol === "https:",
    clientIp: request.headers.get("CF-Connecting-IP") || "",
  });
  return secure(response);
}
