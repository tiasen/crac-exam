/* Result / record detail page with per-question review. */

import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  icon,
  percent,
  toast,
} from "../core.js";
import {
  getCategory,
  getQuestion,
  getRecord,
  recordTagSummary,
} from "../data.js";
import {
  emptyState,
  progressBar,
  questionCardHTML,
  scoreRing,
  statTile,
  categoryIcon,
} from "../components.js";
import { startPracticeWithIds } from "./practice.js";

function reviewCardHTML(record, questionId, index) {
  const question = getQuestion(questionId);
  if (!question) return "";
  const result = record.results?.[questionId] || { answer: [], correct: false, attempted: false };
  return questionCardHTML(question, {
    number: index + 1,
    selected: result.answer || [],
    review: true,
    showMnemonic: true,
    showAnalyze: true,
    className: "review-question",
  });
}

function categoryBreakdown(record) {
  const map = new Map();
  for (const questionId of record.questionIds) {
    const question = getQuestion(questionId);
    if (!question) continue;
    if (!map.has(question.categoryId)) {
      map.set(question.categoryId, { total: 0, correct: 0, attempted: 0 });
    }
    const entry = map.get(question.categoryId);
    const result = record.results?.[questionId];
    entry.total += 1;
    if (result?.attempted) entry.attempted += 1;
    if (result?.correct) entry.correct += 1;
  }
  return [...map.entries()]
    .map(([categoryId, entry]) => ({
      categoryId,
      category: getCategory(categoryId),
      ...entry,
      accuracy: entry.total ? (entry.correct / entry.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function renderResult(root, recordId) {
  const record = getRecord(recordId);
  if (!record) {
    root.innerHTML = `
      <div class="page">
        ${emptyState({
          iconName: "history",
          title: "没有找到这条记录",
          description: "记录可能已被删除，或链接不完整。",
          action: `<a class="btn btn-primary btn-sm" href="#/records">查看练习记录 ${icon("arrowRight", 15)}</a>`,
        })}
      </div>`;
    return () => {
      root.innerHTML = "";
    };
  }

  const isExam = record.kind === "exam";
  const wrongIds = record.questionIds.filter((questionId) => !record.results?.[questionId]?.correct);
  const correctIds = record.questionIds.filter((questionId) => record.results?.[questionId]?.correct);
  const unanswered = record.questionIds.filter((questionId) => !record.results?.[questionId]?.attempted);
  const answered = record.questionIds.length - unanswered.length;
  const score = Math.round(record.accuracy * 10) / 10;
  const passed = record.passed === true;
  const tone = isExam ? (passed ? "success" : "danger") : record.accuracy >= 80 ? "success" : "primary";
  const categories = categoryBreakdown(record);
  const tags = recordTagSummary(record);

  root.innerHTML = `
    <div class="page result-page">
      <header class="page-head result-page-head">
        <div>
          <a class="back-link" href="#/records">${icon("arrowLeft", 15)} 返回练习记录</a>
          <span class="section-kicker">${isExam ? "Exam result" : "Practice result"}</span>
          <h2>${isExam ? "模拟考试结果" : "练习结果"}</h2>
          <p>${formatDateTime(record.finishedAt)} · ${escapeHtml(record.label)}</p>
        </div>
        <div class="result-head-tags">
          ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          ${isExam ? `<span class="badge ${passed ? "badge-pass" : "badge-fail"}">${passed ? "合格" : "未合格"}</span>` : ""}
        </div>
      </header>

      <section class="result-hero ${isExam ? (passed ? "is-pass" : "is-fail") : "is-practice"}">
        <div class="result-hero-copy">
          <span class="result-eyebrow">${isExam ? (passed ? "PASSED" : "KEEP GOING") : "DONE"}</span>
          <h3>${isExam
            ? passed
              ? "合格，稳定发挥。"
              : record.accuracy >= record.passPercent - 10
                ? "差一点，重点复习错题。"
                : "基础还需巩固，先回到分类练习。"
            : record.accuracy >= 90
              ? "漂亮，这组题掌握得很稳。"
              : record.accuracy >= 70
                ? "不错，错题再练一遍就更牢了。"
                : "先弄懂错题，再开始下一组。"}</h3>
          <p>${isExam
            ? `本场按 ${record.passPercent}% 合格线判定，${record.total} 题答对 ${record.correct} 题。`
            : `本组共 ${record.total} 题，作答 ${answered} 题，答对 ${record.correct} 题。未作答按答错计入结果。`}</p>
          <div class="result-actions">
            ${wrongIds.length ? `<button type="button" class="btn btn-primary" data-action="retry-wrong">${icon("rotate", 16)} 重练错题（${wrongIds.length}）</button>` : ""}
            <a class="btn btn-secondary" href="#/${isExam ? "exam" : "practice"}">${icon(isExam ? "exam" : "practice", 16)} ${isExam ? "再考一次" : "再来一组"}</a>
            <a class="btn btn-ghost" href="#/wrong">${icon("wrong", 16)} 错题本</a>
          </div>
        </div>
        <div class="result-hero-score">
          ${scoreRing(score, {
            size: 166,
            label: isExam ? (passed ? "合格" : "未合格") : "正确率",
            tone,
          })}
          <div class="result-score-meta">
            <span><b>${record.correct}</b> / ${record.total} 题</span>
            <span>用时 ${formatDuration(record.durationSec)}</span>
          </div>
        </div>
      </section>

      <section class="stats-grid stats-grid-4 result-stats">
        ${statTile({ iconName: "check", label: "答对", value: `${record.correct}<small> 题</small>`, hint: percent(record.accuracy), tone: "teal" })}
        ${statTile({ iconName: "x", label: "答错", value: `${wrongIds.length - unanswered.length}<small> 题</small>`, hint: "多选需完全一致", tone: "rose" })}
        ${statTile({ iconName: "info", label: "未作答", value: `${unanswered.length}<small> 题</small>`, hint: isExam ? "未作答按错误计" : "按答错计入结果", tone: "amber" })}
        ${statTile({ iconName: "clock", label: "用时", value: formatDuration(record.durationSec), hint: isExam ? `限时 ${record.config?.duration || 25} 分钟` : "练习用时", tone: "blue" })}
      </section>

      <section class="card result-category-card">
        <header class="section-head">
          <div>
            <span class="section-kicker">Breakdown</span>
            <h3>分类表现</h3>
          </div>
          <span class="filter-count">${categories.length} 个分类</span>
        </header>
        <div class="result-category-list">
          ${categories
            .map(
              (entry) => `
                <div class="result-category-row">
                  <span class="category-emblem tone-${entry.categoryId}">${icon(categoryIcon(entry.categoryId), 17)}</span>
                  <span class="result-category-main">
                    <span class="result-category-line">
                      <strong>${escapeHtml(entry.category?.short || entry.categoryId)}</strong>
                      <small>${entry.correct}/${entry.total} 题</small>
                      <b>${Math.round(entry.accuracy)}%</b>
                    </span>
                    ${progressBar(entry.correct, entry.total, "progress-sm")}
                  </span>
                </div>`,
            )
            .join("")}
        </div>
      </section>

      <section class="result-review-head">
        <div>
          <span class="section-kicker">Review</span>
          <h3>逐题回顾</h3>
        </div>
        <span class="filter-count">答对 ${correctIds.length} 题 · 错题与未答 ${wrongIds.length} 题</span>
      </section>

      ${wrongIds.length ? `
        <details class="review-group" open>
          <summary class="review-summary">
            <span class="review-summary-left">
              <span class="review-dot is-wrong"></span>
              <strong>错题与未作答</strong>
              <b>${wrongIds.length}</b>
            </span>
            <span class="review-toggle">${icon("chevronDown", 18)}</span>
          </summary>
          <div class="review-list">
            ${wrongIds.map((questionId) => reviewCardHTML(record, questionId, record.questionIds.indexOf(questionId))).join("")}
          </div>
        </details>` : ""}

      ${correctIds.length ? `
        <details class="review-group">
          <summary class="review-summary">
            <span class="review-summary-left">
              <span class="review-dot is-correct"></span>
              <strong>答对题目</strong>
              <b>${correctIds.length}</b>
            </span>
            <span class="review-toggle">${icon("chevronDown", 18)}</span>
          </summary>
          <div class="review-list">
            ${correctIds.map((questionId) => reviewCardHTML(record, questionId, record.questionIds.indexOf(questionId))).join("")}
          </div>
        </details>` : ""}

      <div class="result-footer-actions">
        <a class="btn btn-secondary" href="#/dashboard">${icon("home", 16)} 返回首页</a>
        <a class="btn btn-ghost" href="#/records">${icon("history", 16)} 全部记录</a>
      </div>
    </div>`;

  root.querySelector("[data-action='retry-wrong']")?.addEventListener("click", () => {
    if (!wrongIds.length) {
      toast("本组没有错题", "info");
      return;
    }
    const session = startPracticeWithIds(wrongIds, {
      label: "错题重练",
      config: { label: "错题重练", onlyWrong: true },
    });
    if (session) window.location.hash = "/practice";
  });

  return () => {
    root.innerHTML = "";
  };
}
