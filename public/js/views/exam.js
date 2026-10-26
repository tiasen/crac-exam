/* Mock exam setup, timed exam session and answer sheet. */

import {
  clamp,
  closeAllOverlays,
  confirmDialog,
  escapeHtml,
  formatClock,
  formatDateTime,
  formatDuration,
  icon,
  notifyShell,
  openModal,
  saveState,
  shuffle,
  state,
  toast,
} from "../core.js";
import {
  data,
  finalizeSession,
  getQuestion,
  makeId,
  sessionProgress,
} from "../data.js";
import {
  emptyState,
  progressBar,
  questionCardHTML,
} from "../components.js";

function examRecordsMarkup() {
  const records = state.records.filter((record) => record.kind === "exam").slice(0, 4);
  if (!records.length) {
    return `<p class="subtle-note">完成一次模拟考试后，这里会显示你的分数和合格情况。</p>`;
  }
  return `<div class="record-list compact-list">${records
    .map(
      (record) => `
        <a class="record-row" href="#/result/${record.id}">
          <span class="record-icon tone-amber">${icon("exam", 18)}</span>
          <span class="record-main">
            <strong>模拟考试 · ${Math.round(record.accuracy)} 分</strong>
            <small>${formatDateTime(record.finishedAt)} · ${record.correct}/${record.total} 题 · ${formatDuration(record.durationSec)}</small>
          </span>
          <span class="badge ${record.passed ? "badge-pass" : "badge-fail"}">${record.passed ? "合格" : "未合格"}</span>
          <span class="record-chevron">${icon("chevronRight", 16)}</span>
        </a>`,
    )
    .join("")}</div>`;
}

function renderSetup(root) {
  const config = { ...state.settings.exam };
  const examRecords = state.records.filter((record) => record.kind === "exam");
  const passed = examRecords.filter((record) => record.passed).length;
  root.innerHTML = `
    <div class="page exam-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">Mock exam</span>
          <h2>模拟考试</h2>
          <p>按真实 A 类考试节奏抽题。交卷前不显示答案，时间到自动交卷。</p>
        </div>
        <div class="page-head-badge">${icon("clock", 18)} 限时答题</div>
      </header>

      <div class="exam-setup-grid">
        <section class="card exam-intro-card">
          <div class="exam-intro-top">
            <div class="exam-medal">${icon("trophy", 30)}</div>
            <div>
              <span class="section-kicker">Rule set</span>
              <h3>默认对齐 A 类正式考试</h3>
              <p>题目从 683 道题库中随机抽取，第 1–32 题为单选、第 33–40 题为多选，共 40 题。</p>
            </div>
          </div>
          <div class="exam-rule-chips">
            <span><b>${config.count}</b> 题</span>
            <span><b>${config.duration}</b> 分钟</span>
            <span><b>${config.passPercent}</b> 分合格</span>
            <span><b>${Math.ceil((config.count * config.passPercent) / 100)}</b> 题答对</span>
          </div>
          <ul class="exam-rules">
            <li><span>${icon("check", 15)}</span>第 1–32 题为单选，第 33–40 题为多选；多选必须与标准答案完全一致，少选、多选均不得分。</li>
            <li><span>${icon("check", 15)}</span>答题过程中可以前进、后退、标记题目，答案会自动保存。</li>
            <li><span>${icon("check", 15)}</span>交卷后立即显示分数、分类正确率和逐题解析。</li>
            <li><span>${icon("check", 15)}</span>时间用尽会自动交卷，未作答题目按错误计入。</li>
          </ul>
          <div class="exam-intro-note">
            ${icon("info", 16)}
            <span>正式考试为 40 题、25 分钟、答对 30 题合格（75%）。序号 1–32 为单选，33 起为多选。下方参数可自行调整，仅影响模拟考试。</span>
          </div>
        </section>

        <section class="card exam-config-card">
          <header class="section-head">
            <div>
              <span class="section-kicker">Settings</span>
              <h3>本场设置</h3>
            </div>
          </header>
          <div class="form-grid">
            <label class="field">
              <span>题目数量</span>
              <div class="input-with-suffix">
                <input id="exam-count" type="number" min="5" max="${data.meta.total}" step="1" value="${config.count}" inputmode="numeric" />
                <em>题</em>
              </div>
            </label>
            <label class="field">
              <span>考试时长</span>
              <div class="input-with-suffix">
                <input id="exam-duration" type="number" min="1" max="180" step="1" value="${config.duration}" inputmode="numeric" />
                <em>分钟</em>
              </div>
            </label>
            <label class="field field-wide">
              <span>合格线</span>
              <div class="input-with-suffix">
                <input id="exam-pass" type="number" min="50" max="100" step="1" value="${config.passPercent}" inputmode="numeric" />
                <em>%</em>
              </div>
              <small>默认 75%，即 40 题答对 30 题合格。</small>
            </label>
          </div>
          <button type="button" class="btn btn-primary btn-lg btn-block" data-action="start-exam">
            ${icon("play", 18)} 开始模拟考试
          </button>
          <div class="exam-config-meta">
            <span>${examRecords.length ? `已参加 ${examRecords.length} 次` : "还没有考试记录"}</span>
            <span>${examRecords.length ? `合格率 ${Math.round((passed / examRecords.length) * 100)}%` : "第一次考试加油"}</span>
          </div>
        </section>
      </div>

      <section class="card recent-panel">
        <header class="section-head">
          <div>
            <span class="section-kicker">Exam history</span>
            <h3>最近模拟考试</h3>
          </div>
          <a class="text-link" href="#/records">全部记录 ${icon("arrowRight", 15)}</a>
        </header>
        ${examRecordsMarkup()}
      </section>
    </div>`;
}

