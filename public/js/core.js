/* Core utilities: state, storage, formatting, icons, overlays and DeepSeek API. */

export const STORAGE_KEY = "crac_a_quiz_v1";
export const APP_VERSION = "1.1.0";
export const STATE_VERSION = 2;

export const DEFAULT_SETTINGS = {
  theme: "system",
  apiKey: "",
  model: "deepseek-flash",
  baseUrl: "https://api.deepseek.com",
  exam: {
    count: 40,
    duration: 25,
    passPercent: 75,
  },
};

export const runtime = {
  dataVersion: "",
};

export function createDefaultState() {
  return {
    version: STATE_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    wrong: {},
    records: [],
    analysis: {},
    mnemonicOverrides: {},
    activePractice: null,
    activeExam: null,
  };
}

export let state = createDefaultState();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeState(raw) {
  const base = createDefaultState();
  if (!isObject(raw)) return base;
  const settings = isObject(raw.settings) ? raw.settings : {};
  const exam = isObject(settings.exam) ? settings.exam : {};
  const legacy = Number(raw.version || 0) < STATE_VERSION;

  const mergedExam = { ...base.settings.exam, ...exam };
  // Version 1 shipped with the wrong mock-exam defaults. Migrate only that
  // exact legacy pair, while preserving any custom duration the user chose.
  if (legacy && mergedExam.count === 30 && mergedExam.passPercent === 80) {
    mergedExam.count = base.settings.exam.count;
    mergedExam.passPercent = base.settings.exam.passPercent;
  }

  let activeExam = isObject(raw.activeExam) ? raw.activeExam : null;
  if (
    legacy &&
    activeExam?.config?.count === 30 &&
    activeExam?.config?.passPercent === 80
  ) {
    activeExam = null;
  }

  return {
    ...base,
    version: STATE_VERSION,
    settings: {
      ...base.settings,
      ...settings,
      model:
        !settings.model || settings.model === "deepseek-chat"
          ? base.settings.model
          : settings.model,
      exam: mergedExam,
    },
    wrong: isObject(raw.wrong) ? raw.wrong : {},
    records: Array.isArray(raw.records)
      ? raw.records.filter((record) => isObject(record) && record.id).slice(0, 120)
      : [],
    analysis: isObject(raw.analysis) ? raw.analysis : {},
    mnemonicOverrides: isObject(raw.mnemonicOverrides) ? raw.mnemonicOverrides : {},
    activePractice: isObject(raw.activePractice) ? raw.activePractice : null,
    activeExam,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw);
    const previousVersion = Number(parsed.version || 0);
    state = normalizeState(parsed);
    if (previousVersion < STATE_VERSION) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // The in-memory state is still migrated for this session.
      }
    }
  } catch (error) {
    console.warn("Failed to load saved state", error);
    state = createDefaultState();
  }
  return state;
}

function pruneState() {
  if (state.records.length > 90) state.records.length = 90;
  const analysisIds = Object.keys(state.analysis);
  if (analysisIds.length > 90) {
    analysisIds
      .sort((a, b) => (state.analysis[a]?.updatedAt || 0) - (state.analysis[b]?.updatedAt || 0))
      .slice(0, analysisIds.length - 90)
      .forEach((id) => delete state.analysis[id]);
  }
}

export function saveState({ sync = true } = {}) {
  pruneState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Storage full, pruning older records", error);
    state.records = state.records.slice(0, 25);
    const analysisIds = Object.keys(state.analysis);
    analysisIds
      .sort((a, b) => (state.analysis[a]?.updatedAt || 0) - (state.analysis[b]?.updatedAt || 0))
      .slice(0, Math.max(0, analysisIds.length - 25))
      .forEach((id) => delete state.analysis[id]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (retryError) {
      console.error("Failed to save state", retryError);
      toast("本地存储空间不足，部分旧记录未能保存", "error");
    }
  }
  if (sync) {
    document.dispatchEvent(new CustomEvent("state:changed"));
  }
}

export function resetProgress() {
  state.wrong = {};
  state.records = [];
  state.analysis = {};
  state.activePractice = null;
  state.activeExam = null;
  saveState();
}

export function notifyShell() {
  document.dispatchEvent(new CustomEvent("shell:refresh"));
}

/* ---------- Theme ---------- */

let systemThemeQuery = null;

export function initTheme() {
  systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (state.settings.theme === "system") applyTheme();
  };
  if (systemThemeQuery.addEventListener) {
    systemThemeQuery.addEventListener("change", onChange);
  }
  applyTheme();
}

export function resolvedTheme() {
  if (state.settings.theme === "system") {
    return systemThemeQuery?.matches ? "dark" : "light";
  }
  return state.settings.theme === "dark" ? "dark" : "light";
}

export function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#08111f" : "#f5f7fb";
  const button = document.getElementById("theme-toggle");
  if (button) {
    button.innerHTML = icon(theme === "dark" ? "sun" : "moon", 19);
    button.setAttribute("aria-label", theme === "dark" ? "切换到浅色模式" : "切换到深色模式");
  }
}

