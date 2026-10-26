/**
 * Client account state and per-user cloud progress sync.
 *
 * Local-first: the app always writes to localStorage first. When a user is
 * logged in (built-in account or Cloudflare Access), progress is also synced
 * to Cloudflare D1 with a debounce, optimistic revision control and a
 * merge-on-conflict strategy.
 */

import {
  notifyShell,
  relativeTime,
  saveState,
  state,
  toast,
} from "./core.js";

export const OWNER_KEY = "crac_a_quiz_owner_v1";

const SYNC_DELAY = 1200;
const MAX_UPLOAD_BYTES = 1_500_000;
const encoder = new TextEncoder();

export const account = {
  available: false,
  user: null,
  provider: "",
  status: "guest",
  error: "",
  lastSyncedAt: 0,
  revision: 0,
};

let applyingRemote = false;
let initPromise = null;
let eventsBound = false;
let syncTimer = null;
let retryTimer = null;
let retryDelay = 5000;
let inFlight = null;
let pendingSync = false;
let lastSyncedJson = "";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return encoder.encode(value).length;
}

function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY) || "";
  } catch {
    return "";
  }
}

function writeOwner(userId) {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Local storage can be unavailable in private mode; sync still works.
  }
}

function removeOwner() {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // Ignore.
  }
}

export function emptyProgress() {
  return {
    wrong: {},
    records: [],
    analysis: {},
    mnemonicOverrides: {},
    activePractice: null,
    activeExam: null,
  };
}

export function normalizeProgress(value) {
  const source = isObject(value) ? value : {};
  return {
    wrong: isObject(source.wrong) ? source.wrong : {},
    records: Array.isArray(source.records)
      ? source.records.filter((record) => isObject(record) && record.id).slice(0, 120)
      : [],
    analysis: isObject(source.analysis) ? source.analysis : {},
    mnemonicOverrides: isObject(source.mnemonicOverrides) ? source.mnemonicOverrides : {},
    activePractice: isObject(source.activePractice) ? source.activePractice : null,
    activeExam: isObject(source.activeExam) ? source.activeExam : null,
  };
}

export function hasProgress(progress) {
  const value = normalizeProgress(progress);
  return Boolean(
    Object.keys(value.wrong).length ||
      value.records.length ||
      Object.keys(value.analysis).length ||
      Object.keys(value.mnemonicOverrides).length ||
      value.activePractice ||
      value.activeExam,
  );
}

