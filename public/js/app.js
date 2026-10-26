/* App shell, hash router and boot sequence. */

import {
  aiReady,
  closeAllOverlays,
  icon,
  initTheme,
  loadState,
  openLightbox,
  state,
  toggleTheme,
} from "./core.js";
import {
  data,
  getRecord,
  getWrongCount,
  loadQuestionData,
} from "./data.js";
import {
  closeAnalysis,
  openAnalysis,
} from "./components.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderPractice } from "./views/practice.js";
import { renderExam } from "./views/exam.js";
import { renderWrong } from "./views/wrong.js";
import { renderRecords } from "./views/records.js";
import { renderBank } from "./views/bank.js";
import { renderResult } from "./views/result.js";
import { renderSettings } from "./views/settings.js";

const PAGE_META = {
  dashboard: ["首页", "按自己的节奏，稳步通过 A 类验证"],
  practice: ["分类练习", "按题型、题量、分类和知识点自由组合"],
  exam: ["模拟考试", "限时抽题，交卷后查看成绩与逐题解析"],
  wrong: ["错题本", "集中攻克答错的题目，逐个移出"],
  records: ["练习记录", "查看历史成绩、用时与逐题回顾"],
  bank: ["题库浏览", "搜索与筛选 683 道 A 类题目"],
  settings: ["设置", "DeepSeek、考试默认值与本地数据"],
  result: ["练习结果", "逐题回顾与 AI 深度解析"],
};

let cleanup = null;
let dataReady = false;

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "/dashboard";
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const root = segments[0] || "dashboard";
  const params = new URLSearchParams(queryPart || "");
  if (root === "result" && segments[1]) {
    return { name: "result", id: decodeURIComponent(segments[1]), params };
  }
  if (root === "records" && segments[1]) {
    return { name: "result", id: decodeURIComponent(segments[1]), params };
  }
  const known = new Set([
    "dashboard",
    "practice",
    "exam",
    "wrong",
    "records",
    "bank",
    "settings",
  ]);
  return { name: known.has(root) ? root : "dashboard", params };
}

function fillShellIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => {
    const size = node.classList.contains("brand-mark") ? 25 : 20;
    node.innerHTML = icon(node.dataset.icon, size);
  });
}

function updateAiShell() {
  const ready = aiReady();
  const text = ready ? "AI 已配置" : "AI 未配置";
  const pillText = document.getElementById("ai-pill-text");
  const sidebarTitle = document.getElementById("sidebar-ai-title");
  if (pillText) pillText.textContent = text;
  if (sidebarTitle) sidebarTitle.textContent = text;
  [document.getElementById("ai-pill"), document.getElementById("sidebar-ai-card")].forEach(
    (node) => {
      if (!node) return;
      node.classList.toggle("is-ready", ready);
    },
  );
  [document.getElementById("ai-pill-dot"), document.getElementById("sidebar-ai-dot")].forEach(
    (node) => {
      if (!node) return;
      node.classList.toggle("is-ready", ready);
    },
  );
}

