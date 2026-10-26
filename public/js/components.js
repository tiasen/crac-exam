/* Shared UI components: question cards, markdown, AI analysis drawer and helpers. */

import {
  answerLabel,
  aiReady,
  cacheAnalysis,
  clamp,
  copyText,
  escapeHtml,
  formatDateTime,
  getCachedAnalysis,
  icon,
  sameAnswer,
  state,
  streamChat,
  toast,
} from "./core.js";
import { getCategory, getMnemonic, getQuestion } from "./data.js";

export const CATEGORY_ICONS = {
  law: "scale",
  operation: "radio",
  equipment: "antenna",
  theory: "zap",
  safety: "shield",
};

export function categoryIcon(categoryId) {
  return CATEGORY_ICONS[categoryId] || "layers";
}

export function typeBadge(question) {
  const multiple = question.type === "multiple";
  return `<span class="badge ${multiple ? "badge-multi" : "badge-single"}">${multiple ? "多选" : "单选"}</span>`;
}

export function categoryTone(categoryId) {
  return `tone-${categoryId || "law"}`;
}

export function questionTags(question, max = 3) {
  const tags = (question.tags || [])
    .filter((tag) => tag !== question.category && tag !== question.topic)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, max);
  return tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
}

export function questionMetaHTML(question, { compact = false } = {}) {
  const category = getCategory(question.categoryId);
  return `
    <div class="question-meta">
      ${typeBadge(question)}
      <span class="tag tag-category ${categoryTone(question.categoryId)}">${escapeHtml(category?.short || question.category)}</span>
      <span class="tag tag-topic">${escapeHtml(question.topic)}</span>
      ${compact ? "" : questionTags(question, 2)}
      <span class="question-id">${escapeHtml(question.id)}</span>
    </div>`;
}

export function answerChips(answer = [], { tone = "correct", empty = "未作答" } = {}) {
  if (!answer.length) return `<span class="answer-empty">${escapeHtml(empty)}</span>`;
  return [...answer]
    .sort()
    .map((key) => `<span class="answer-chip answer-${tone}">${escapeHtml(key)}</span>`)
    .join("");
}

export function optionsHTML(
  question,
  { selected = [], reveal = false, disabled = false, exam = false } = {},
) {
  const selectedSet = new Set(selected);
  const answerSet = new Set(question.answer);
  const multiple = question.type === "multiple";

  return question.options
    .map((option) => {
      const isSelected = selectedSet.has(option.key);
      const isAnswer = answerSet.has(option.key);
      const classes = ["option", multiple ? "option-multi" : "option-single"];
      if (isSelected) classes.push("is-selected");
      if (reveal) {
        if (isAnswer) classes.push("is-correct");
        if (isSelected && !isAnswer) classes.push("is-wrong");
        if (!isSelected && !isAnswer) classes.push("is-dim");
      }
      const disabledAttr = disabled || (reveal && !exam) ? "disabled" : "";
      return `
        <button type="button" class="${classes.join(" ")}" data-option="${option.key}" data-qid="${question.id}"
          aria-pressed="${isSelected}" ${disabledAttr}>
          <span class="option-key">${escapeHtml(option.key)}</span>
          <span class="option-text">${escapeHtml(option.text)}</span>
          ${reveal && isAnswer ? `<span class="option-mark option-mark-correct">${icon("check", 15)}</span>` : ""}
          ${reveal && isSelected && !isAnswer ? `<span class="option-mark option-mark-wrong">${icon("x", 15)}</span>` : ""}
        </button>`;
    })
    .join("");
}

export function answerLineHTML(question, selected = [], { showUser = true } = {}) {
  return `
    <div class="answer-line">
      <div class="answer-line-item">
        <span class="answer-label">正确答案</span>
        ${answerChips(question.answer, { tone: "correct" })}
      </div>
      ${showUser ? `
        <div class="answer-line-item">
          <span class="answer-label">你的答案</span>
          ${answerChips(selected, { tone: "user", empty: "未作答" })}
        </div>` : ""}
    </div>`;
}

export function mnemonicHTML(question) {
  const mnemonic = getMnemonic(question);
  if (!mnemonic) {
    return `
      <div class="mnemonic-card mnemonic-empty">
        <div class="mnemonic-icon">${icon("brain", 19)}</div>
        <div>
          <div class="mnemonic-label">AI 速记</div>
          <p>暂无速记语。配置 DeepSeek 后可在 AI 解析中获取。</p>
        </div>
      </div>`;
  }
  return `
    <div class="mnemonic-card">
      <div class="mnemonic-icon">${icon("brain", 19)}</div>
      <div>
        <div class="mnemonic-label">AI 速记</div>
        <p>${escapeHtml(mnemonic)}</p>
      </div>
    </div>`;
}

