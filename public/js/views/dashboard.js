/* Dashboard: progress overview, continue cards, categories and recent activity. */

import {
  escapeHtml,
  formatClock,
  formatDateTime,
  greeting,
  icon,
  percent,
  state,
} from "../core.js";
import { account } from "../account.js";
import {
  getRecentRecords,
  getStats,
} from "../data.js";
import { emptyState, progressBar, statTile } from "../components.js";

const CATEGORY_ICONS = {
  law: "scale",
  operation: "radio",
  equipment: "antenna",
  theory: "zap",
  safety: "shield",
};

function resumeCards(activePractice, activeExam) {
  const cards = [];
  if (activePractice) {
    const answered = Object.keys(activePractice.submitted || {}).length;
    cards.push(`
      <a class="resume-card" href="#/practice">
        <span class="resume-icon tone-teal">${icon("practice", 20)}</span>
        <span class="resume-copy">
          <strong>继续上次练习</strong>
          <small>${escapeHtml(activePractice.label || "综合练习")} · 已完成 ${answered}/${activePractice.questionIds.length} 题</small>
        </span>
        <span class="resume-action">继续 ${icon("arrowRight", 16)}</span>
      </a>`);
  }
  if (activeExam) {
    const left = activeExam.endsAt - Date.now();
    const answered = Object.keys(activeExam.answers || {}).filter(
      (key) => (activeExam.answers[key] || []).length,
    ).length;
    cards.push(`
      <a class="resume-card is-exam" href="#/exam">
        <span class="resume-icon tone-amber">${icon("exam", 20)}</span>
        <span class="resume-copy">
          <strong>模拟考试进行中</strong>
          <small>${left > 0 ? `剩余 ${formatClock(left)}` : "考试时间已到，等待交卷"} · 已答 ${answered}/${activeExam.questionIds.length} 题</small>
        </span>
        <span class="resume-action">进入考试 ${icon("arrowRight", 16)}</span>
      </a>`);
  }
  if (!cards.length) return "";
  return `<section class="resume-stack">${cards.join("")}</section>`;
}

function cloudBanner() {
  if (account.user) return "";
  if (account.status === "disabled") {
    return `
      <section class="cloud-banner is-muted">
        <span class="cloud-banner-icon">${icon("cloudOff", 20)}</span>
        <div class="cloud-banner-copy">
          <strong>当前站点暂未开启云端同步</strong>
          <small>练习、错题和记录仍会完整保存在本机浏览器；站点开启云端同步后即可登录。</small>
        </div>
        <a class="btn btn-secondary btn-sm" href="#/login">查看说明 ${icon("arrowRight", 15)}</a>
      </section>`;
  }
  if (!account.available) {
    return `
      <section class="cloud-banner is-muted">
        <span class="cloud-banner-icon">${icon("alert", 20)}</span>
        <div class="cloud-banner-copy">
          <strong>暂时无法连接账号服务</strong>
          <small>练习进度仍会保存在本机，恢复网络后登录即可同步。</small>
        </div>
        <a class="btn btn-secondary btn-sm" href="#/login">重试 ${icon("arrowRight", 15)}</a>
      </section>`;
  }
  return `
    <section class="cloud-banner">
      <span class="cloud-banner-icon">${icon("cloud", 20)}</span>
      <div class="cloud-banner-copy">
        <strong>登录后，进度跟着账号走</strong>
        <small>练习记录、错题本、解析缓存和进行中的答题会话会安全保存到云端，手机和电脑无缝接力。</small>
      </div>
      <a class="btn btn-primary btn-sm" href="#/login">登录 / 注册 ${icon("arrowRight", 15)}</a>
    </section>`;
}

