/* Practice setup and session. */

import {
  confirmDialog,
  escapeHtml,
  icon,
  notifyShell,
  sameAnswer,
  saveState,
  state,
  toast,
  unique,
} from "../core.js";
import {
  data,
  finalizeSession,
  getCategory,
  getQuestion,
  getTopic,
  getWrongCount,
  makeId,
  selectQuestions,
  sessionProgress,
} from "../data.js";
import {
  progressBar,
  questionCardHTML,
} from "../components.js";

const COUNT_OPTIONS = [10, 20, 30, 50, 100];

let setupState = {
  type: "all",
  count: 20,
  order: "random",
  categoryIds: new Set(),
  topicId: "",
  onlyWrong: false,
};

function categoryOptionsMarkup() {
  return data.categories
    .map(
      (category) => `
        <label class="category-check tone-${category.id}">
          <input type="checkbox" name="practice-category" value="${category.id}" ${setupState.categoryIds.has(category.id) ? "checked" : ""} />
          <span class="check-box">${icon("check", 13)}</span>
          <span class="check-copy">
            <strong>${escapeHtml(category.short)}</strong>
            <small>${category.count} 题</small>
          </span>
        </label>`,
    )
    .join("");
}

function topicOptionsMarkup() {
  const groups = new Map();
  for (const topic of data.topics) {
    if (!groups.has(topic.categoryId)) groups.set(topic.categoryId, []);
    groups.get(topic.categoryId).push(topic);
  }
  return [...groups.entries()]
    .map(([categoryId, topics]) => {
      const category = getCategory(categoryId);
      return `<optgroup label="${escapeHtml(category?.name || categoryId)}">
        ${topics
          .map(
            (topic) =>
              `<option value="${topic.id}" ${setupState.topicId === topic.id ? "selected" : ""}>${escapeHtml(topic.name)}（${topic.count}）</option>`,
          )
          .join("")}
      </optgroup>`;
    })
    .join("");
}

function readSetupConfig(root) {
  const categoryIds = [...root.querySelectorAll("[name='practice-category']:checked")].map(
    (input) => input.value,
  );
  setupState.categoryIds = new Set(categoryIds);
  setupState.topicId = root.querySelector("#practice-topic")?.value || "";
  setupState.onlyWrong = Boolean(root.querySelector("#practice-only-wrong")?.checked);
  return {
    categoryIds,
    topicId: setupState.topicId,
    types: setupState.type === "all" ? [] : [setupState.type],
    onlyWrong: setupState.onlyWrong,
    count: setupState.count,
    order: setupState.order,
  };
}

function previewConfig(root) {
  const config = readSetupConfig(root);
  const countNode = root.querySelector("#practice-preview-count");
  const startButton = root.querySelector("[data-action='start-practice']");
  const hintNode = root.querySelector("#practice-preview-hint");
  if (!config.categoryIds.length) {
    if (countNode) countNode.textContent = "0";
    if (startButton) {
      startButton.disabled = true;
      startButton.innerHTML = `${icon("play", 17)} 开始练习`;
    }
    if (hintNode) hintNode.textContent = "请至少选择一个分类";
    return { config, pool: [], actual: 0 };
  }
  const pool = selectQuestions({ ...config, count: "all" });
  const actual = Math.min(config.count, pool.length);
  if (countNode) countNode.textContent = actual;
  if (startButton) {
    startButton.disabled = actual === 0;
    startButton.innerHTML = `${icon("play", 17)} 开始练习${actual ? ` · ${actual} 题` : ""}`;
  }
  if (hintNode) {
    hintNode.textContent = config.onlyWrong
      ? `错题池中共 ${getWrongCount()} 道待攻克题目`
      : `当前筛选范围共 ${pool.length} 道题`;
  }
  return { config, pool, actual };
}

function practiceLabel(config) {
  if (config.onlyWrong) return "错题重练";
  if (config.topicId) return getTopic(config.topicId)?.name || "专项练习";
  if (config.categoryIds.length === 1) {
    return getCategory(config.categoryIds[0])?.short || "分类练习";
  }
  if (config.categoryIds.length > 1 && config.categoryIds.length < data.categories.length) {
    return "多分类练习";
  }
  return "综合练习";
}