export function toggleTheme() {
  state.settings.theme = resolvedTheme() === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
  notifyShell();
}

export function setTheme(theme) {
  state.settings.theme = ["light", "dark", "system"].includes(theme) ? theme : "system";
  saveState();
  applyTheme();
  notifyShell();
}

/* ---------- Formatting ---------- */

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export function formatDateTime(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatFullDate(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value} 秒`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatClock(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function relativeTime(timestamp) {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(timestamp);
}

export function dateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/* ---------- Collections ---------- */

export function shuffle(input) {
  const array = [...input];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [array[index], array[target]] = [array[target], array[index]];
  }
  return array;
}

export function sample(input, count) {
  return shuffle(input).slice(0, Math.max(0, count));
}

export function unique(input) {
  return [...new Set(input)];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sameAnswer(a = [], b = []) {
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function answerLabel(answer = [], empty = "未作答") {
  return answer.length ? [...answer].sort().join("、") : empty;
}

export function debounce(fn, wait = 220) {
  let timer = null;
  const debounced = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => window.clearTimeout(timer);
  return debounced;
}

export function percent(value, digits = 0) {
  const number = Number(value) || 0;
  return `${number.toFixed(digits)}%`;
}

/* ---------- Icons ---------- */

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  practice:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  exam:
    '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2h6v2"/><path d="m9 12 2 2 4-4"/>',
  wrong:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="m9 8 6 6"/><path d="m15 8-6 6"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  library:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flame:
    '<path d="M12 22c4.4 0 7-2.8 7-6.5 0-2.4-1.2-4.4-3.5-6.5-.5 1.7-1.4 2.8-2.6 3.4.2-3.7-1.3-6.6-4.3-8.9.1 3.1-1 5.3-2.6 7.3A8.5 8.5 0 0 0 5 15.5C5 19.2 7.6 22 12 22Z"/>',
  sparkles:
    '<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z"/><path d="M5 16v4"/><path d="M3 18h4"/><path d="M19 3v3"/><path d="M17.5 4.5h3"/>',
  brain:
    '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5v.6A3.5 3.5 0 0 0 4 10.5c0 1.3.7 2.4 1.8 3A3.5 3.5 0 0 0 8 19.5c.6 0 1.2-.2 1.7-.5"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5v.6a3.5 3.5 0 0 1 2 3.4c0 1.3-.7 2.4-1.8 3a3.5 3.5 0 0 1-2.2 6c-.6 0-1.2-.2-1.7-.5"/><path d="M12 4v16"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  rotate:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  download:
    '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload:
    '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 21h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff:
    '<path d="m3 3 18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.4 3.2"/><path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  trophy:
    '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4v2a4 4 0 0 0 4 4"/><path d="M17 6h3v2a4 4 0 0 1-4 4"/>',
  alert: '<path d="m12 3 9 17H3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  layers:
    '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
  tag: '<path d="M20 12 12 20l-9-9V3h8Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  radio:
    '<circle cx="12" cy="12" r="2"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 10h18"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cloud: '<path d="M17.5 19H6a4 4 0 0 1-.6-7.96A6 6 0 0 1 17 9.5a4.75 4.75 0 0 1 .5 9.5Z"/>',
  cloudOff:
    '<path d="m2 2 20 20"/><path d="M5.8 5.8A6 6 0 0 0 5.4 11 4 4 0 0 0 6 19h11.5a4.75 4.75 0 0 0 2.2-.54"/><path d="M10.5 5.3A6 6 0 0 1 17 9.5a4.75 4.75 0 0 1 2.2 8.95"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  scale:
    '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M6 7h12"/><path d="m6 7-3 7h6Z"/><path d="m18 7-3 7h6Z"/>',
  antenna:
    '<path d="M12 21V9"/><path d="m8 21 4-4 4 4"/><path d="M7 9a5 5 0 0 1 10 0"/><path d="M4.5 6.5a9 9 0 0 1 15 0"/><circle cx="12" cy="9" r="1"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  shield:
    '<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  compass:
    '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  signal:
    '<path d="M4 20v-4"/><path d="M9 20v-8"/><path d="M14 20V8"/><path d="M19 20V4"/>',
};

export function icon(name, size = 20, className = "") {
  const paths = ICON_PATHS[name] || ICON_PATHS.info;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/* ---------- Toasts ---------- */

export function toast(message, type = "info", duration = 3200) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  const iconName = type === "success" ? "check" : type === "error" ? "alert" : "info";
  item.innerHTML = `${icon(iconName, 18)}<span>${escapeHtml(message)}</span>`;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add("is-visible"));
  window.setTimeout(() => {
    item.classList.remove("is-visible");
    window.setTimeout(() => item.remove(), 240);
  }, duration);
}

/* ---------- Overlays and dialogs ---------- */

function syncBodyLock() {
  const root = document.getElementById("overlay-root");
  const hasOverlay = root && root.childElementCount > 0;
  document.body.classList.toggle("overlay-open", Boolean(hasOverlay));
}

export function closeAllOverlays() {
  const root = document.getElementById("overlay-root");
  if (!root) return;
  root.querySelectorAll(".modal-backdrop, .analysis-layer").forEach((layer) => layer.remove());
  syncBodyLock();
}

export function openModal({ title, body, footer = "", className = "", onClose = null }) {
  const root = document.getElementById("overlay-root");
  if (!root) return { close: () => {} };

  const existing = root.querySelector(".modal-backdrop");
  if (existing) existing.remove();

  const wrapper = document.createElement("div");
  wrapper.className = "modal-backdrop";
  wrapper.innerHTML = `
    <section class="modal ${className}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn" data-modal-close aria-label="关闭">${icon("x", 19)}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}
    </section>`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrapper.classList.add("is-closing");
    window.setTimeout(() => {
      wrapper.remove();
      syncBodyLock();
      onClose?.();
    }, 160);
  };

  wrapper.addEventListener("click", (event) => {
    if (event.target === wrapper) close();
    if (event.target.closest("[data-modal-close]")) close();
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  });

  root.appendChild(wrapper);
  syncBodyLock();
  requestAnimationFrame(() => {
    wrapper.classList.add("is-visible");
    const focusTarget = wrapper.querySelector("[data-autofocus]") || wrapper.querySelector("button");
    focusTarget?.focus({ preventScroll: true });
  });

  return { el: wrapper, close };
}

export function confirmDialog({
  title = "请确认",
  message = "",
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      className: "modal-confirm",
      body: `<p class="modal-text">${message}</p>`,
      footer: `
        <button type="button" class="btn btn-secondary" data-cancel>${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm data-autofocus>${escapeHtml(confirmText)}</button>`,
      onClose: () => finish(false),
    });
    modal.el.querySelector("[data-confirm]").addEventListener("click", () => {
      finish(true);
      modal.close();
    });
    modal.el.querySelector("[data-cancel]").addEventListener("click", () => {
      finish(false);
      modal.close();
    });
  });
}

export function openLightbox(src, caption = "") {
  const modal = openModal({
    title: "题目配图",
    className: "modal-image",
    body: `<figure class="lightbox-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption || "题目配图")}" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`,
  });
  return modal;
}

/* ---------- Files ---------- */

export function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板", "success");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败，请手动选择文本", "error");
    }
    textarea.remove();
  }
}

/* ---------- AI connectivity ---------- */

export function aiReady() {
  return Boolean(state.settings.apiKey);
}

export function aiConfigSummary() {
  if (!aiReady()) return "AI 未配置";
  return `DeepSeek · ${state.settings.model}`;
}


function apiHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (state.settings.apiKey) headers["x-deepseek-key"] = state.settings.apiKey;
  return headers;
}

export async function chatRequest({ messages, model, stream = false, signal, maxTokens = 1200 }) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      messages,
      model: model || state.settings.model,
      baseUrl: state.settings.baseUrl,
      stream,
      max_tokens: maxTokens,
    }),
    signal,
  });

  if (!response.ok) {
    let message = `DeepSeek 请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }
  return response;
}

