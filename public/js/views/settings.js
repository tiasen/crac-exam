/* Settings: account sync, DeepSeek, exam defaults, appearance, import/export and reset. */

import {
  account,
  accountInitial,
  logoutAccount,
  providerLabel,
  syncNow,
  syncStatusText,
  syncStatusTone,
} from "../account.js";
import {
  aiReady,
  applyTheme,
  confirmDialog,
  DEFAULT_SETTINGS,
  downloadFile,
  escapeHtml,
  formatDateTime,
  icon,
  notifyShell,
  readFileAsText,
  resetProgress,
  saveState,
  setTheme,
  state,
  testConnection,
  toast,
} from "../core.js";
import { data, getWrongCount } from "../data.js";

function collectSettings(root) {
  const apiKey = (root.querySelector("#api-key")?.value || "").trim();
  const model = root.querySelector("#ai-model")?.value || DEFAULT_SETTINGS.model;
  let baseUrl = (root.querySelector("#ai-base-url")?.value || DEFAULT_SETTINGS.baseUrl).trim();
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  try {
    const parsed = new URL(baseUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  return {
    settings: {
      apiKey,
      model,
      baseUrl,
      exam: {
        count: Math.max(5, Math.min(Number(root.querySelector("#settings-exam-count")?.value) || 40, data.meta.total)),
        duration: Math.max(1, Math.min(Number(root.querySelector("#settings-exam-duration")?.value) || 25, 180)),
        passPercent: Math.max(50, Math.min(Number(root.querySelector("#settings-exam-pass")?.value) || 75, 100)),
      },
    },
  };
}

function persistSettings(root, { silent = false } = {}) {
  const { settings } = collectSettings(root);
  state.settings = { ...state.settings, ...settings };
  saveState();
  notifyShell();
  if (!silent) toast("设置已保存", "success");
  return settings;
}

function aiStatusHTML() {
  if (aiReady()) {
    return `
      <span class="ai-status-dot is-ready"></span>
      <span>
        <strong>DeepSeek 已配置</strong>
        <small>当前模型：${escapeHtml(state.settings.model)} · Key 仅保存在本地浏览器</small>
      </span>`;
  }
  return `
    <span class="ai-status-dot"></span>
    <span>
      <strong>尚未配置 DeepSeek</strong>
      <small>在下方填写本地 API Key 后，AI 解析才可用</small>
    </span>`;
}

function themeChoiceHTML() {
  const current = state.settings.theme;
  return [
    ["light", "sun", "浅色", "明亮清爽"],
    ["dark", "moon", "深色", "夜间护眼"],
    ["system", "settings", "跟随系统", "自动切换"],
  ]
    .map(
      ([value, iconName, title, note]) => `
        <button type="button" class="theme-option ${current === value ? "is-active" : ""}" data-theme-choice="${value}">
          <span class="theme-swatch theme-${value}">${icon(iconName, 18)}</span>
          <span><strong>${title}</strong><small>${note}</small></span>
          <span class="theme-check">${icon("check", 14)}</span>
        </button>`,
    )
    .join("");
}

function categoriesSummaryHTML() {
  return data.categories
    .map(
      (category) =>
        `<span class="about-category tone-${category.id}"><i></i>${escapeHtml(category.name)} <b>${category.count}</b></span>`,
    )
    .join("");
}

function accountBadgeHTML() {
  if (account.user) {
    return `<span class="badge ${account.status === "synced" ? "badge-pass" : "badge-neutral"}">${escapeHtml(syncStatusText())}</span>`;
  }
  return `<span class="badge badge-neutral">${account.available ? "未登录" : "云端未启用"}</span>`;
}

function accountSettingsHTML() {
  const tone = syncStatusTone();

  if (!account.available) {
    return `
      <div class="account-status-row">
        <span class="account-avatar is-muted">${icon("cloudOff", 18)}</span>
        <div class="account-identity">
          <strong>${account.status === "disabled" ? "当前站点暂未开启云端同步" : "无法连接账号服务"}</strong>
          <small>${account.status === "disabled" ? "练习进度仍会完整保存在本机浏览器，不影响正常刷题。" : escapeHtml(account.error || "练习进度仍会完整保存在本机浏览器。")}</small>
        </div>
      </div>
      <div class="data-actions">
        <a class="btn btn-secondary" href="#/login">${icon("info", 16)} 查看账号说明</a>
      </div>`;
  }

  if (!account.user) {
    return `
      <div class="account-status-row">
        <span class="account-avatar is-muted">?</span>
        <div class="account-identity">
          <strong>尚未登录</strong>
          <small>登录后练习记录、错题本和解析缓存会按账号安全保存，换设备也能接着练。</small>
        </div>
      </div>
      <div class="data-actions">
        <a class="btn btn-primary" href="#/login?next=%23%2Fsettings">${icon("user", 16)} 登录 / 注册</a>
      </div>
      <p class="settings-note">${icon("lock", 15)} 未登录时所有进度只保存在当前浏览器；DeepSeek 密钥在任何情况下都不会上传。</p>`;
  }

  return `
    <div class="account-status-row">
      <span class="account-avatar">${escapeHtml(accountInitial())}</span>
      <div class="account-identity">
        <strong>${escapeHtml(account.user.name)}</strong>
        <small>${escapeHtml(account.user.email)}</small>
        <span class="account-provider-badge">${icon(account.provider === "access" ? "shield" : "mail", 13)} ${escapeHtml(providerLabel())}</span>
      </div>
      <span class="sync-dot is-${tone}"></span>
    </div>
    <div class="account-sync-line">
      ${icon(account.status === "synced" ? "cloud" : "rotate", 15)}
      <span>${escapeHtml(syncStatusText())}</span>
      ${account.lastSyncedAt ? `<small>最近同步 ${escapeHtml(formatDateTime(account.lastSyncedAt))}</small>` : ""}
    </div>
    <div class="data-actions">
      <button type="button" class="btn btn-secondary" data-sync-now>${icon("rotate", 16)} 立即同步</button>
      <button type="button" class="btn btn-ghost btn-sm" data-account-logout>${icon("logout", 15)} ${account.provider === "access" ? "退出站点登录" : "退出登录"}</button>
    </div>
    <p class="settings-note">${icon("lock", 15)} 云端只保存练习进度、错题、解析缓存和答题会话；DeepSeek API Key 始终只保存在本机。</p>`;
}

function settingsHTML() {
  const exam = state.settings.exam;
  return `
    <div class="page settings-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">Settings</span>
          <h2>设置</h2>
          <p>配置账号同步、DeepSeek、模拟考试默认值和本地数据。未登录时数据只保存在本机；登录后进度可同步到云端。</p>
        </div>
        <div class="page-head-actions">
          <div class="page-head-badge">${icon("settings", 18)} 本地优先</div>
          <button type="submit" form="settings-form" class="btn btn-primary btn-md">${icon("check", 16)} 保存设置</button>
        </div>
      </header>

      <form id="settings-form" class="settings-form" autocomplete="off">
        <div class="settings-grid">
          <section class="card settings-card settings-account-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">Account</span>
                <h3>账号与云端同步</h3>
              </div>
              <span id="settings-account-badge">${accountBadgeHTML()}</span>
            </header>
            <div id="settings-account-body">${accountSettingsHTML()}</div>
          </section>

          <section class="card settings-card settings-ai-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">AI</span>
                <h3>DeepSeek 在线解析</h3>
              </div>
              <span class="badge ${aiReady() ? "badge-pass" : "badge-neutral"}">${aiReady() ? "已配置" : "未配置"}</span>
            </header>

            <div class="ai-config-status">${aiStatusHTML()}</div>

            <label class="field">
              <span>API Key</span>
              <div class="input-group">
                <input id="api-key" type="password" value="${escapeHtml(state.settings.apiKey)}" placeholder="sk-..." autocomplete="off" spellcheck="false" />
                <button type="button" class="input-action" data-toggle-key aria-label="显示或隐藏 API Key">${icon("eye", 17)}</button>
              </div>
              <small>密钥只保存在当前浏览器，仅在发起 AI 请求时使用，不会被保存到账号或写入日志。</small>
            </label>

            <div class="form-grid">
              <label class="field">
                <span>模型</span>
                <div class="select-wrap">
                  ${icon("brain", 16)}
                  <select id="ai-model" class="select">
                    <option value="deepseek-flash" ${state.settings.model === "deepseek-flash" ? "selected" : ""}>deepseek-flash · 默认</option>
                    <option value="deepseek-reasoner" ${state.settings.model === "deepseek-reasoner" ? "selected" : ""}>deepseek-reasoner · 深度推理</option>
                  </select>
                  ${icon("chevronDown", 15)}
                </div>
                <small>默认使用 deepseek-flash；reasoner 更细致，但响应更慢。</small>
              </label>
              <label class="field">
                <span>Base URL</span>
                <input id="ai-base-url" type="url" value="${escapeHtml(state.settings.baseUrl)}" placeholder="https://api.deepseek.com" spellcheck="false" />
                <small>兼容 OpenAI 格式的中转地址也可以填写。</small>
              </label>
            </div>

            <div class="settings-actions">
              <button type="button" class="btn btn-secondary" data-test-connection>${icon("signal", 16)} 测试连接</button>
              <button type="button" class="btn btn-ghost btn-sm" data-clear-key>清除 Key</button>
              <span class="form-status" id="test-status"></span>
            </div>
            <p class="settings-note">${icon("info", 15)} 未配置 Key 时，AI 分析只显示配置提示，不会向 DeepSeek 发起请求。</p>
          </section>

          <section class="card settings-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">Exam</span>
                <h3>模拟考试默认值</h3>
              </div>
            </header>
            <div class="form-grid">
              <label class="field">
                <span>题目数量</span>
                <div class="input-with-suffix">
                  <input id="settings-exam-count" type="number" min="5" max="${data.meta.total}" value="${exam.count}" />
                  <em>题</em>
                </div>
              </label>
              <label class="field">
                <span>考试时长</span>
                <div class="input-with-suffix">
                  <input id="settings-exam-duration" type="number" min="1" max="180" value="${exam.duration}" />
                  <em>分钟</em>
                </div>
              </label>
              <label class="field field-wide">
                <span>合格线</span>
                <div class="input-with-suffix">
                  <input id="settings-exam-pass" type="number" min="50" max="100" value="${exam.passPercent}" />
                  <em>%</em>
                </div>
                <small>A 类正式考试为 40 题、25 分钟，答对 30 题合格（75%）；前 32 题单选，后 8 题多选。</small>
              </label>
            </div>
          </section>

          <section class="card settings-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">Appearance</span>
                <h3>界面主题</h3>
              </div>
            </header>
            <div class="theme-choices">${themeChoiceHTML()}</div>
          </section>

          <section class="card settings-card settings-data-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">Data</span>
                <h3>本地数据与备份</h3>
              </div>
            </header>
            <div class="data-mini-grid">
              <div><span>练习记录</span><strong>${state.records.length}</strong></div>
              <div><span>待攻克错题</span><strong>${getWrongCount()}</strong></div>
              <div><span>AI 解析缓存</span><strong>${Object.keys(state.analysis).length}</strong></div>
            </div>
            <div class="data-actions">
              <button type="button" class="btn btn-secondary" data-export>${icon("download", 16)} 导出备份</button>
              <button type="button" class="btn btn-secondary" data-import>${icon("upload", 16)} 导入备份</button>
              <button type="button" class="btn btn-ghost btn-sm" data-clear-analysis>清空 AI 缓存</button>
              <button type="button" class="btn btn-danger-ghost btn-sm" data-reset>${icon("trash", 15)} 重置学习进度</button>
            </div>
            <input type="file" id="import-file" accept="application/json,.json" hidden />
            <p class="settings-note">${icon("info", 15)} 导出的备份不包含 API Key。导入会覆盖当前记录和错题，请先导出备份。登录状态下导入后会自动同步到云端。</p>
          </section>

          <section class="card settings-card settings-about-card">
            <header class="section-head">
              <div>
                <span class="section-kicker">About</span>
                <h3>关于题库</h3>
              </div>
            </header>
            <div class="about-head">
              <div class="about-mark">${icon("radio", 26)}</div>
              <div>
                <strong>${escapeHtml(data.meta.title)}</strong>
                <span>版本 ${escapeHtml(data.meta.version)} · 构建于 ${escapeHtml(data.meta.generatedAt)}</span>
              </div>
            </div>
            <div class="about-grid">
              <div><span>总题数</span><strong>${data.meta.total}</strong></div>
              <div><span>单选</span><strong>${data.meta.singleCount}</strong></div>
              <div><span>多选</span><strong>${data.meta.multipleCount}</strong></div>
              <div><span>PDF 页数</span><strong>${data.meta.sourcePages}</strong></div>
            </div>
            <div class="about-categories">${categoriesSummaryHTML()}</div>
            <div class="about-links">
              <a class="text-link" href="/data/questions.json" download>下载题库 JSON ${icon("download", 14)}</a>
              <span>·</span>
              <span>数据源：${escapeHtml(data.meta.source)}</span>
            </div>
            <p class="settings-note">本站为本地学习工具，题目与答案来自所提供 PDF。发现争议题请以官方最新题库为准。</p>
          </section>
        </div>

        <div class="settings-save-bar">
          <span>${icon("info", 15)} 修改 AI、考试设置后请保存。</span>
          <button type="submit" class="btn btn-primary">${icon("check", 17)} 保存设置</button>
        </div>
      </form>
    </div>`;
}

function updateAiStatus(root) {
  const status = root.querySelector(".ai-config-status");
  if (status) status.innerHTML = aiStatusHTML();
  const badge = root.querySelector(".settings-ai-card .section-head .badge");
  if (badge) {
    badge.textContent = aiReady() ? "已配置" : "未配置";
    badge.className = `badge ${aiReady() ? "badge-pass" : "badge-neutral"}`;
  }
}

function bind(root) {
  const form = root.querySelector("#settings-form");
  const testStatus = root.querySelector("#test-status");
  const importInput = root.querySelector("#import-file");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      persistSettings(root);
      updateAiStatus(root);
    } catch (error) {
      toast(error.message || "设置保存失败", "error");
    }
  });

  root.querySelector("[data-toggle-key]").addEventListener("click", (event) => {
    const input = root.querySelector("#api-key");
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    event.currentTarget.innerHTML = icon(isPassword ? "eyeOff" : "eye", 17);
  });

  root.querySelector("[data-clear-key]").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "清除 API Key？",
      message: "清除后本地浏览器将不再保存 DeepSeek 密钥，AI 解析将不可用。",
      confirmText: "清除 Key",
      danger: true,
    });
    if (!confirmed) return;
    const input = root.querySelector("#api-key");
    if (input) input.value = "";
    try {
      persistSettings(root, { silent: true });
      updateAiStatus(root);
      toast("本地 API Key 已清除", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  root.querySelector("[data-test-connection]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      persistSettings(root, { silent: true });
    } catch (error) {
      testStatus.className = "form-status is-error";
      testStatus.textContent = error.message;
      return;
    }
    if (!aiReady()) {
      testStatus.className = "form-status is-error";
      testStatus.textContent = "请先在设置中填写本地 API Key。";
      return;
    }
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner"></span> 正在连接…`;
    testStatus.className = "form-status is-loading";
    testStatus.textContent = "正在请求 DeepSeek…";
    try {
      const reply = await testConnection();
      testStatus.className = "form-status is-success";
      testStatus.textContent = `连接成功：${reply}`;
      toast("DeepSeek 连接成功", "success");
    } catch (error) {
      testStatus.className = "form-status is-error";
      testStatus.textContent = error.message || "连接失败";
      toast("DeepSeek 连接失败", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon("signal", 16)} 测试连接`;
      updateAiStatus(root);
    }
  });

  root.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(button.dataset.themeChoice);
      root.querySelectorAll("[data-theme-choice]").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.themeChoice === button.dataset.themeChoice);
      });
    });
  });

  root.querySelector("[data-export]").addEventListener("click", () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const payload = {
      app: "crac-a-quiz",
      version: 1,
      exportedAt: now.toISOString(),
      settings: { ...state.settings, apiKey: "" },
      wrong: state.wrong,
      records: state.records,
      analysis: state.analysis,
      mnemonicOverrides: state.mnemonicOverrides,
    };
    downloadFile(`crac-a-quiz-backup-${stamp}.json`, JSON.stringify(payload, null, 2));
    toast("备份已导出（不含 API Key）", "success");
  });

  root.querySelector("[data-import]").addEventListener("click", () => {
    importInput.value = "";
    importInput.click();
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const raw = await readFileAsText(file);
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || (!payload.wrong && !payload.records && !payload.settings)) {
        throw new Error("备份文件格式不正确");
      }
      const confirmed = await confirmDialog({
        title: "导入备份？",
        message: "导入后会覆盖当前的练习记录、错题和设置。当前 API Key 会保留，确定继续吗？",
        confirmText: "导入并覆盖",
        danger: true,
      });
      if (!confirmed) return;
      const importedSettings =
        payload.settings && typeof payload.settings === "object" ? payload.settings : {};
      const importedExam =
        importedSettings.exam && typeof importedSettings.exam === "object"
          ? { ...state.settings.exam, ...importedSettings.exam }
          : state.settings.exam;
      state.settings = {
        ...state.settings,
        ...importedSettings,
        exam: importedExam,
        apiKey: state.settings.apiKey,
      };
      if (!["light", "dark", "system"].includes(state.settings.theme)) {
        state.settings.theme = "system";
      }
      applyTheme();
      state.wrong = payload.wrong && typeof payload.wrong === "object" ? payload.wrong : {};
      state.records = Array.isArray(payload.records) ? payload.records.slice(0, 120) : [];
      state.analysis = payload.analysis && typeof payload.analysis === "object" ? payload.analysis : {};
      state.mnemonicOverrides =
        payload.mnemonicOverrides && typeof payload.mnemonicOverrides === "object"
          ? payload.mnemonicOverrides
          : state.mnemonicOverrides;
      state.activePractice = null;
      state.activeExam = null;
      saveState();
      notifyShell();
      toast("备份已导入", "success");
      paint(root);
    } catch (error) {
      console.error(error);
      toast(error.message || "导入失败，请检查文件", "error");
    }
  });

  root.querySelector("[data-clear-analysis]").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "清空 AI 解析缓存？",
      message: "已缓存的逐题解析将被删除，下次分析会重新请求 DeepSeek。",
      confirmText: "清空缓存",
    });
    if (!confirmed) return;
    state.analysis = {};
    saveState();
    toast("AI 解析缓存已清空", "success");
    paint(root);
  });

  root.querySelector("[data-reset]").addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "重置学习进度？",
      message: "练习记录、错题本、进行中的练习和 AI 解析缓存都会被清空。设置和 API Key 保留。此操作无法撤销。",
      confirmText: "确认重置",
      danger: true,
    });
    if (!confirmed) return;
    resetProgress();
    notifyShell();
    toast("学习进度已重置", "success");
    paint(root);
  });
}

function paint(root) {
  root.innerHTML = settingsHTML();
  bind(root);
}

export function renderSettings(root) {
  paint(root);

  const refreshAccount = () => {
    const body = root.querySelector("#settings-account-body");
    if (body) body.innerHTML = accountSettingsHTML();
    const badge = root.querySelector("#settings-account-badge");
    if (badge) badge.innerHTML = accountBadgeHTML();
  };

  const onAccount = () => refreshAccount();
  const onSync = () => refreshAccount();
  document.addEventListener("account:changed", onAccount);
  document.addEventListener("sync:status", onSync);

  const onClick = async (event) => {
    const syncButton = event.target.closest("[data-sync-now]");
    if (syncButton) {
      event.preventDefault();
      syncButton.disabled = true;
      syncButton.innerHTML = `<span class="button-spinner"></span> 正在同步…`;
      const ok = await syncNow();
      toast(ok ? "进度已同步" : "同步失败，进度仍保存在本机", ok ? "success" : "error");
      refreshAccount();
      return;
    }

    const logoutButton = event.target.closest("[data-account-logout]");
    if (logoutButton) {
      event.preventDefault();
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
      paint(root);
    }
  };

  root.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("account:changed", onAccount);
    document.removeEventListener("sync:status", onSync);
    root.removeEventListener("click", onClick);
    root.innerHTML = "";
  };
}
