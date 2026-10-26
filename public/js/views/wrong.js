/* Wrong-answer notebook. */

import {
  debounce,
  escapeHtml,
  icon,
  relativeTime,
  state,
  toast,
} from "../core.js";
import {
  data,
  getCategory,
  getMasteredCount,
  getWrongCount,
  getWrongEntries,
  markMastered,
} from "../data.js";
import {
  aiAnalysisButton,
  answerLineHTML,
  emptyState,
  mnemonicHTML,
  optionsHTML,
  questionImageHTML,
  typeBadge,
} from "../components.js";
import { startPracticeWithIds } from "./practice.js";

let filters = {
  status: "active",
  categoryId: "",
  search: "",
  sort: "recent",
};

function wrongCardHTML(entry) {
  const { id, question, meta } = entry;
  const mastered = Boolean(meta.mastered);
  return `
    <article class="wrong-card card" data-qid="${id}">
      <header class="wrong-head">
        <div class="wrong-meta">
          ${typeBadge(question)}
          <span class="tag tag-category tone-${question.categoryId}">${escapeHtml(getCategory(question.categoryId)?.short || question.category)}</span>
          <span class="tag">${escapeHtml(question.topic)}</span>
        </div>
        <div class="wrong-stat">
          <span class="wrong-count">${icon("wrong", 14)} 错 ${meta.count || 1} 次</span>
          <span class="wrong-time">${relativeTime(meta.lastAt)}</span>
        </div>
      </header>
      <h3 class="wrong-question">${escapeHtml(question.question)}</h3>
      ${questionImageHTML(question)}
      <div class="wrong-subline">
        <span>${escapeHtml(question.id)}</span>
        ${meta.correctStreak ? `<span class="streak-chip">${icon("flame", 13)} 已连对 ${meta.correctStreak} 次</span>` : ""}
        ${mastered ? `<span class="badge badge-pass">${icon("check", 13)} 已掌握</span>` : ""}
      </div>
      <details class="answer-details">
        <summary>查看答案、选项与速记 ${icon("chevronDown", 16)}</summary>
        <div class="answer-details-body">
          <div class="options options-review">${optionsHTML(question, { selected: meta.lastAnswer || [], reveal: true, disabled: true })}</div>
          ${answerLineHTML(question, meta.lastAnswer || [])}
          ${mnemonicHTML(question)}
          <div class="answer-details-actions">${aiAnalysisButton(question)}</div>
        </div>
      </details>
      <footer class="wrong-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="practice-one" data-id="${id}">${icon("play", 15)} 练这道</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="toggle-mastered" data-id="${id}" data-mastered="${mastered ? "1" : "0"}">
          ${mastered ? `${icon("rotate", 15)} 移回错题` : `${icon("check", 15)} 标记已掌握`}
        </button>
        <span class="wrong-actions-note">${mastered ? "已掌握题目默认不再出现" : "连续答对后仍建议手动移出"}</span>
      </footer>
    </article>`;
}

function listHTML() {
  const entries = getWrongEntries(filters);
  if (!entries.length) {
    const isSearch = Boolean(filters.search || filters.categoryId);
    return emptyState({
      iconName: "wrong",
      title: isSearch ? "没有匹配的错题" : filters.status === "mastered" ? "还没有已掌握的错题" : "错题本还是空的",
      description: isSearch
        ? "试试更换分类或清空搜索关键词。"
        : filters.status === "mastered"
          ? "把错题练熟后，可以手动标记为已掌握。"
          : "答错的题目会自动收进这里，方便集中攻克。",
      action: isSearch
        ? `<button type="button" class="btn btn-secondary btn-sm" data-action="clear-filters">清空筛选</button>`
        : `<a class="btn btn-primary btn-sm" href="#/practice">去练习 ${icon("arrowRight", 15)}</a>`,
    });
  }
  return entries.map(wrongCardHTML).join("");
}

function statsHTML() {
  const totalMistakes = Object.values(state.wrong).reduce(
    (sum, entry) => sum + (entry.count || 0),
    0,
  );
  return `
    <div class="wrong-stats">
      <div class="mini-stat"><span>待攻克</span><strong>${getWrongCount()}</strong></div>
      <div class="mini-stat"><span>已掌握</span><strong>${getMasteredCount()}</strong></div>
      <div class="mini-stat"><span>错误总数</span><strong>${totalMistakes}</strong></div>
    </div>`;
}

function paintList(root) {
  const entries = getWrongEntries(filters);
  const list = root.querySelector("#wrong-list");
  if (list) list.innerHTML = listHTML();
  const count = root.querySelector("#wrong-result-count");
  if (count) count.textContent = `共 ${entries.length} 道`;
  const bulk = root.querySelector("[data-action='practice-all']");
  if (bulk) {
    bulk.disabled = entries.length === 0;
    bulk.innerHTML = `${icon("play", 16)} 重练当前 ${entries.length} 道`;
  }
  const stats = root.querySelector("#wrong-stats");
  if (stats) stats.innerHTML = statsHTML();
  const tabs = root.querySelectorAll("[data-status]");
  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.status === filters.status);
    const status = tab.dataset.status;
    const value =
      status === "active" ? getWrongCount() : status === "mastered" ? getMasteredCount() : getWrongCount() + getMasteredCount();
    const badge = tab.querySelector("b");
    if (badge) badge.textContent = value;
  });
}