function renderSetup(root) {
  if (!setupState.categoryIds.size) {
    setupState.categoryIds = new Set(data.categories.map((category) => category.id));
  }
  if (!getWrongCount()) setupState.onlyWrong = false;
  root.innerHTML = `
    <div class="page practice-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">Practice</span>
          <h2>分类练习</h2>
          <p>按题型、题量、分类和知识点自由组合。多选题必须与标准答案完全一致。</p>
        </div>
        <div class="page-head-badge">${icon("target", 18)} 单选 + 多选</div>
      </header>

      <div class="practice-layout">
        <section class="card setup-card">
          <div class="setup-section">
            <div class="setup-label">
              <span>题型</span>
              <small>多选少选、多选均不得分</small>
            </div>
            <div class="segmented" role="group" aria-label="题型">
              ${[
                ["all", "全部题型"],
                ["single", "仅单选"],
                ["multiple", "仅多选"],
              ]
                .map(
                  ([value, label]) =>
                    `<button type="button" class="segment ${setupState.type === value ? "is-active" : ""}" data-action="set-type" data-value="${value}">${label}</button>`,
                )
                .join("")}
            </div>
          </div>

          <div class="setup-section">
            <div class="setup-label">
              <span>题量</span>
              <small>建议每组 20 题，保持专注</small>
            </div>
            <div class="segmented segmented-wrap" role="group" aria-label="题量">
              ${COUNT_OPTIONS.map(
                (count) =>
                  `<button type="button" class="segment ${setupState.count === count ? "is-active" : ""}" data-action="set-count" data-value="${count}">${count}</button>`,
              ).join("")}
            </div>
          </div>

          <div class="setup-section">
            <div class="setup-label">
              <span>顺序</span>
              <small>随机练习更适合检验记忆</small>
            </div>
            <div class="segmented" role="group" aria-label="顺序">
              <button type="button" class="segment ${setupState.order === "random" ? "is-active" : ""}" data-action="set-order" data-value="random">${icon("rotate", 15)} 随机</button>
              <button type="button" class="segment ${setupState.order === "sequence" ? "is-active" : ""}" data-action="set-order" data-value="sequence">${icon("layers", 15)} 顺序</button>
            </div>
          </div>

          <div class="setup-section">
            <div class="setup-label">
              <span>分类</span>
              <span class="setup-label-actions">
                <button type="button" class="text-button" data-action="select-all-categories">全选</button>
                <button type="button" class="text-button" data-action="clear-categories">清空</button>
              </span>
            </div>
            <div class="category-checks">${categoryOptionsMarkup()}</div>
          </div>

          <div class="setup-section">
            <div class="setup-label">
              <span>知识点</span>
              <small>可再缩小到具体章节</small>
            </div>
            <div class="select-wrap">
              ${icon("layers", 17)}
              <select id="practice-topic" class="select">
                <option value="">全部知识点</option>
                ${topicOptionsMarkup()}
              </select>
              ${icon("chevronDown", 16)}
            </div>
          </div>

          <label class="switch-row ${getWrongCount() ? "" : "is-disabled"}">
            <span class="switch-copy">
              <strong>只练错题</strong>
              <small>${getWrongCount() ? `当前错题本有 ${getWrongCount()} 道待攻克题目` : "错题本还是空的，先去练习积累错题"}</small>
            </span>
            <input type="checkbox" id="practice-only-wrong" ${setupState.onlyWrong ? "checked" : ""} ${getWrongCount() ? "" : "disabled"} />
            <span class="switch-ui"></span>
          </label>

          <div class="setup-footer">
            <div class="setup-preview">
              <span>已选 <b id="practice-preview-count">0</b> 题</span>
              <small id="practice-preview-hint"></small>
            </div>
            <button type="button" class="btn btn-primary btn-lg" data-action="start-practice">
              ${icon("play", 17)} 开始练习
            </button>
          </div>
        </section>

        <aside class="setup-aside">
          <div class="card aside-card">
            <div class="aside-art">${icon("radio", 28)}</div>
            <h3>练习建议</h3>
            <ul class="tip-list">
              <li><span>01</span>先按分类做 20 题，建立知识框架。</li>
              <li><span>02</span>多选题逐项判断，选完再提交。</li>
              <li><span>03</span>每天清一次错题本，连对后再移出。</li>
              <li><span>04</span>考前用模拟考试检验时间分配。</li>
            </ul>
          </div>
          <div class="card aside-card aside-stats">
            <div class="aside-stat"><strong>${data.meta.total}</strong><span>题库总题数</span></div>
            <div class="aside-stat"><strong>${data.meta.multipleCount}</strong><span>多选题</span></div>
            <div class="aside-stat"><strong>${getWrongCount()}</strong><span>待攻克错题</span></div>
          </div>
        </aside>
      </div>
    </div>`;

  previewConfig(root);
}

