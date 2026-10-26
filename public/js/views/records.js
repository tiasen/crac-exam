/* Practice and exam history. */

import {
  confirmDialog,
  escapeHtml,
  formatDateTime,
  formatDuration,
  icon,
  percent,
  state,
  toast,
} from "../core.js";
import {
  clearRecords,
  deleteRecord,
  getStats,
  recordStatusText,
  recordTagSummary,
} from "../data.js";
import { emptyState, statTile } from "../components.js";

let kindFilter = "all";

function filteredRecords() {
  if (kindFilter === "all") return state.records;
  return state.records.filter((record) => record.kind === kindFilter);
}

function recordCardHTML(record) {
  const isExam = record.kind === "exam";
  const tags = recordTagSummary(record);
  return `
    <article class="record-card card">
      <a class="record-card-main" href="#/result/${record.id}">
        <span class="record-card-icon ${isExam ? "tone-amber" : "tone-blue"}">${icon(isExam ? "exam" : "practice", 21)}</span>
        <span class="record-card-body">
          <span class="record-card-title">
            <strong>${escapeHtml(record.label)}</strong>
            ${isExam ? `<span class="badge ${record.passed ? "badge-pass" : "badge-fail"}">${record.passed ? "合格" : "未合格"}</span>` : ""}
          </span>
          <span class="record-card-meta">
            <span>${icon("calendar", 14)} ${formatDateTime(record.finishedAt)}</span>
            <span>${icon("clock", 14)} ${formatDuration(record.durationSec)}</span>
            <span>${icon("check", 14)} ${record.correct}/${record.total} 题</span>
          </span>
          ${tags.length ? `<span class="record-card-tags">${tags.map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}</span>` : ""}
        </span>
        <span class="record-card-score">
          <strong>${Math.round(record.accuracy)}<small>${isExam ? "分" : "%"}</small></strong>
          <span>${recordStatusText(record)}</span>
        </span>
        <span class="record-card-chevron">${icon("chevronRight", 18)}</span>
      </a>
      <button type="button" class="icon-btn record-delete" data-delete="${record.id}" aria-label="删除这条记录">
        ${icon("trash", 17)}
      </button>
    </article>`;
}

function recordsBody() {
  const records = filteredRecords();
  if (!records.length) {
    return emptyState({
      iconName: "history",
      title: kindFilter === "all" ? "还没有练习记录" : kindFilter === "exam" ? "还没有模拟考试记录" : "还没有练习记录",
      description: "每次完成练习或交卷后，成绩、用时和答题详情都会保存在这里。",
      action: `<a class="btn btn-primary btn-sm" href="#/${kindFilter === "exam" ? "exam" : "practice"}">${kindFilter === "exam" ? "去模拟考试" : "开始练习"} ${icon("arrowRight", 15)}</a>`,
    });
  }
  return records.map(recordCardHTML).join("");
}

function statsStrip() {
  const stats = getStats();
  const practiceCount = state.records.filter((record) => record.kind === "practice").length;
  const examCount = state.records.filter((record) => record.kind === "exam").length;
  return `
    <section class="stats-grid stats-grid-4">
      ${statTile({ iconName: "history", label: "学习次数", value: `${state.records.length}<small> 次</small>`, hint: `${practiceCount} 次练习 · ${examCount} 次考试`, tone: "blue" })}
      ${statTile({ iconName: "check", label: "累计作答", value: `${stats.totalAnswered}<small> 次</small>`, hint: `累计正确率 ${percent(stats.accuracy)}`, tone: "teal" })}
      ${statTile({ iconName: "target", label: "做对题目", value: `${stats.totalCorrect}<small> 次</small>`, hint: "按作答次数统计", tone: "violet" })}
      ${statTile({ iconName: "trophy", label: "考试合格率", value: `${Math.round(stats.examPassRate)}<small>%</small>`, hint: `${stats.passedExams}/${stats.examCount} 次合格`, tone: "amber" })}
    </section>`;
}

function paint(root) {
  const records = filteredRecords();
  const practiceCount = state.records.filter((record) => record.kind === "practice").length;
  const examCount = state.records.filter((record) => record.kind === "exam").length;
  root.innerHTML = `
    <div class="page records-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">History</span>
          <h2>练习记录</h2>
          <p>练习、模拟考试的每次成绩都在本地保存。点击任意记录可查看逐题作答与解析。</p>
        </div>
        ${state.records.length ? `<button type="button" class="btn btn-ghost btn-md" data-clear-records>${icon("trash", 16)} 清空记录</button>` : ""}
      </header>

      ${statsStrip()}

      <section class="card filter-card records-filter">
        <div class="filter-top">
          <div class="tabs" role="tablist" aria-label="记录类型">
            <button type="button" class="tab ${kindFilter === "all" ? "is-active" : ""}" data-kind="all">全部 <b>${state.records.length}</b></button>
            <button type="button" class="tab ${kindFilter === "practice" ? "is-active" : ""}" data-kind="practice">练习 <b>${practiceCount}</b></button>
            <button type="button" class="tab ${kindFilter === "exam" ? "is-active" : ""}" data-kind="exam">模拟考试 <b>${examCount}</b></button>
          </div>
          <span class="filter-count">共 ${records.length} 条</span>
        </div>
      </section>

      <div class="records-list">${recordsBody()}</div>
    </div>`;

  root.querySelectorAll("[data-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      kindFilter = button.dataset.kind;
      paint(root);
    });
  });

  root.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const confirmed = await confirmDialog({
        title: "删除这条记录？",
        message: "记录删除后无法恢复，错题本中的题目不会受到影响。",
        confirmText: "删除记录",
        danger: true,
      });
      if (!confirmed) return;
      deleteRecord(button.dataset.delete);
      toast("记录已删除", "success");
      paint(root);
    });
  });

  const clearButton = root.querySelector("[data-clear-records]");
  clearButton?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "清空全部记录？",
      message: "所有练习和考试记录将被删除，此操作无法撤销。错题本不会被清空。",
      confirmText: "清空记录",
      danger: true,
    });
    if (!confirmed) return;
    clearRecords();
    toast("练习记录已清空", "success");
    paint(root);
  });
}

export function renderRecords(root) {
  paint(root);
  return () => {
    root.innerHTML = "";
  };
}