function createExamSession() {
  const count = clamp(Number(state.settings.exam.count) || 40, 5, data.meta.total);
  const duration = clamp(Number(state.settings.exam.duration) || 25, 1, 180);
  const passPercent = clamp(Number(state.settings.exam.passPercent) || 75, 50, 100);

  const singles = data.questions.filter((question) => question.type === "single");
  const multiples = data.questions.filter((question) => question.type === "multiple");

  // Official layout: 32 single-choice questions followed by 8 multiple-choice
  // questions for the 40-question exam. For custom lengths keep the 80/20 mix
  // and always place all single-choice questions before multiple-choice ones.
  let singleGoal = Math.min(singles.length, Math.round(count * 0.8));
  let multiGoal = Math.min(multiples.length, count - singleGoal);
  let remaining = count - singleGoal - multiGoal;
  if (remaining > 0) {
    const extraSingles = Math.min(remaining, singles.length - singleGoal);
    singleGoal += extraSingles;
    remaining -= extraSingles;
  }
  if (remaining > 0) {
    multiGoal += Math.min(remaining, multiples.length - multiGoal);
  }

  const selected = [
    ...shuffle(singles).slice(0, singleGoal),
    ...shuffle(multiples).slice(0, multiGoal),
  ];

  const session = {
    id: makeId("exam"),
    kind: "exam",
    startedAt: Date.now(),
    endsAt: Date.now() + duration * 60 * 1000,
    questionIds: selected.map((question) => question.id),
    current: 0,
    answers: {},
    flags: {},
    label: "模拟考试",
    config: {
      count: selected.length,
      duration,
      passPercent,
      singleCount: selected.filter((question) => question.type === "single").length,
      multipleCount: selected.filter((question) => question.type === "multiple").length,
    },
    finished: false,
  };
  state.activeExam = session;
  saveState();
  notifyShell();
  return session;
}

function answeredCount(session) {
  return Object.values(session.answers || {}).filter((answer) => (answer || []).length).length;
}

function sheetHTML(session, { modal = false } = {}) {
  return session.questionIds
    .map((questionId, index) => {
      const answered = (session.answers[questionId] || []).length > 0;
      const flagged = Boolean(session.flags?.[questionId]);
      const classes = ["sheet-cell"];
      if (index === session.current) classes.push("is-current");
      if (answered) classes.push("is-answered");
      if (flagged) classes.push("is-flagged");
      return `<button type="button" class="${classes.join(" ")}" data-action="${modal ? "sheet-jump" : "jump"}" data-index="${index}" title="第 ${index + 1} 题${answered ? "，已作答" : ""}${flagged ? "，已标记" : ""}">${index + 1}${flagged ? '<i class="cell-flag"></i>' : ""}</button>`;
    })
    .join("");
}

