/* Login / register page and signed-in account summary. */

import {
  account,
  accountInitial,
  loginAccount,
  logoutAccount,
  providerLabel,
  registerAccount,
  retryAccount,
  syncNow,
  syncStatusText,
  syncStatusTone,
} from "../account.js";
import {
  confirmDialog,
  escapeHtml,
  formatDateTime,
  icon,
  resolvedTheme,
  toast,
  toggleTheme,
} from "../core.js";

function safeNext(value) {
  const raw = String(value || "");
  if (!raw || !raw.startsWith("#/")) return "#/dashboard";
  if (raw.startsWith("#/login")) return "#/dashboard";
  return raw;
}

function syncToneClass() {
  return `is-${syncStatusTone()}`;
}

function signedInHTML() {
  const user = account.user;
  return `
    <div class="auth-signed-in">
      <div class="auth-avatar">${escapeHtml(accountInitial())}</div>
      <span class="account-provider-badge">${icon(account.provider === "access" ? "shield" : "mail", 14)} ${escapeHtml(providerLabel() || "已登录")}</span>
      <h2>${escapeHtml(user.name)}</h2>
      <p>${escapeHtml(user.email)}</p>

      <div class="auth-sync-card">
        <span class="sync-dot ${syncToneClass()}"></span>
        <div>
          <strong>${escapeHtml(syncStatusText())}</strong>
          <small>${account.lastSyncedAt ? `最近同步 ${escapeHtml(formatDateTime(account.lastSyncedAt))}` : "进度会在答题后自动同步"}</small>
        </div>
      </div>

      <div class="auth-actions">
        <button type="button" class="btn btn-secondary" data-auth-sync>${icon("rotate", 16)} 立即同步</button>
        <a class="btn btn-primary" href="#/dashboard">${icon("home", 16)} 回到首页</a>
      </div>
      <button type="button" class="btn btn-ghost btn-sm auth-logout" data-auth-logout>${icon("logout", 15)} ${account.provider === "access" ? "退出站点登录" : "退出登录"}</button>
      <p class="auth-note">${icon("lock", 14)} 同步内容只包含练习记录、错题本、AI 解析缓存和当前答题会话；DeepSeek API Key 始终只保存在本机。</p>
    </div>`;
}

function unavailableHTML() {
  const disabled = account.status === "disabled";
  return `
    <div class="auth-unavailable">
      <div class="auth-unavailable-icon">${icon(disabled ? "cloudOff" : "alert", 28)}</div>
      <h2>${disabled ? "云端账号暂未开启" : "暂时无法连接账号服务"}</h2>
      <p>${disabled ? "当前站点还没有开启云端账号功能，练习进度会继续保存在本机浏览器，不影响正常刷题。" : "请检查网络后重试。练习进度仍会保存在本机浏览器。"}</p>
      ${disabled ? "" : `<button type="button" class="btn btn-secondary" data-auth-retry>${icon("rotate", 16)} 重试连接</button>`}
      <a class="auth-local-link" href="#/dashboard">${icon("arrowLeft", 14)} 先不登录，继续本地使用</a>
    </div>`;
}

function loginFormHTML() {
  return `
    <div class="auth-head">
      <span class="section-kicker">Account</span>
      <h2 data-auth-title>欢迎回来</h2>
      <p data-auth-subtitle>登录后，练习记录和错题本会按账号安全保存，换设备也能接着练。</p>
    </div>

    <div class="auth-tabs" role="tablist" aria-label="登录或注册">
      <button type="button" class="auth-tab is-active" data-auth-tab="login" role="tab" aria-selected="true">登录</button>
      <button type="button" class="auth-tab" data-auth-tab="register" role="tab" aria-selected="false">注册</button>
    </div>

    <form class="auth-form" id="auth-form" novalidate>
      <label class="field" data-register-only hidden>
        <span>昵称</span>
        <input id="auth-name" type="text" maxlength="32" autocomplete="nickname" placeholder="显示在首页，可留空" />
      </label>
      <label class="field">
        <span>邮箱</span>
        <input id="auth-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="field">
        <span>密码</span>
        <div class="input-group">
          <input id="auth-password" type="password" maxlength="128" autocomplete="current-password" placeholder="至少 8 位" required />
          <button type="button" class="input-action" data-toggle-password aria-label="显示或隐藏密码">${icon("eye", 17)}</button>
        </div>
        <small>密码会经过安全处理，不会以明文保存。</small>
      </label>
      <label class="field" data-register-only hidden>
        <span>确认密码</span>
        <input id="auth-confirm" type="password" maxlength="128" autocomplete="new-password" placeholder="再输入一次密码" />
      </label>

      <div class="auth-error" data-auth-error role="alert" hidden></div>
      <button type="submit" class="btn btn-primary btn-block auth-submit" data-auth-submit>${icon("arrowRight", 17)} 登录</button>
    </form>

    <p class="auth-switch">
      <span data-auth-switch-text>还没有账号？</span>
      <button type="button" class="text-button" data-auth-switch>立即注册</button>
    </p>
    <a class="auth-local-link" href="#/dashboard">${icon("lock", 14)} 先不登录，继续本地使用（进度只保存在本机）</a>`;
}