export function startPracticeWithIds(ids, { label = "错题重练", config = {} } = {}) {
  const questionIds = unique(ids).filter((id) => getQuestion(id));
  if (!questionIds.length) {
    toast("没有可练习的题目", "error");
    return null;
  }
  const session = {
    id: makeId("practice"),
    kind: "practice",
    startedAt: Date.now(),
    questionIds,
    current: 0,
    answers: {},
    submitted: {},
    label,
    config,
    finished: false,
  };
  state.activePractice = session;
  saveState();
  notifyShell();
  return session;
}

function startFromSetup(root) {
  const { config, actual } = previewConfig(root);
  if (!actual) {
    toast("当前筛选条件下没有题目", "error");
    return;
  }
  const pool = selectQuestions(config);
  const categoryNames = config.categoryIds
    .map((id) => getCategory(id)?.short)
    .filter(Boolean);
  const label = practiceLabel(config);
  startPracticeWithIds(
    pool.map((question) => question.id),
    {
      label,
      config: {
        ...config,
        count: actual,
        label,
        categoryNames,
        topicName: config.topicId ? getTopic(config.topicId)?.name : "",
      },
    },
  );
  paintSession(root, { scroll: "top" });
}

function gridButtonClass(session, questionId, index) {
  const classes = ["sheet-cell"];
  if (index === session.current) classes.push("is-current");
  if (session.submitted[questionId]) {
    const question = getQuestion(questionId);
    if (question && sameAnswer(session.answers[questionId] || [], question.answer)) {
      classes.push("is-correct");
    } else {
      classes.push("is-wrong");
    }
  } else if ((session.answers[questionId] || []).length) {
    classes.push("is-selected");
  }
  return classes.join(" ");
}

function sheetHTML(session) {
  return session.questionIds
    .map((questionId, index) => {
      const question = getQuestion(questionId);
      return `<button type="button" class="${gridButtonClass(session, questionId, index)}" data-action="jump" data-index="${index}" title="第 ${index + 1} 题${question ? ` · ${question.topic}` : ""}">${index + 1}</button>`;
    })
    .join("");
}

function mobileStripHTML(session) {
  return session.questionIds
    .map((questionId, index) => {
      const submitted = session.submitted[questionId];
      const selected = (session.answers[questionId] || []).length > 0;
      return `<button type="button" class="mobile-jump ${index === session.current ? "is-current" : ""} ${submitted ? "is-submitted" : selected ? "is-selected" : ""}" data-action="jump" data-index="${index}">${index + 1}</button>`;
    })
    .join("");
}