function updateShell(route = parseRoute()) {
  updateAiShell();
  const wrongCount = getWrongCount();
  const navBadge = document.getElementById("nav-wrong-badge");
  const mobileBadge = document.getElementById("mobile-wrong-badge");
  [navBadge, mobileBadge].forEach((node) => {
    if (!node) return;
    node.textContent = String(wrongCount);
    node.hidden = wrongCount === 0;
  });
  document.querySelectorAll("[data-session-dot]").forEach((node) => {
    const active =
      node.dataset.sessionDot === "practice"
        ? Boolean(state.activePractice)
        : Boolean(state.activeExam);
    node.hidden = !active;
  });
  const questionCount = document.getElementById("sidebar-question-count");
  if (questionCount && data.meta) questionCount.textContent = String(data.meta.total);

  const record = route.name === "result" ? getRecord(route.id) : null;
  const sidebarRoute = route.name === "result" ? "records" : route.name;
  const mobileRoute =
    route.name === "result" ? (record?.kind === "exam" ? "exam" : "practice") : route.name;
  document.querySelectorAll("[data-route]").forEach((node) => {
    const target = node.classList.contains("mobile-nav-link") ? mobileRoute : sidebarRoute;
    node.classList.toggle("is-active", node.dataset.route === target);
  });
  const historyLink = document.querySelector(".topbar-history");
  if (historyLink) {
    historyLink.classList.toggle("is-active", route.name === "records" || route.name === "result");
  }
  const settingsLink = document.querySelector(".topbar-settings");
  if (settingsLink) settingsLink.classList.toggle("is-active", route.name === "settings");

  const meta = PAGE_META[route.name] || PAGE_META.dashboard;
  const title = route.name === "result" && record ? (record.kind === "exam" ? "考试结果" : "练习结果") : meta[0];
  const subtitle =
    route.name === "result" && record
      ? `${record.label} · ${record.correct}/${record.total} 题`
      : meta[1];
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  if (pageTitle) pageTitle.textContent = title;
  if (pageSubtitle) pageSubtitle.textContent = subtitle;
  document.title = `${title} · A 类题库`;
}

function renderBootError(error) {
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = `
    <div class="page">
      <div class="fatal-card">
        <div class="fatal-icon">${icon("alert", 30)}</div>
        <h2>题库加载失败</h2>
        <p>${String(error?.message || error || "未知错误")}</p>
        <div class="fatal-help">
          <strong>检查这几步：</strong>
          <ol>
            <li>确认本地服务正在运行：在项目目录执行 <code>npm start</code>。</li>
            <li>确认 <code>data/questions.json</code> 存在且格式正确。</li>
            <li>重新生成题库：<code>python3 scripts/pdf_to_json.py</code>。</li>
          </ol>
        </div>
        <button type="button" class="btn btn-primary" data-reload>重新加载</button>
      </div>
    </div>`;
}

async function renderRoute() {
  if (!dataReady) return;
  const route = parseRoute();
  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      console.warn("View cleanup failed", error);
    }
    cleanup = null;
  }
  closeAnalysis();
  closeAllOverlays();
  const view = document.getElementById("view");
  if (!view) return;
  view.innerHTML = "";
  try {
    if (route.name === "dashboard") cleanup = renderDashboard(view);
    else if (route.name === "practice") cleanup = renderPractice(view);
    else if (route.name === "exam") cleanup = renderExam(view);
    else if (route.name === "wrong") cleanup = renderWrong(view);
    else if (route.name === "records") cleanup = renderRecords(view);
    else if (route.name === "bank") cleanup = renderBank(view, route.params);
    else if (route.name === "result") cleanup = renderResult(view, route.id);
    else if (route.name === "settings") cleanup = renderSettings(view);
    else cleanup = renderDashboard(view);
    updateShell(route);
    window.scrollTo({ top: 0, behavior: "instant" });
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
  } catch (error) {
    console.error(error);
    renderBootError(error);
  }
}

function bindGlobalEvents() {
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.addEventListener("shell:refresh", () => updateShell());

  document.addEventListener("click", (event) => {
    const analyze = event.target.closest("[data-analyze]");
    if (analyze) {
      event.preventDefault();
      openAnalysis(analyze.dataset.analyze);
      return;
    }
    const lightbox = event.target.closest("[data-lightbox]");
    if (lightbox) {
      event.preventDefault();
      openLightbox(lightbox.dataset.lightbox, lightbox.dataset.caption || "");
      return;
    }
    if (event.target.closest("[data-reload]")) {
      window.location.reload();
    }
  });

  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("focus", () => {
    if (state.activeExam) updateShell();
  });
}

async function boot() {
  loadState();
  initTheme();
  fillShellIcons();
  bindGlobalEvents();
  updateShell();
  try {
    await loadQuestionData();
    dataReady = true;
    updateShell();
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/dashboard");
    }
    await renderRoute();
  } catch (error) {
    console.error(error);
    renderBootError(error);
  }
}

boot();