function mobileBrandHTML() {
  return `
    <div class="login-panel-brand">
      <span class="login-brand-mark">${icon("radio", 22)}</span>
      <span><strong>电波题库</strong><small>A 类操作能力验证</small></span>
    </div>`;
}

function shellHTML(body) {
  return `
    <div class="page login-page">
      <button type="button" class="login-theme-toggle icon-btn" data-login-theme aria-label="切换主题">${icon(resolvedTheme() === "dark" ? "sun" : "moon", 18)}</button>
      <section class="login-shell">
        <aside class="login-aside">
          <a class="login-brand" href="#/dashboard">
            <span class="login-brand-mark">${icon("radio", 24)}</span>
            <span><strong>电波题库</strong><small>A 类操作能力验证</small></span>
          </a>
          <div class="login-copy">
            <span class="section-kicker">账号同步</span>
            <h2>把每一次练习，<br />留在你的账号里。</h2>
            <p>登录后，练习记录、错题本、解析缓存和进行中的答题会话都会安全保存，手机和电脑可以接着练。</p>
          </div>
          <ul class="login-features">
            <li><span>${icon("cloud", 18)}</span><div><strong>按用户保存进度</strong><small>换设备登录同一个账号即可继续</small></div></li>
            <li><span>${icon("shield", 18)}</span><div><strong>本地优先，不怕断网</strong><small>答题先写入本机，联网后自动同步</small></div></li>
            <li><span>${icon("lock", 18)}</span><div><strong>密钥只留在本机</strong><small>DeepSeek 密钥不会保存到账号或云端</small></div></li>
          </ul>
          <div class="login-stats">
            <div><strong>683</strong><span>道题</span></div>
            <div><strong>20</strong><span>个知识点</span></div>
            <div><strong>多端</strong><span>进度同步</span></div>
          </div>
        </aside>
        <div class="login-panel">
          ${mobileBrandHTML()}
          ${body}
        </div>
      </section>
    </div>`;
}