function categoryRows(stats) {  return stats.categoryProgress
    .map((category) => {
      const tone = `tone-${category.id}`;
      return `
        <a class="category-row" href="#/bank?category=${encodeURIComponent(category.id)}">
          <span class="category-emblem ${tone}">${icon(CATEGORY_ICONS[category.id] || "library", 19)}</span>
          <span class="category-content">
            <span class="category-line">
              <strong>${escapeHtml(category.name)}</strong>
              <small>${category.attempted}/${category.count} 题</small>
              <b>${category.attempted ? percent(category.accuracy) : "—"}</b>
            </span>
            ${progressBar(category.attempted, category.count, "progress-sm")}
          </span>
          <span class="category-chevron">${icon("chevronRight", 17)}</span>
        </a>`;
    })
    .join("");
}

function recentRecords() {
  const records = getRecentRecords(5);
  if (!records.length) {
    return emptyState({
      iconName: "history",
      title: "还没有练习记录",
      description: "完成第一组练习后，这里会显示你的正确率、用时和答题轨迹。",
      action: `<a class="btn btn-primary btn-sm" href="#/practice">开始第一组练习 ${icon("arrowRight", 15)}</a>`,
    });
  }
  return `<div class="record-list compact-list">${records
    .map((record) => {
      const isExam = record.kind === "exam";
      const score = isExam
        ? `${Math.round(record.accuracy)}<small>分</small>`
        : `${Math.round(record.accuracy)}<small>%</small>`;
      return `
        <a class="record-row" href="#/result/${record.id}">
          <span class="record-icon ${isExam ? "tone-amber" : "tone-blue"}">${icon(isExam ? "exam" : "practice", 18)}</span>
          <span class="record-main">
            <strong>${escapeHtml(record.label)}</strong>
            <small>${formatDateTime(record.finishedAt)} · ${record.correct}/${record.total} 题</small>
          </span>
          <span class="record-score">${score}</span>
          ${isExam ? `<span class="badge ${record.passed ? "badge-pass" : "badge-fail"}">${record.passed ? "合格" : "未合格"}</span>` : ""}
          <span class="record-chevron">${icon("chevronRight", 16)}</span>
        </a>`;
    })
    .join("")}</div>`;
}

function weakTopics(stats) {
  if (!stats.weakTopics.length) {
    return `<p class="subtle-note">完成几组练习后，这里会显示需要加强的知识点。</p>`;
  }
  return `<div class="weak-topics">${stats.weakTopics
    .map(
      (topic) => `
        <a class="weak-topic" href="#/bank?topic=${encodeURIComponent(topic.id)}">
          <span>${escapeHtml(topic.name)}</span>
          <b>${percent(topic.accuracy)}</b>
        </a>`,
    )
    .join("")}</div>`;
}