function examBodyHTML(session) {
  const questionId = session.questionIds[session.current];
  const question = getQuestion(questionId);
  const selected = session.answers[questionId] || [];
  const progress = sessionProgress(session);
  const answered = answeredCount(session);
  const flagged = Boolean(session.flags?.[questionId]);
  const total = session.questionIds.length;
  const isLast = session.current === total - 1;

  return `
    <div class="page exam-session-page">
      <div class="exam-bar">
        <div class="exam-timer" data-exam-timer aria-live="polite">${icon("clock", 17)}<span>${formatClock(session.endsAt - Date.now())}</span></div>
        <div class="exam-bar-center">
          <strong>模拟考试</strong>
          <span>第 ${session.current + 1} / ${total} 题 · 已答 <b data-exam-answered>${answered}</b></span>
        </div>
        <div class="exam-bar-actions">
          <button type="button" class="btn btn-ghost btn-sm exam-flag-button ${flagged ? "is-active" : ""}" data-action="toggle-flag">${icon("flag", 16)} ${flagged ? "已标记" : "标记"}</button>
          <button type="button" class="btn btn-secondary btn-sm exam-sheet-button" data-action="open-sheet">${icon("layers", 16)} 答题卡</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="submit-exam">交卷</button>
        </div>
      </div>

      <div class="exam-progress-line">
        ${progressBar(answered, total, "progress-exam")}
        <span><b data-exam-answered>${answered}</b> / ${total} 已作答</span>
      </div>

      <div class="exam-layout">
        <div class="exam-main">
          <div id="exam-question">
            ${questionCardHTML(question, {
              number: session.current + 1,
              selected,
              exam: true,
              showAnalyze: false,
            })}
          </div>
          <div class="exam-nav-actions">
            <button type="button" class="btn btn-secondary" data-action="prev" ${session.current === 0 ? "disabled" : ""}>${icon("arrowLeft", 17)} 上一题</button>
            <span class="exam-nav-hint">${icon("info", 15)} 交卷前不显示答案</span>
            <button type="button" class="btn btn-primary" data-action="next">${isLast ? "检查答题卡" : `下一题 ${icon("arrowRight", 17)}`}</button>
          </div>
        </div>

        <aside class="exam-side">
          <div class="card exam-side-card">
            <header class="side-head">
              <div>
                <span class="section-kicker">Answer sheet</span>
                <h3>答题卡</h3>
              </div>
              <span class="badge badge-neutral"><b data-exam-answered>${answered}</b>/${total}</span>
            </header>
            <div class="sheet-grid">${sheetHTML(session)}</div>
            <div class="sheet-legend">
              <span><i class="legend-dot is-current"></i>当前</span>
              <span><i class="legend-dot is-answered"></i>已答</span>
              <span><i class="legend-dot is-flagged"></i>标记</span>
            </div>
            <div class="exam-side-summary">
              <div><span>考试时长</span><strong>${session.config.duration} 分钟</strong></div>
              <div><span>合格线</span><strong>${session.config.passPercent}%</strong></div>
              <div><span>题目配比</span><strong>${session.config.singleCount} 单选 / ${session.config.multipleCount} 多选</strong></div>
            </div>
            <button type="button" class="btn btn-primary btn-block" data-action="submit-exam">${icon("check", 17)} 交卷</button>
            <p class="side-tip">${icon("alert", 15)} 时间到会自动交卷。</p>
          </div>
        </aside>
      </div>
    </div>`;
}

function updateTimer(root, session) {
  const node = root.querySelector("[data-exam-timer]");
  if (!node) return;
  const left = session.endsAt - Date.now();
  node.innerHTML = `${icon("clock", 17)}<span>${formatClock(Math.max(0, left))}</span>`;
  node.classList.toggle("is-warning", left <= 5 * 60 * 1000 && left > 60 * 1000);
  node.classList.toggle("is-danger", left <= 60 * 1000);
}