export async function streamChat({ messages, model, signal, onDelta, maxTokens = 1500 }) {
  const response = await chatRequest({ messages, model, stream: true, signal, maxTokens });
  if (!response.body) throw new Error("浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.match(/\r?\n\r?\n/);
    while (boundary && boundary.index !== undefined) {
      const eventText = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      for (const line of eventText.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          finished = true;
          break;
        }
        try {
          const data = JSON.parse(payload);
          if (data?.error) throw new Error(data.error.message || data.error);
          const delta = data?.choices?.[0]?.delta?.content || "";
          if (delta) onDelta?.(delta);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
      if (finished) break;
      boundary = buffer.match(/\r?\n\r?\n/);
    }
  }
}

export function getCachedAnalysis(questionId, model = state.settings.model) {
  const cached = state.analysis[questionId];
  if (!cached || cached.version !== runtime.dataVersion) return null;
  if (cached.model && model && cached.model !== model) return null;
  return cached;
}

export function cacheAnalysis(questionId, text, model) {
  state.analysis[questionId] = {
    text,
    model,
    version: runtime.dataVersion,
    updatedAt: Date.now(),
  };
  const ids = Object.keys(state.analysis);
  if (ids.length > 90) {
    ids
      .sort((a, b) => (state.analysis[a]?.updatedAt || 0) - (state.analysis[b]?.updatedAt || 0))
      .slice(0, ids.length - 90)
      .forEach((id) => delete state.analysis[id]);
  }
  saveState();
}

export async function testConnection() {
  return chatRequest({
    messages: [
      { role: "system", content: "你是一个连接测试助手。" },
      { role: "user", content: "请只回复四个字：连接成功" },
    ],
    stream: false,
    maxTokens: 20,
  }).then(async (response) => {
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    if (!content) throw new Error("DeepSeek 返回内容为空");
    return content.trim();
  });
}