export function renderDashboard(root) {
  const stats = getStats();
  const activePractice = state.activePractice;
  const activeExam = state.activeExam;
  const coverage = Math.round(stats.coverage);

  root.innerHTML = `
    <div class="page dashboard-page">
      <section class="hero-card">
        <div class="hero-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> A 类业余无线电台操作技术能力验证</div>
          <h2>${greeting()}，把每一道题练成电波直觉。</h2>
          <p>683 道题覆盖法规、操作、设备、理论与安全。支持单选、多选严格判定、错题本、模拟考试和 DeepSeek 在线解析。</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="#/practice">${icon("practice", 18)} 开始练习</a>
            <a class="btn btn-secondary btn-lg" href="#/exam">${icon("exam", 18)} 模拟考试</a>
          </div>
          <div class="hero-meta">
            <span>${icon("flame", 15)} 今日 ${stats.todayAnswered} 题</span>
            <span>${icon("target", 15)} 连续 ${stats.streak} 天</span>
            <span>${icon("layers", 15)} 已覆盖 ${stats.practiced}/${stats.totalQuestions}</span>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="signal-orbit orbit-one"></div>
          <div class="signal-orbit orbit-two"></div>
          <div class="signal-orbit orbit-three"></div>
          <div class="signal-core">${icon("radio", 34)}</div>
          <div class="signal-chip chip-coverage">
            <strong>${coverage}%</strong>
            <span>题库覆盖</span>
          </div>
          <div class="signal-chip chip-accuracy">
            <strong>${Math.round(stats.accuracy)}%</strong>
            <span>累计正确率</span>
          </div>
          <div class="signal-bars">
            <i style="height:22%"></i><i style="height:44%"></i><i style="height:33%"></i><i style="height:68%"></i><i style="height:52%"></i><i style="height:86%"></i><i style="height:64%"></i><i style="height:94%"></i>
          </div>
        </div>
      </section>

      ${cloudBanner()}

      ${resumeCards(activePractice, activeExam)}

      <section class="stats-grid" aria-label="学习数据">
        ${statTile({
          iconName: "layers",
          label: "已练题目",
          value: `${stats.practiced}<small> / ${stats.totalQuestions}</small>`,
          hint: `题库覆盖 ${coverage}%`,
          tone: "blue",
          href: "#/bank",
        })}
        ${statTile({
          iconName: "target",
          label: "累计正确率",
          value: `${Math.round(stats.accuracy)}<small>%</small>`,
          hint: `累计作答 ${stats.totalAnswered} 次`,
          tone: "teal",
          href: "#/records",
        })}
        ${statTile({
          iconName: "wrong",
          label: "待攻克错题",
          value: `${stats.wrongCount}<small> 题</small>`,
          hint: stats.masteredCount ? `已掌握 ${stats.masteredCount} 题` : "错题会自动收进错题本",
          tone: "rose",
          href: "#/wrong",
        })}
        ${statTile({
          iconName: "trophy",
          label: "模拟考试合格率",
          value: `${Math.round(stats.examPassRate)}<small>%</small>`,
          hint: `${stats.passedExams}/${stats.examCount} 次合格`,
          tone: "amber",
          href: "#/records",
        })}
      </section>

      <section class="dashboard-grid">
        <div class="card category-panel">
          <header class="section-head">
            <div>
              <span class="section-kicker">Progress</span>
              <h3>分类掌握度</h3>
            </div>
            <a class="text-link" href="#/bank">浏览题库 ${icon("arrowRight", 15)}</a>
          </header>
          <div class="category-list">${categoryRows(stats)}</div>
        </div>

        <aside class="dashboard-side">
          <div class="card quick-panel">
            <header class="section-head">
              <div>
                <span class="section-kicker">Shortcuts</span>
                <h3>快捷入口</h3>
              </div>
            </header>
            <div class="quick-grid">
              <a class="quick-action tone-blue" href="#/practice">
                <span>${icon("practice", 20)}</span>
                <strong>随机练习</strong>
                <small>按分类和题量自由组合</small>
              </a>
              <a class="quick-action tone-amber" href="#/exam">
                <span>${icon("exam", 20)}</span>
                <strong>模拟考试</strong>
                <small>40 题 / 25 分钟</small>
              </a>
              <a class="quick-action tone-rose" href="#/wrong">
                <span>${icon("wrong", 20)}</span>
                <strong>错题重练</strong>
                <small>${stats.wrongCount} 道待攻克</small>
              </a>
              <a class="quick-action tone-teal" href="#/settings">
                <span>${icon("sparkles", 20)}</span>
                <strong>AI 设置</strong>
                <small>配置 DeepSeek Key</small>
              </a>
            </div>
          </div>

          <div class="card weak-panel">
            <header class="section-head">
              <div>
                <span class="section-kicker">Focus</span>
                <h3>薄弱知识点</h3>
              </div>
            </header>
            ${weakTopics(stats)}
          </div>
        </aside>
      </section>

      <section class="card recent-panel">
        <header class="section-head">
          <div>
            <span class="section-kicker">Recent</span>
            <h3>最近练习</h3>
          </div>
          <a class="text-link" href="#/records">全部记录 ${icon("arrowRight", 15)}</a>
        </header>
        ${recentRecords()}
      </section>
    </div>`;
}