export function renderLogin(root, params = new URLSearchParams()) {
  let mode = params.get("tab") === "register" ? "register" : "login";
  const next = safeNext(params.get("next"));
  let userKey = account.user?.id || "";

  function showError(message) {
    const box = root.querySelector("[data-auth-error]");
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  }

  function setMode(nextMode) {
    mode = nextMode === "register" ? "register" : "login";
    const register = mode === "register";
    root.querySelectorAll("[data-auth-tab]").forEach((button) => {
      const active = button.dataset.authTab === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    root.querySelectorAll("[data-register-only]").forEach((node) => {
      node.hidden = !register;
    });
    const title = root.querySelector("[data-auth-title]");
    const subtitle = root.querySelector("[data-auth-subtitle]");
    const submit = root.querySelector("[data-auth-submit]");
    const switchText = root.querySelector("[data-auth-switch-text]");
    const switchButton = root.querySelector("[data-auth-switch]");
    if (title) title.textContent = register ? "创建账号" : "欢迎回来";
    if (subtitle) {
      subtitle.textContent = register
        ? "注册后，当前浏览器里的本地进度会自动合并到新账号。"
        : "登录后，练习记录和错题本会按账号安全保存，换设备也能接着练。";
    }
    if (submit) submit.innerHTML = `${icon(register ? "check" : "arrowRight", 17)} ${register ? "创建账号" : "登录"}`;
    if (switchText) switchText.textContent = register ? "已经有账号？" : "还没有账号？";
    if (switchButton) switchButton.textContent = register ? "去登录" : "立即注册";
    const password = root.querySelector("#auth-password");
    if (password) password.autocomplete = register ? "new-password" : "current-password";
    showError("");
  }

  function paint() {
    if (account.user) {
      root.innerHTML = shellHTML(signedInHTML());
      bindSignedIn();
      return;
    }
    if (!account.available) {
      root.innerHTML = shellHTML(unavailableHTML());
      bindUnavailable();
      return;
    }
    root.innerHTML = shellHTML(loginFormHTML());
    setMode(mode);
    bindForm();
  }

  function bindUnavailable() {
    root.querySelector("[data-auth-retry]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner"></span> 正在重试…`;
      await retryAccount();
      paint();
    });
  }

  function bindForm() {
    const form = root.querySelector("#auth-form");
    const submit = root.querySelector("[data-auth-submit]");

    root.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.authTab));
    });
    root.querySelector("[data-auth-switch]")?.addEventListener("click", () => {
      setMode(mode === "login" ? "register" : "login");
    });
    root.querySelector("[data-toggle-password]")?.addEventListener("click", (event) => {
      const input = root.querySelector("#auth-password");
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      event.currentTarget.innerHTML = icon(visible ? "eyeOff" : "eye", 17);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = (root.querySelector("#auth-email")?.value || "").trim();
      const password = root.querySelector("#auth-password")?.value || "";
      const confirm = root.querySelector("#auth-confirm")?.value || "";
      const name = (root.querySelector("#auth-name")?.value || "").trim();

      showError("");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        showError("请输入有效的邮箱地址。");
        return;
      }
      if (password.length < 8) {
        showError("密码至少需要 8 位。");
        return;
      }
      if (mode === "register" && password !== confirm) {
        showError("两次输入的密码不一致。");
        return;
      }

      submit.disabled = true;
      submit.innerHTML = `<span class="button-spinner"></span> ${mode === "register" ? "正在创建…" : "正在登录…"}`;
      try {
        if (mode === "register") {
          await registerAccount(email, password, name);
          toast("账号已创建，进度已开始同步", "success");
        } else {
          await loginAccount(email, password);
          toast("登录成功，进度已同步", "success");
        }
        if (!account.user) throw new Error("登录状态已失效，请重试");
        if (account.status === "error" || account.status === "offline") {
          toast("登录成功，但云端同步暂时失败，进度会在稍后重试", "info", 4200);
        }
        window.location.hash = next;
      } catch (error) {
        showError(error?.name === "AbortError" ? "请求超时，请检查网络后重试。" : error.message || "操作失败，请稍后重试。");
        submit.disabled = false;
        submit.innerHTML = `${icon(mode === "register" ? "check" : "arrowRight", 17)} ${mode === "register" ? "创建账号" : "登录"}`;
      }
    });

    if (!window.matchMedia("(max-width: 900px)").matches) {
      root.querySelector("#auth-email")?.focus({ preventScroll: true });
    }
  }

  function bindSignedIn() {
    root.querySelector("[data-auth-sync]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner"></span> 正在同步…`;
      const ok = await syncNow();
      button.disabled = false;
      button.innerHTML = `${icon("rotate", 16)} 立即同步`;
      toast(ok ? "进度已同步" : "同步失败，进度仍保存在本机", ok ? "success" : "error");
      paint();
    });

    root.querySelector("[data-auth-logout]")?.addEventListener("click", async () => {
      const access = account.provider === "access";
      const confirmed = await confirmDialog({
        title: access ? "退出站点登录？" : "退出登录？",
        message: access
          ? "退出后需要重新通过站点登录验证。本机会清除当前账号的进度缓存，云端进度不受影响。"
          : "退出后本机会清除当前账号的进度缓存，云端进度不受影响。下次登录同一账号会自动恢复。",
        confirmText: access ? "退出站点登录" : "退出登录",
        danger: true,
      });
      if (!confirmed) return;
      await logoutAccount();
      toast("已退出登录", "success");
      if (account.available && !account.user) paint();
    });
  }

  const onAccountChanged = () => {
    const nextKey = account.user?.id || "";
    if (nextKey !== userKey) {
      userKey = nextKey;
      paint();
      return;
    }
    const statusCard = root.querySelector(".auth-sync-card");
    if (statusCard) {
      const dot = statusCard.querySelector(".sync-dot");
      if (dot) dot.className = `sync-dot ${syncToneClass()}`;
      const strong = statusCard.querySelector("strong");
      const small = statusCard.querySelector("small");
      if (strong) strong.textContent = syncStatusText();
      if (small) {
        small.textContent = account.lastSyncedAt
          ? `最近同步 ${formatDateTime(account.lastSyncedAt)}`
          : "进度会在答题后自动同步";
      }
    }
  };

  const onSyncStatus = () => onAccountChanged();

  const onThemeClick = (event) => {
    const button = event.target.closest("[data-login-theme]");
    if (!button) return;
    toggleTheme();
    button.innerHTML = icon(resolvedTheme() === "dark" ? "sun" : "moon", 18);
  };
  root.addEventListener("click", onThemeClick);

  paint();
  document.addEventListener("account:changed", onAccountChanged);
  document.addEventListener("sync:status", onSyncStatus);

  return () => {
    document.removeEventListener("account:changed", onAccountChanged);
    document.removeEventListener("sync:status", onSyncStatus);
    root.removeEventListener("click", onThemeClick);
    root.innerHTML = "";
  };
}