function sessionBodyHTML(session) {
  const questionId = session.questionIds[session.current];
  const question = getQuestion(questionId);
  const selected = session.answers[questionId] || [];
  const submitted = Boolean(session.submitted[questionId]);
  const progress = sessionProgress(session);
  const total = session.questionIds.length;
  const answered = progress.answered;
  const isLast = session.current === total - 1;
  const canSubmit = selected.length > 0;
  const primaryAction = submitted
    ? isLast
      ? "finish-practice"
      : "next"
    : "submit";
  const primaryLabel = submitted
    ? isLast
      ? `${icon("check", 17)} 查看结果`
      : `下一题 ${icon("arrowRight", 17)}`
    : `${icon("check", 17)} 提交答案`;
  const primaryDisabled = !submitted && !canSubmit ? "disabled" : "";

  return `
    <div class="page practice-session-page">
      <div class="session-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" data-action="exit-practice">${icon("arrowLeft", 16)} 退出</button>
        <div class="session-title">
          <strong>${escapeHtml(session.label || "综合练习")}</strong>
          <span>第 ${session.current + 1} / ${total} 题 · 已答 ${answered}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="finish-practice">结束练习</button>
      </div>

      <div class="session-progress">
        ${progressBar(session.current + 1, total, "progress-session")}
        <div class="session-progress-meta">
          <span>进度 ${Math.round(((session.current + 1) / total) * 100)}%</span>
          <span>正确 ${progress.correct} · 已答 ${answered}/${total}</span>
        </div>
      </div>

      <div class="mobile-jump-strip" aria-label="快速跳题">${mobileStripHTML(session)}</div>

      <div class="session-layout">
        <div class="session-main">
          <div id="practice-question">
            ${questionCardHTML(question, {
              number: session.current + 1,
              selected,
              submitted,
              showMnemonic: true,
              showAnalyze: submitted,
            })}
          </div>

          <div class="session-actions">
            <button type="button" class="btn btn-secondary" data-action="prev" ${session.current === 0 ? "disabled" : ""}>${icon("arrowLeft", 17)} 上一题</button>
            <div class="session-actions-main">
              ${!submitted ? `<button type="button" class="text-button session-skip" data-action="next">跳过本题</button>` : ""}
              <button type="button" class="btn btn-primary btn-lg" data-action="${primaryAction}" ${primaryDisabled}>${primaryLabel}</button>
            </div>
          </div>
        </div>

        <aside class="session-side">
          <div class="card session-side-card">
            <header class="side-head">
              <div>
                <span class="section-kicker">Answer sheet</span>
                <h3>答题卡</h3>
              </div>
              <span class="badge badge-neutral">${answered}/${total}</span>
            </header>
            <div class="sheet-grid">${sheetHTML(session)}</div>
            <div class="sheet-legend">
              <span><i class="legend-dot is-current"></i>当前</span>
              <span><i class="legend-dot is-correct"></i>正确</span>
              <span><i class="legend-dot is-wrong"></i>错误</span>
              <span><i class="legend-dot is-selected"></i>已选</span>
            </div>
            <div class="side-stats">
              <div><span>已答</span><strong>${answered}</strong></div>
              <div><span>正确</span><strong>${progress.correct}</strong></div>
              <div><span>正确率</span><strong>${answered ? Math.round(progress.accuracy) : 0}%</strong></div>
            </div>
            <div class="side-tip">${icon("info", 15)} 多选题必须与标准答案完全一致。</div>
            <button type="button" class="btn btn-secondary btn-block" data-action="finish-practice">结束并查看结果</button>
          </div>
        </aside>
      </div>
    </div>`;
}

function paintSession(root, { scroll = "preserve" } = {}) {
  const session = state.activePractice;
  if (!session) {
    renderSetup(root);
    return;
  }
  const before = window.scrollY;
  root.innerHTML = sessionBodyHTML(session);
  if (scroll === "top") {
    window.scrollTo({ top: 0, behavior: "instant" });
  } else {
    window.scrollTo({ top: before, behavior: "instant" });
  }
}

function currentSelection(session) {
  const questionId = session.questionIds[session.current];
  return session.answers[questionId] || [];
}

function chooseOption(root, key) {
  const session = state.activePractice;
  const question = getQuestion(session.questionIds[session.current]);
  if (!question || session.submitted[question.id]) return;
  const current = new Set(session.answers[question.id] || []);
  if (question.type === "multiple") {
    if (current.has(key)) current.delete(key);
    else current.add(key);
    session.answers[question.id] = [...current].sort();
  } else {
    session.answers[question.id] = [key];
  }
  saveState();
  paintSession(root);
}

function submitCurrent(root) {
  const session = state.activePractice;
  const questionId = session.questionIds[session.current];
  if (!(session.answers[questionId] || []).length) {
    toast("请先选择答案", "info");
    return;
  }
  session.submitted[questionId] = true;
  saveState();
  paintSession(root);
}

function goTo(root, index) {
  const session = state.activePractice;
  if (!session) return;
  session.current = Math.max(0, Math.min(index, session.questionIds.length - 1));
  saveState();
  paintSession(root, { scroll: "top" });
}

function finishPractice(root, { force = false } = {}) {
  const session = state.activePractice;
  if (!session) return;
  const progress = sessionProgress(session);
  const unanswered = session.questionIds.length - progress.answered;
  const run = async () => {
    if (unanswered > 0 && !force) {
      const confirmed = await confirmDialog({
        title: "还有题目未作答",
        message: `还有 <b>${unanswered}</b> 道题未作答。未作答题目将按答错计入本次练习结果，确定结束吗？`,
        confirmText: "结束练习",
        danger: true,
      });
      if (!confirmed) return;
    }
    try {
      const record = finalizeSession(session);
      toast("练习完成，结果已保存", "success");
      window.location.hash = `/result/${record.id}`;
    } catch (error) {
      console.error(error);
      toast("保存练习结果失败，请重试", "error");
    }
  };
  run();
}