function mergeRecords(localRecords = [], remoteRecords = []) {
  const byId = new Map();
  for (const record of [...remoteRecords, ...localRecords]) {
    if (!isObject(record) || !record.id) continue;
    const previous = byId.get(record.id);
    if (!previous || (Number(record.finishedAt) || 0) >= (Number(previous.finishedAt) || 0)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()]
    .sort((left, right) => (Number(right.finishedAt) || 0) - (Number(left.finishedAt) || 0))
    .slice(0, 120);
}

function mergeWrong(localWrong = {}, remoteWrong = {}) {
  const merged = {};
  const ids = new Set([...Object.keys(remoteWrong), ...Object.keys(localWrong)]);
  for (const id of ids) {
    const local = localWrong[id];
    const remote = remoteWrong[id];
    if (!isObject(local)) {
      if (isObject(remote)) merged[id] = remote;
      continue;
    }
    if (!isObject(remote)) {
      merged[id] = local;
      continue;
    }
    const newer = (Number(local.lastAt) || 0) >= (Number(remote.lastAt) || 0) ? local : remote;
    const firstAt = Math.min(
      Number(local.firstAt) || Number(newer.firstAt) || 0,
      Number(remote.firstAt) || Number(newer.firstAt) || 0,
    );
    merged[id] = firstAt ? { ...newer, firstAt } : newer;
  }
  return merged;
}

function mergeAnalysis(localAnalysis = {}, remoteAnalysis = {}) {
  const merged = { ...remoteAnalysis };
  for (const [id, entry] of Object.entries(localAnalysis)) {
    const existing = merged[id];
    if (!existing || (Number(entry?.updatedAt) || 0) >= (Number(existing?.updatedAt) || 0)) {
      merged[id] = entry;
    }
  }
  return merged;
}

function pickSession(localSession, remoteSession) {
  if (!localSession) return remoteSession || null;
  if (!remoteSession) return localSession;
  return (Number(remoteSession.startedAt) || 0) > (Number(localSession.startedAt) || 0)
    ? remoteSession
    : localSession;
}

export function mergeProgress(localValue, remoteValue) {
  const local = normalizeProgress(localValue);
  const remote = normalizeProgress(remoteValue);
  return {
    wrong: mergeWrong(local.wrong, remote.wrong),
    records: mergeRecords(local.records, remote.records),
    analysis: mergeAnalysis(local.analysis, remote.analysis),
    mnemonicOverrides: { ...remote.mnemonicOverrides, ...local.mnemonicOverrides },
    activePractice: pickSession(local.activePractice, remote.activePractice),
    activeExam: pickSession(local.activeExam, remote.activeExam),
  };
}

export function snapshotProgress() {
  return {
    wrong: state.wrong,
    records: state.records,
    analysis: state.analysis,
    mnemonicOverrides: state.mnemonicOverrides,
    activePractice: state.activePractice,
    activeExam: state.activeExam,
  };
}

function applyProgressToState(progress) {
  const normalized = normalizeProgress(progress);
  applyingRemote = true;
  try {
    state.wrong = normalized.wrong;
    state.records = normalized.records;
    state.analysis = normalized.analysis;
    state.mnemonicOverrides = normalized.mnemonicOverrides;
    state.activePractice = normalized.activePractice;
    state.activeExam = normalized.activeExam;
    saveState({ sync: false });
  } finally {
    applyingRemote = false;
  }
  notifyShell();
}

function clearProgressState() {
  applyingRemote = true;
  try {
    state.wrong = {};
    state.records = [];
    state.analysis = {};
    state.mnemonicOverrides = {};
    state.activePractice = null;
    state.activeExam = null;
    saveState({ sync: false });
  } finally {
    applyingRemote = false;
  }
  notifyShell();
}

function buildUploadProgress(progress) {
  const copy = normalizeProgress(progress);
  copy.wrong = { ...copy.wrong };
  copy.records = [...copy.records];
  copy.analysis = { ...copy.analysis };
  copy.mnemonicOverrides = { ...copy.mnemonicOverrides };

  let serialized = JSON.stringify(copy);
  while (byteLength(serialized) > MAX_UPLOAD_BYTES && copy.records.length > 5) {
    copy.records = copy.records.slice(0, Math.max(5, Math.floor(copy.records.length * 0.75)));
    serialized = JSON.stringify(copy);
  }

  if (byteLength(serialized) > MAX_UPLOAD_BYTES) {
    const analysisIds = Object.keys(copy.analysis).sort(
      (left, right) =>
        (Number(copy.analysis[left]?.updatedAt) || 0) -
        (Number(copy.analysis[right]?.updatedAt) || 0),
    );
    for (const id of analysisIds) {
      if (byteLength(serialized) <= MAX_UPLOAD_BYTES) break;
      delete copy.analysis[id];
      serialized = JSON.stringify(copy);
    }
  }

  return copy;
}

async function api(path, options = {}) {
  const { timeout = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      },
      signal: controller.signal,
    });
    let payload = null;
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    return { response, payload };
  } finally {
    window.clearTimeout(timer);
  }
}

function setStatus(status, error = "") {
  const changed = account.status !== status || account.error !== error;
  account.status = status;
  account.error = error;
  if (changed) {
    document.dispatchEvent(new CustomEvent("sync:status", { detail: { status, error } }));
  }
}

function emitAccountChanged() {
  document.dispatchEvent(new CustomEvent("account:changed"));
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (account.user) pushProgress({ quiet: true });
  }, retryDelay);
  retryDelay = Math.min(60_000, retryDelay * 2);
}

function scheduleSync(delay = SYNC_DELAY) {
  if (!account.user) return;
  if (inFlight) {
    pendingSync = true;
    return;
  }
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    pushProgress();
  }, delay);
}

function onStateChanged() {
  if (!account.user || applyingRemote) return;
  const payload = buildUploadProgress(snapshotProgress());
  if (JSON.stringify(payload) === lastSyncedJson) return;
  scheduleSync();
}

function handleExpired() {
  if (!account.user) return;
  window.clearTimeout(syncTimer);
  syncTimer = null;
  account.user = null;
  account.provider = "";
  account.revision = 0;
  account.lastSyncedAt = 0;
  setStatus("expired", "登录已过期，请重新登录");
  emitAccountChanged();
  toast("登录已过期，请重新登录以继续同步", "error");
}