export function aiAnalysisButton(question, text = "AI 分析") {
  return `<button type="button" class="btn btn-secondary btn-sm" data-analyze="${question.id}">${icon("sparkles", 16)} ${escapeHtml(text)}</button>`;
}

export function resultBannerHTML(question, selected) {
  const correct = sameAnswer(selected, question.answer);
  if (correct) {
    return `
      <div class="result-banner is-success">
        <span class="result-icon">${icon("check", 18)}</span>
        <div>
          <strong>回答正确</strong>
          <p>${question.type === "multiple" ? "所有正确选项完全一致。" : "答案正确，继续保持。"}</p>
        </div>
      </div>`;
  }
  if (!selected.length) {
    return `
      <div class="result-banner is-warning">
        <span class="result-icon">${icon("info", 18)}</span>
        <div>
          <strong>本题未作答</strong>
          <p>标准答案为 ${escapeHtml(answerLabel(question.answer))}。</p>
        </div>
      </div>`;
  }
  return `
    <div class="result-banner is-danger">
      <span class="result-icon">${icon("x", 18)}</span>
      <div>
        <strong>回答错误</strong>
        <p>${question.type === "multiple" ? "多选题必须与标准答案完全一致，少选或多选均不得分。" : `正确答案是 ${escapeHtml(answerLabel(question.answer))}。`}</p>
      </div>
    </div>`;
}

export function questionImageHTML(question) {
  if (!question.image) return "";
  return `
    <figure class="question-figure">
      <button type="button" class="question-image-button" data-lightbox="/${escapeHtml(question.image)}" data-caption="${escapeHtml(question.imageNote || "题目配图")}">
        <img src="/${escapeHtml(question.image)}" alt="${escapeHtml(question.imageNote || "题目配图")}" loading="lazy" />
      </button>
      ${question.imageNote ? `<figcaption>${escapeHtml(question.imageNote)}</figcaption>` : ""}
    </figure>`;
}

export function questionCardHTML(
  question,
  {
    number = question.no,
    selected = [],
    submitted = false,
    review = false,
    showAnswer = false,
    showMnemonic = true,
    showAnalyze = true,
    exam = false,
    actions = "",
    compact = false,
    className = "",
  } = {},
) {
  const reveal = !exam && (submitted || review || showAnswer);
  const showResult = !exam && (submitted || review);
  const correct = sameAnswer(selected, question.answer);

  return `
    <article class="question-card ${className}" data-qid="${question.id}">
      <header class="question-head">
        <div class="question-number">${number ? `第 ${number} 题` : ""}</div>
        ${questionMetaHTML(question, { compact })}
      </header>
      <h2 class="question-title">${escapeHtml(question.question)}</h2>
      ${questionImageHTML(question)}
      <div class="options ${question.type === "multiple" ? "options-multi" : ""}">
        ${optionsHTML(question, { selected, reveal, disabled: reveal && !exam, exam })}
      </div>
      ${showResult ? resultBannerHTML(question, selected) : ""}
      ${reveal ? answerLineHTML(question, selected, { showUser: submitted || review }) : ""}
      ${reveal && showMnemonic ? mnemonicHTML(question) : ""}
      ${reveal && (showAnalyze || actions) ? `
        <footer class="question-actions">
          <div class="question-actions-left">
            ${showAnalyze ? aiAnalysisButton(question) : ""}
            ${correct && review ? `<span class="subtle-note">${icon("check", 14)} 已计入练习记录</span>` : ""}
          </div>
          <div class="question-actions-right">${actions}</div>
        </footer>` : ""}
    </article>`;
}

export function emptyState({ iconName = "info", title = "暂无内容", description = "", action = "" }) {
  return `
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName, 28)}</div>
      <h3>${escapeHtml(title)}</h3>
      ${description ? `<p>${description}</p>` : ""}
      ${action ? `<div class="empty-action">${action}</div>` : ""}
    </div>`;
}

export function progressBar(value, max, className = "") {
  const width = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return `<div class="progress ${className}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><span style="width:${width.toFixed(2)}%"></span></div>`;
}

export function scoreRing(value, { size = 148, label = "", tone = "primary" } = {}) {
  const score = clamp(Number(value) || 0, 0, 100);
  return `
    <div class="score-ring score-${tone}" style="--size:${size}px;--score:${score.toFixed(1)}%">
      <div class="score-ring-inner">
        <strong>${Math.round(score)}<small>%</small></strong>
        ${label ? `<span>${escapeHtml(label)}</span>` : ""}
      </div>
    </div>`;
}

export function statTile({ iconName, label, value, hint = "", tone = "blue", href = "" }) {
  const content = `
    <div class="stat-icon tone-${tone}">${icon(iconName, 20)}</div>
    <div class="stat-content">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${value}</strong>
      ${hint ? `<span class="stat-hint">${hint}</span>` : ""}
    </div>`;
  return href
    ? `<a class="stat-tile" href="${href}">${content}</a>`
    : `<div class="stat-tile">${content}</div>`;
}