export function renderWrong(root) {
  root.innerHTML = `
    <div class="page wrong-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">Mistakes</span>
          <h2>错题本</h2>
          <p>答错的题会自动记录。弄懂后手动移出，别让错题一直躺在列表里。</p>
        </div>
        <button type="button" class="btn btn-primary btn-md" data-action="practice-all" ${getWrongEntries(filters).length ? "" : "disabled"}>
          ${icon("play", 16)} 重练当前 0 道
        </button>
      </header>

      <div id="wrong-stats">${statsHTML()}</div>

      <section class="card filter-card">
        <div class="filter-top">
          <div class="tabs" role="tablist" aria-label="错题状态">
            <button type="button" class="tab" data-status="active">待攻克 <b>${getWrongCount()}</b></button>
            <button type="button" class="tab" data-status="mastered">已掌握 <b>${getMasteredCount()}</b></button>
            <button type="button" class="tab" data-status="all">全部 <b>${getWrongCount() + getMasteredCount()}</b></button>
          </div>
          <span class="filter-count" id="wrong-result-count"></span>
        </div>
        <div class="filter-row">
          <div class="search-field">
            ${icon("search", 17)}
            <input type="search" id="wrong-search" placeholder="搜索题目、选项、标签…" autocomplete="off" value="${escapeHtml(filters.search)}" />
          </div>
          <div class="select-wrap select-compact">
            ${icon("layers", 16)}
            <select id="wrong-category" class="select">
              <option value="">全部分类</option>
              ${data.categories
                .map(
                  (category) =>
                    `<option value="${category.id}" ${filters.categoryId === category.id ? "selected" : ""}>${escapeHtml(category.short)}（${category.count}）</option>`,
                )
                .join("")}
            </select>
            ${icon("chevronDown", 15)}
          </div>
          <div class="select-wrap select-compact">
            ${icon("chart", 16)}
            <select id="wrong-sort" class="select">
              <option value="recent" ${filters.sort === "recent" ? "selected" : ""}>最近错误</option>
              <option value="count" ${filters.sort === "count" ? "selected" : ""}>错误次数</option>
              <option value="oldest" ${filters.sort === "oldest" ? "selected" : ""}>最早错误</option>
            </select>
            ${icon("chevronDown", 15)}
          </div>
        </div>
      </section>

      <div id="wrong-list" class="wrong-list">${listHTML()}</div>
    </div>`;

  const updateSearch = debounce(() => {
    filters.search = root.querySelector("#wrong-search")?.value || "";
    paintList(root);
  }, 220);

  const onChange = (event) => {
    if (event.target.id === "wrong-category") {
      filters.categoryId = event.target.value;
      paintList(root);
    }
    if (event.target.id === "wrong-sort") {
      filters.sort = event.target.value;
      paintList(root);
    }
  };

  const onInput = (event) => {
    if (event.target.id === "wrong-search") updateSearch();
  };

  const onClick = (event) => {
    const tab = event.target.closest("[data-status]");
    if (tab) {
      filters.status = tab.dataset.status;
      paintList(root);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;

    if (action.dataset.action === "clear-filters") {
      filters = { status: "active", categoryId: "", search: "", sort: "recent" };
      const searchInput = root.querySelector("#wrong-search");
      const categorySelect = root.querySelector("#wrong-category");
      const sortSelect = root.querySelector("#wrong-sort");
      if (searchInput) searchInput.value = "";
      if (categorySelect) categorySelect.value = "";
      if (sortSelect) sortSelect.value = "recent";
      paintList(root);
      return;
    }
    if (action.dataset.action === "practice-one") {
      const session = startPracticeWithIds([action.dataset.id], {
        label: "错题重练",
        config: { label: "错题重练", onlyWrong: true },
      });
      if (session) window.location.hash = "/practice";
      return;
    }
    if (action.dataset.action === "practice-all") {
      const entries = getWrongEntries(filters);
      if (!entries.length) {
        toast("当前筛选下没有错题", "info");
        return;
      }
      const session = startPracticeWithIds(
        entries.map((entry) => entry.id),
        {
          label: "错题重练",
          config: {
            label: "错题重练",
            onlyWrong: true,
            categoryNames: data.categories
              .filter((category) => !filters.categoryId || category.id === filters.categoryId)
              .map((category) => category.short),
          },
        },
      );
      if (session) window.location.hash = "/practice";
      return;
    }
    if (action.dataset.action === "toggle-mastered") {
      const id = action.dataset.id;
      const currentlyMastered = action.dataset.mastered === "1";
      markMastered(id, !currentlyMastered);
      toast(currentlyMastered ? "已移回错题本" : "已标记为掌握", "success");
      paintList(root);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  paintList(root);

  return () => {
    updateSearch.cancel?.();
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    root.innerHTML = "";
  };
}