function paintExamQuestion(root, session) {
  const questionId = session.questionIds[session.current];
  const question = getQuestion(questionId);
  const selected = session.answers[questionId] || [];
  const holder = root.querySelector("#exam-question");
  if (holder && question) {
    holder.innerHTML = questionCardHTML(question, {
      number: session.current + 1,
      selected,
      exam: true,
      showAnalyze: false,
    });
  }
  const answered = answeredCount(session);
  root.querySelectorAll("[data-exam-answered]").forEach((node) => {
    node.textContent = String(answered);
  });
  root.querySelectorAll(".exam-side .sheet-grid").forEach((node) => {
    node.innerHTML = sheetHTML(session);
  });
  const progressNode = root.querySelector(".exam-progress-line .progress span");
  if (progressNode) {
    progressNode.style.width = `${(answered / session.questionIds.length) * 100}%`;
  }
}

function paintExam(root, { scroll = "preserve" } = {}) {
  const session = state.activeExam;
  if (!session) {
    renderSetup(root);
    return;
  }
  const before = window.scrollY;
  root.innerHTML = examBodyHTML(session);
  updateTimer(root, session);
  if (scroll === "top") window.scrollTo({ top: 0, behavior: "instant" });
  else window.scrollTo({ top: before, behavior: "instant" });
}

function examErrorFallback(root) {
  root.innerHTML = `
    <div class="page">
      ${emptyState({
        iconName: "alert",
        title: "考试加载失败",
        description: "请返回首页后重新进入模拟考试。",
        action: `<a class="btn btn-primary btn-sm" href="#/dashboard">返回首页</a>`,
      })}
    </div>`;
}