async function pushProgress({ baseRevision = account.revision, progress = null, quiet = false } = {}) {
  if (!account.user) return false;
  if (inFlight) {
    pendingSync = true;
    return inFlight;
  }

  const initial = buildUploadProgress(progress || snapshotProgress());
  const initialJson = JSON.stringify(initial);
  if (initialJson === lastSyncedJson && baseRevision === account.revision) {
    setStatus("synced");
    return true;
  }

  const run = async () => {
    setStatus("syncing");
    let data = initial;
    let base = baseRevision;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { response, payload } = await api("/api/progress", {
          method: "PUT",
          body: JSON.stringify({ baseRevision: base, progress: data }),
          timeout: 25_000,
        });

        if (!account.user) return false;
        if (response.status === 401) {
          handleExpired();
          return false;
        }

        if (response.status === 409) {
          const merged = mergeProgress(snapshotProgress(), payload?.progress);
          applyProgressToState(merged);
          data = buildUploadProgress(merged);
          base = Number.isInteger(payload?.revision) ? payload.revision : 0;
          continue;
        }

        if (!response.ok) {
          const error = new Error(payload?.error || `同步失败（HTTP ${response.status}）`);
          error.status = response.status;
          throw error;
        }

        account.revision = Number.isInteger(payload?.revision) ? payload.revision : base + 1;
        account.lastSyncedAt = Number(payload?.updatedAt) || Date.now();
        writeOwner(account.user.id);
        lastSyncedJson = JSON.stringify(buildUploadProgress(snapshotProgress()));
        retryDelay = 5000;
        window.clearTimeout(retryTimer);
        retryTimer = null;
        setStatus("synced");
        return true;
      }
      throw new Error("同步冲突次数过多，请稍后重试");
    } catch (error) {
      if (!account.user) return false;
      const offline = navigator.onLine === false;
      const message = offline
        ? "网络已断开"
        : error?.name === "AbortError"
          ? "同步超时"
          : error?.message || "同步失败";
      setStatus(offline ? "offline" : "error", message);
      if (!quiet) console.warn("Progress sync failed:", error);
      if (!offline && error?.status !== 413) scheduleRetry();
      return false;
    } finally {
      if (account.user) {
        const currentJson = JSON.stringify(buildUploadProgress(snapshotProgress()));
        const retryable = account.status !== "error" && account.status !== "offline";
        if (pendingSync || (currentJson !== lastSyncedJson && retryable)) {
          pendingSync = false;
          scheduleSync(600);
        }
      }
    }
  };

  inFlight = run().finally(() => {
    inFlight = null;
    if (pendingSync) {
      pendingSync = false;
      scheduleSync(400);
    }
  });
  return inFlight;
}

export function syncNow() {
  window.clearTimeout(syncTimer);
  syncTimer = null;
  return pushProgress();
}

async function pullRemote() {
  setStatus("syncing");
  const { response, payload } = await api("/api/progress", { timeout: 20_000 });
  if (response.status === 401) {
    handleExpired();
    return;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `读取云端进度失败（HTTP ${response.status}）`);
  }

  const remote = payload?.progress ? normalizeProgress(payload.progress) : null;
  account.revision = Number.isInteger(payload?.revision) ? payload.revision : 0;
  account.lastSyncedAt = Number(payload?.updatedAt) || 0;

  const owner = readOwner();
  const local = snapshotProgress();
  const differentOwner = Boolean(owner && account.user && owner !== account.user.id);
  const merged = differentOwner
    ? remote || emptyProgress()
    : mergeProgress(local, remote);

  applyProgressToState(merged);
  writeOwner(account.user.id);

  const remoteJson = JSON.stringify(remote || emptyProgress());
  const mergedJson = JSON.stringify(merged);
  lastSyncedJson = remoteJson;
  setStatus("synced");

  if (!differentOwner && mergedJson !== remoteJson && hasProgress(merged)) {
    await pushProgress({ baseRevision: account.revision, progress: merged, quiet: true });
  } else {
    lastSyncedJson = JSON.stringify(buildUploadProgress(snapshotProgress()));
  }
}