export function renderPractice(root) {
  if (state.activePractice) {
    paintSession(root);
  } else {
    renderSetup(root);
  }

  const onClick = (event) => {
    const option = event.target.closest("[data-option]");
    if (option && root.contains(option)) {
      chooseOption(root, option.dataset.option);
      return;
    }
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode || !root.contains(actionNode)) return;
    const action = actionNode.dataset.action;

    if (action === "set-type") {
      setupState.type = actionNode.dataset.value;
      root.querySelectorAll("[data-action='set-type']").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.value === setupState.type);
      });
      previewConfig(root);
      return;
    }
    if (action === "set-count") {
      setupState.count = Number(actionNode.dataset.value);
      root.querySelectorAll("[data-action='set-count']").forEach((node) => {
        node.classList.toggle("is-active", Number(node.dataset.value) === setupState.count);
      });
      previewConfig(root);
      return;
    }
    if (action === "set-order") {
      setupState.order = actionNode.dataset.value;
      root.querySelectorAll("[data-action='set-order']").forEach((node) => {
        node.classList.toggle("is-active", node.dataset.value === setupState.order);
      });
      previewConfig(root);
      return;
    }
    if (action === "select-all-categories") {
      root.querySelectorAll("[name='practice-category']").forEach((input) => {
        input.checked = true;
      });
      previewConfig(root);
      return;
    }
    if (action === "clear-categories") {
      root.querySelectorAll("[name='practice-category']").forEach((input) => {
        input.checked = false;
      });
      previewConfig(root);
      return;
    }
    if (action === "start-practice") {
      startFromSetup(root);
      return;
    }

    if (action === "submit") {
      submitCurrent(root);
      return;
    }
    if (action === "next") {
      const session = state.activePractice;
      if (!session) return;
      if (session.current < session.questionIds.length - 1) {
        goTo(root, session.current + 1);
      } else if (session.submitted[session.questionIds[session.current]]) {
        finishPractice(root, { force: true });
      }
      return;
    }
    if (action === "prev") {
      const session = state.activePractice;
      if (session) goTo(root, session.current - 1);
      return;
    }
    if (action === "jump") {
      goTo(root, Number(actionNode.dataset.index));
      return;
    }
    if (action === "finish-practice") {
      finishPractice(root);
      return;
    }
    if (action === "exit-practice") {
      const session = state.activePractice;
      if (!session) return;
      confirmDialog({
        title: "退出本次练习？",
        message: "进度会保留在本地，下次进入练习页可以继续。",
        confirmText: "退出并保留",
        cancelText: "继续练习",
      }).then((confirmed) => {
        if (confirmed) window.location.hash = "/dashboard";
      });
    }
  };

  const onKeyDown = (event) => {
    if (document.body.classList.contains("overlay-open")) return;
    if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const session = state.activePractice;
    if (!session) return;
    const key = event.key.toUpperCase();
    const question = getQuestion(session.questionIds[session.current]);
    if (!question) return;
    const optionKey = /^[A-D]$/.test(key) ? key : /^[1-4]$/.test(key) ? "ABCD"[Number(key) - 1] : "";
    if (optionKey && !session.submitted[question.id]) {
      event.preventDefault();
      chooseOption(root, optionKey);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!session.submitted[question.id]) {
        if (currentSelection(session).length) submitCurrent(root);
      } else if (session.current < session.questionIds.length - 1) {
        goTo(root, session.current + 1);
      } else {
        finishPractice(root, { force: true });
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(root, session.current - 1);
    }
    if (event.key === "ArrowRight" && session.submitted[question.id]) {
      event.preventDefault();
      goTo(root, session.current + 1);
    }
  };

  const onChange = (event) => {
    if (!event.target.closest("[name='practice-category'], #practice-topic, #practice-only-wrong")) {
      return;
    }
    previewConfig(root);
  };

  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    document.removeEventListener("keydown", onKeyDown);
    root.innerHTML = "";
  };
}