export function renderExam(root) {
  const existing = state.activeExam;
  if (existing && Date.now() >= existing.endsAt) {
    try {
      const record = finalizeSession(existing);
      toast("考试时间已到，已自动交卷", "info");
      window.location.hash = `/result/${record.id}`;
    } catch (error) {
      console.error(error);
      examErrorFallback(root);
    }
    return () => {};
  }

  if (existing) {
    paintExam(root);
  } else {
    renderSetup(root);
  }

  let submitInFlight = false;
  let timerId = null;
  let timerSessionId = null;
  let autoSubmitted = false;

  const clearTimer = () => {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
    timerSessionId = null;
  };

  const finalizeExam = (session) => {
    if (submitInFlight) return;
    submitInFlight = true;
    clearTimer();
    closeAllOverlays();
    try {
      const record = finalizeSession(session);
      toast(session.kind === "exam" ? "已交卷，成绩已保存" : "已保存", "success");
      window.location.hash = `/result/${record.id}`;
    } catch (error) {
      submitInFlight = false;
      console.error(error);
      toast("交卷失败，请重试", "error");
    }
  };

  const requestSubmit = async (session, { force = false } = {}) => {
    if (submitInFlight) return;
    if (!force) {
      const answered = answeredCount(session);
      const unanswered = session.questionIds.length - answered;
      const confirmed = await confirmDialog({
        title: "确认交卷？",
        message:
          unanswered > 0
            ? `还有 <b>${unanswered}</b> 道题未作答，未作答题目按错误计入成绩。交卷后无法修改答案。`
            : "所有题目已作答。交卷后将立即显示成绩和逐题解析。",
        confirmText: "确认交卷",
        danger: unanswered > 0,
      });
      if (!confirmed) return;
    }
    finalizeExam(session);
  };

  const startTimer = () => {
    const session = state.activeExam;
    if (!session) return;
    if (timerId && timerSessionId === session.id) {
      updateTimer(root, session);
      return;
    }
    clearTimer();
    timerSessionId = session.id;
    autoSubmitted = false;
    const tick = () => {
      const current = state.activeExam;
      if (!current || current.id !== session.id) {
        clearTimer();
        return;
      }
      updateTimer(root, current);
      if (Date.now() >= current.endsAt && !autoSubmitted) {
        autoSubmitted = true;
        clearTimer();
        toast("考试时间已到，正在自动交卷", "info");
        finalizeExam(current);
      }
    };
    updateTimer(root, session);
    timerId = window.setInterval(tick, 1000);
  };

  const goTo = (index) => {
    const session = state.activeExam;
    if (!session) return;
    session.current = Math.max(0, Math.min(index, session.questionIds.length - 1));
    saveState();
    paintExam(root, { scroll: "top" });
  };

  const chooseOption = (key) => {
    const session = state.activeExam;
    if (!session) return;
    const question = getQuestion(session.questionIds[session.current]);
    if (!question) return;
    const current = new Set(session.answers[question.id] || []);
    if (question.type === "multiple") {
      if (current.has(key)) current.delete(key);
      else current.add(key);
      session.answers[question.id] = [...current].sort();
    } else {
      session.answers[question.id] = [key];
    }
    saveState();
    paintExamQuestion(root, session);
  };

  const toggleFlag = () => {
    const session = state.activeExam;
    if (!session) return;
    const questionId = session.questionIds[session.current];
    session.flags[questionId] = !session.flags[questionId];
    saveState();
    paintExam(root);
  };

  const onVisibility = () => {
    if (!document.hidden && state.activeExam) startTimer();
  };

  const onClick = (event) => {
    const option = event.target.closest("[data-option]");
    if (option && root.contains(option)) {
      chooseOption(option.dataset.option);
      return;
    }
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode || !root.contains(actionNode)) return;
    const action = actionNode.dataset.action;
    const session = state.activeExam;
    if (!session) {
      if (action === "start-exam") {
        const countInput = root.querySelector("#exam-count");
        const durationInput = root.querySelector("#exam-duration");
        const passInput = root.querySelector("#exam-pass");
        state.settings.exam = {
          count: clamp(Number(countInput?.value) || 40, 5, data.meta.total),
          duration: clamp(Number(durationInput?.value) || 25, 1, 180),
          passPercent: clamp(Number(passInput?.value) || 75, 50, 100),
        };
        saveState();
        createExamSession();
        paintExam(root, { scroll: "top" });
        startTimer();
        toast("考试开始，注意时间", "info");
      }
      return;
    }

    if (action === "prev") {
      goTo(session.current - 1);
      return;
    }
    if (action === "next") {
      if (session.current < session.questionIds.length - 1) goTo(session.current + 1);
      else {
        const sheetButton = root.querySelector("[data-action='open-sheet']");
        if (sheetButton) sheetButton.click();
      }
      return;
    }
    if (action === "jump") {
      goTo(Number(actionNode.dataset.index));
      return;
    }
    if (action === "toggle-flag") {
      toggleFlag();
      return;
    }
    if (action === "submit-exam") {
      requestSubmit(session);
      return;
    }
    if (action === "open-sheet") {
      const modalBody = document.createElement("div");
      modalBody.className = "exam-sheet-modal";
      modalBody.innerHTML = `
        <div class="exam-sheet-summary">
          <span>已答 <b>${answeredCount(session)}</b> / ${session.questionIds.length}</span>
          <span>标记 <b>${Object.values(session.flags || {}).filter(Boolean).length}</b> 题</span>
        </div>
        <div class="sheet-grid sheet-grid-modal">${sheetHTML(session, { modal: true })}</div>
        <div class="sheet-legend">
          <span><i class="legend-dot is-current"></i>当前</span>
          <span><i class="legend-dot is-answered"></i>已答</span>
          <span><i class="legend-dot is-flagged"></i>标记</span>
        </div>
        <button type="button" class="btn btn-primary btn-block" data-sheet-submit>${icon("check", 17)} 交卷</button>`;
      const modal = openModal({
        title: "答题卡",
        body: modalBody.innerHTML,
        className: "modal-sheet",
      });
      modal.el.addEventListener("click", (modalEvent) => {
        const jump = modalEvent.target.closest("[data-action='sheet-jump']");
        if (jump) {
          modal.close();
          goTo(Number(jump.dataset.index));
          return;
        }
        if (modalEvent.target.closest("[data-sheet-submit]")) {
          modal.close();
          requestSubmit(state.activeExam);
        }
      });
      return;
    }
  };

  const onKeyDown = (event) => {
    if (document.body.classList.contains("overlay-open")) return;
    if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const session = state.activeExam;
    if (!session) return;
    const key = event.key.toUpperCase();
    const optionKey = /^[A-D]$/.test(key) ? key : /^[1-4]$/.test(key) ? "ABCD"[Number(key) - 1] : "";
    if (optionKey) {
      event.preventDefault();
      chooseOption(optionKey);
      return;
    }
    if (key === "F") {
      event.preventDefault();
      toggleFlag();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(session.current - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(session.current + 1);
    }
  };

  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibility);
  if (state.activeExam) startTimer();

  return () => {
    clearTimer();
    root.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("visibilitychange", onVisibility);
    root.innerHTML = "";
  };
}