/* ---------- Markdown ---------- */

function inlineMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(text = "") {
  const lines = escapeHtml(text).split(/\r?\n/);
  const output = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(line)) {
      closeList();
      output.push(`<h4>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h4>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      closeList();
      output.push(`<h3>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h3>`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      closeList();
      output.push(`<h2>${inlineMarkdown(line.replace(/^#\s+/, ""))}</h2>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (listType !== "ul") {
        closeList();
        output.push("<ul>");
        listType = "ul";
      }
      output.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        closeList();
        output.push("<ol>");
        listType = "ol";
      }
      output.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      output.push("<hr />");
      continue;
    }
    closeList();
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("");
}

/* ---------- AI analysis drawer ---------- */

let currentAnalysis = null;

function buildAnalysisMessages(question) {
  const optionLines = question.options
    .map((option) => `${option.key}. ${option.text}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "你是一名严谨、耐心的中国业余无线电台 A 类操作技术能力验证辅导老师。请用简体中文分析题目，输出 Markdown。" +
        "结构依次为：## 正确答案、## 解题思路、## 选项辨析、## 易错点、## 记忆提示。" +
        "多选要明确说明‘必须与标准答案完全一致，少选、多选均不得分’。事实必须准确，不确定的法规条文不要编造。总字数控制在 650 字以内。",
    },
    {
      role: "user",
      content:
        `【题型】${question.type === "multiple" ? "多选题" : "单选题"}\n` +
        `【分类】${question.category} / ${question.topic}\n` +
        `【题目】${question.question}\n` +
        `【选项】\n${optionLines}\n` +
        `【标准答案】${answerLabel(question.answer)}\n` +
        `【现有速记】${getMnemonic(question) || "无"}\n\n` +
        "请重点解释为什么选这些答案，以及容易混淆的选项。",
    },
  ];
}

export function closeAnalysis() {
  if (!currentAnalysis) return;
  const { layer, controller, onKey, previousFocus } = currentAnalysis;
  currentAnalysis = null;
  if (onKey) document.removeEventListener("keydown", onKey);
  try {
    controller?.abort();
  } catch {
    // Ignore.
  }
  layer.classList.remove("is-visible");
  window.setTimeout(() => {
    layer.remove();
    if (!document.querySelector("#overlay-root > *")) {
      document.body.classList.remove("overlay-open");
    }
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, 180);
}

function analysisErrorText(error) {
  const message = String(error?.message || error || "未知错误");
  if (/401|invalid.*key|api key/i.test(message)) {
    return "API Key 无效或没有权限，请到设置中检查 DeepSeek 配置。";
  }
  if (/429|rate limit/i.test(message)) {
    return "请求过于频繁或额度不足，请稍后再试。";
  }
  if (/404/.test(message)) {
    return "AI 服务暂不可用，请确认站点已正确部署或稍后重试。";
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return "无法连接到 AI 服务，请检查网络或确认站点服务正常运行。";
  }
  return message;
}

export function openAnalysis(questionId, { force = false } = {}) {
  const question = getQuestion(questionId);
  if (!question) {
    toast("没有找到这道题", "error");
    return;
  }
  closeAnalysis();

  const root = document.getElementById("overlay-root");
  if (!root) return;
  const layer = document.createElement("div");
  layer.className = "analysis-layer";
  layer.innerHTML = `
    <div class="analysis-backdrop" data-close-analysis></div>
    <aside class="analysis-drawer" role="dialog" aria-modal="true" aria-label="AI 深度解析">
      <header class="analysis-head">
        <div class="analysis-heading">
          <div class="analysis-mark">${icon("sparkles", 20)}</div>
          <div>
            <strong>AI 深度解析</strong>
            <span>${escapeHtml(question.id)} · ${escapeHtml(question.topic)}</span>
          </div>
        </div>
        <button type="button" class="icon-btn" data-close-analysis aria-label="关闭解析">${icon("x", 20)}</button>
      </header>
      <div class="analysis-question">
        <span class="analysis-question-label">${typeBadge(question)} ${escapeHtml(answerLabel(question.answer) ? `答案 ${answerLabel(question.answer)}` : "")}</span>
        <p>${escapeHtml(question.question)}</p>
      </div>
      <div class="analysis-status" data-analysis-status></div>
      <div class="analysis-body">
        <div class="markdown analysis-content" data-analysis-content></div>
      </div>
      <footer class="analysis-foot">
        <span class="analysis-model">${aiReady() ? `DeepSeek · ${escapeHtml(state.settings.model)}` : "AI 未配置"}</span>
        <div class="analysis-foot-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-analysis-copy>${icon("copy", 15)} 复制</button>
          <button type="button" class="btn btn-secondary btn-sm" data-analysis-force>${icon("rotate", 15)} 重新分析</button>
        </div>
      </footer>
    </aside>`;
  root.appendChild(layer);
  document.body.classList.add("overlay-open");
  requestAnimationFrame(() => layer.classList.add("is-visible"));

  const content = layer.querySelector("[data-analysis-content]");
  const status = layer.querySelector("[data-analysis-status]");
  const controller = new AbortController();
  currentAnalysis = {
    layer,
    controller,
    onKey: null,
    previousFocus: document.activeElement,
  };

  const close = () => closeAnalysis();
  layer.querySelectorAll("[data-close-analysis]").forEach((node) => {
    node.addEventListener("click", close);
  });
  const onKey = (event) => {
    if (event.key === "Escape") {
      close();
    }
  };
  currentAnalysis.onKey = onKey;
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => {
    layer.querySelector(".analysis-head [data-close-analysis]")?.focus({ preventScroll: true });
  });
  layer.addEventListener("click", (event) => {
    if (event.target.closest("[data-analysis-copy]")) {
      copyText(content.innerText || content.textContent || "");
    }
    if (event.target.closest("[data-analysis-force]")) {
      run(true);
    }
  });

  if (!aiReady()) {
    status.innerHTML = `<span class="status-dot is-warning"></span> 尚未配置 DeepSeek`;
    content.innerHTML = `
      <div class="ai-empty">
        <div class="ai-empty-icon">${icon("sparkles", 30)}</div>
        <h3>开启 AI 深度解析</h3>
        <p>配置 DeepSeek API Key 后，可针对每道题在线分析正确答案、错误选项和记忆要点。</p>
        <a class="btn btn-primary" href="#/settings">去配置 API Key ${icon("arrowRight", 16)}</a>
        <span class="ai-empty-note">Key 只保存在你的浏览器，不会被保存到账号或日志。</span>
      </div>`;
    layer.querySelector("[data-analysis-force]")?.remove();
    layer.querySelector("[data-analysis-copy]")?.remove();
    return;
  }

  const cached = !force ? getCachedAnalysis(question.id) : null;
  if (cached?.text) {
    content.innerHTML = renderMarkdown(cached.text);
    status.innerHTML = `<span class="status-dot is-success"></span> 来自本地缓存 · ${formatDateTime(cached.updatedAt)}`;
    return;
  }

  async function run(forceRun = false) {
    if (!currentAnalysis) return;
    if (forceRun) {
      currentAnalysis.controller?.abort();
      const nextController = new AbortController();
      currentAnalysis.controller = nextController;
      return runWithController(nextController);
    }
    return runWithController(currentAnalysis.controller || controller);
  }

  async function runWithController(runController) {
    if (runController.signal.aborted) return;
    content.innerHTML = `
      <div class="ai-loading">
        <span class="typing-dots"><i></i><i></i><i></i></span>
        <p>DeepSeek 正在分析这道题…</p>
        <span>通常需要 3–10 秒</span>
      </div>`;
    status.innerHTML = `<span class="status-dot is-loading"></span> 正在连接 DeepSeek`;
    let text = "";
    try {
      await streamChat({
        messages: buildAnalysisMessages(question),
        model: state.settings.model,
        signal: runController.signal,
        maxTokens: state.settings.model.includes("reasoner") ? 4000 : 1600,
        onDelta: (delta) => {
          text += delta;
          content.innerHTML = `${renderMarkdown(text)}<span class="stream-cursor"></span>`;
          status.innerHTML = `<span class="status-dot is-loading"></span> 正在生成解析…`;
          const body = layer.querySelector(".analysis-body");
          if (body && body.scrollHeight - body.scrollTop - body.clientHeight < 120) {
            body.scrollTop = body.scrollHeight;
          }
        },
      });
      if (runController.signal.aborted) return;
      if (!text.trim()) throw new Error("DeepSeek 返回了空内容，请重试");
      content.innerHTML = renderMarkdown(text);
      status.innerHTML = `<span class="status-dot is-success"></span> 分析完成 · ${formatDateTime(Date.now())}`;
      cacheAnalysis(question.id, text, state.settings.model);
    } catch (error) {
      if (error?.name === "AbortError") return;
      const message = analysisErrorText(error);
      content.innerHTML = `
        <div class="analysis-error">
          <div class="analysis-error-icon">${icon("alert", 22)}</div>
          <div>
            <strong>分析失败</strong>
            <p>${escapeHtml(message)}</p>
            <button type="button" class="btn btn-secondary btn-sm" data-analysis-retry>${icon("rotate", 15)} 重试</button>
          </div>
        </div>`;
      status.innerHTML = `<span class="status-dot is-error"></span> 请求失败`;
      content.querySelector("[data-analysis-retry]")?.addEventListener("click", () => run(true));
    }
  }

  run(false);
}