async function authenticate(path, payload) {
  const { response, payload: body } = await api(path, {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 25_000,
  });
  if (!response.ok) {
    throw new Error(body?.error || `请求失败（HTTP ${response.status}）`);
  }
  if (!body?.user) throw new Error("账号服务返回了空用户信息");

  account.available = true;
  account.user = body.user;
  account.provider = body.provider || "password";
  account.revision = 0;
  account.lastSyncedAt = 0;
  retryDelay = 5000;
  setStatus("syncing");
  emitAccountChanged();

  try {
    await pullRemote();
  } catch (error) {
    setStatus(navigator.onLine === false ? "offline" : "error", error.message || "同步失败");
  }
  emitAccountChanged();
  return account.user;
}

export function loginAccount(email, password) {
  return authenticate("/api/auth/login", { email, password });
}

export function registerAccount(email, password, name) {
  return authenticate("/api/auth/register", { email, password, name });
}

export async function logoutAccount() {
  let logoutUrl = "";
  try {
    const { payload } = await api("/api/auth/logout", { method: "POST", timeout: 10_000 });
    logoutUrl = payload?.logoutUrl || "";
  } catch {
    // Clear the local session state even if the network request fails.
  }

  window.clearTimeout(syncTimer);
  window.clearTimeout(retryTimer);
  syncTimer = null;
  retryTimer = null;
  pendingSync = false;
  lastSyncedJson = "";
  retryDelay = 5000;
  account.user = null;
  account.provider = "";
  account.revision = 0;
  account.lastSyncedAt = 0;
  account.error = "";
  clearProgressState();
  removeOwner();
  setStatus("guest");
  emitAccountChanged();

  if (logoutUrl) window.location.assign(logoutUrl);
}

function bindAccountEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener("state:changed", onStateChanged);
  window.addEventListener("online", () => {
    if (account.user) {
      if (account.status === "offline" || account.status === "error") {
        syncNow();
      }
      return;
    }
    if (!account.available) retryAccount();
  });
  window.addEventListener("offline", () => {
    if (account.user) setStatus("offline", "网络已断开");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && account.user && account.status === "error") {
      syncNow();
    }
  });
}

export function retryAccount() {
  if (account.user) return syncNow();
  initPromise = null;
  return initAccount();
}

export function initAccount() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    bindAccountEvents();
    try {
      const { response, payload } = await api("/api/auth/me", { timeout: 10_000 });
      if (response.status === 401) {
        account.available = true;
        setStatus("guest");
        return account;
      }
      if (response.status === 404 || response.status === 503) {
        account.available = false;
        setStatus("disabled", payload?.error || "当前部署未启用云端账号服务");
        return account;
      }
      if (!response.ok) {
        throw new Error(payload?.error || `账号服务不可用（HTTP ${response.status}）`);
      }
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, "user")) {
        account.available = false;
        setStatus("disabled", "当前部署未启用云端账号服务");
        return account;
      }

      account.available = true;
      account.user = payload?.user || null;
      account.provider = payload?.provider || "password";
      if (!account.user) {
        setStatus("guest");
        return account;
      }

      emitAccountChanged();
      await pullRemote();
      emitAccountChanged();
    } catch (error) {
      if (!account.user) account.available = false;
      setStatus(
        navigator.onLine === false ? "offline" : "error",
        error?.name === "AbortError" ? "连接账号服务超时" : error?.message || "无法连接账号服务",
      );
    }
    return account;
  })();
  return initPromise;
}

export function accountInitial(name = "") {
  const source = String(name || account.user?.name || account.user?.email || "?").trim();
  return source ? source.charAt(0).toUpperCase() : "?";
}

export function providerLabel() {
  if (account.provider === "access") return "站点单点登录";
  if (account.provider === "password") return "邮箱账号";
  return "";
}

export function syncStatusText() {
  if (!account.available) {
    if (account.status === "offline") return "无法连接账号服务";
    if (account.status === "disabled") return "云端同步未启用";
    return "账号服务不可用";
  }
  if (!account.user) {
    return account.status === "expired" ? "登录已过期，请重新登录" : "未登录 · 仅保存本地";
  }
  if (account.status === "syncing") return "正在同步进度…";
  if (account.status === "error") return "同步失败，已保存本地";
  if (account.status === "offline") return "离线 · 进度稍后同步";
  if (account.lastSyncedAt) return `已同步 · ${relativeTime(account.lastSyncedAt)}`;
  return "已登录 · 云端暂无进度";
}

export function syncStatusTone() {
  if (!account.available) return "muted";
  if (!account.user) return account.status === "expired" ? "error" : "muted";
  if (account.status === "synced") return "ok";
  if (account.status === "syncing") return "syncing";
  return "error";
}
