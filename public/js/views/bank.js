/* Question bank browser with search and tag filters. */

import { debounce, escapeHtml, icon } from "../core.js";
import { data, filterQuestions, getTopic } from "../data.js";
import {
  aiAnalysisButton,
  answerLineHTML,
  emptyState,
  mnemonicHTML,
  optionsHTML,
  questionImageHTML,
  questionMetaHTML,
} from "../components.js";

const PAGE_SIZE = 30;

let filters = {
  search: "",
  categoryId: "",
  topicId: "",
  type: "",
};
let page = 1;

function topicOptionsHTML() {
  const topics = data.topics.filter(
    (topic) => !filters.categoryId || topic.categoryId === filters.categoryId,
  );
  return `<option value="">全部知识点</option>${topics
    .map(
      (topic) =>
        `<option value="${topic.id}" ${filters.topicId === topic.id ? "selected" : ""}>${escapeHtml(topic.name)}（${topic.count}）</option>`,
    )
    .join("")}`;
}

function bankCardHTML(question) {
  return `
    <article class="bank-card card" data-qid="${question.id}">
      <header class="bank-card-head">
        <div class="bank-card-meta">${questionMetaHTML(question)}</div>
        <span class="bank-number">#${question.no}</span>
      </header>
      <h3 class="bank-question">${escapeHtml(question.question)}</h3>
      ${questionImageHTML(question)}
      <details class="answer-details bank-answer">
        <summary>查看选项、答案与速记 ${icon("chevronDown", 16)}</summary>
        <div class="answer-details-body">
          <div class="options options-review">${optionsHTML(question, { selected: [], reveal: true, disabled: true })}</div>
          ${answerLineHTML(question, [], { showUser: false })}
          ${mnemonicHTML(question)}
          <div class="answer-details-actions">${aiAnalysisButton(question)}</div>
        </div>
      </details>
    </article>`;
}

function paintResults(root) {
  const results = filterQuestions(filters);
  const visible = results.slice(0, page * PAGE_SIZE);
  const list = root.querySelector("#bank-list");
  const count = root.querySelector("#bank-count");
  const more = root.querySelector("#bank-more");
  if (count) count.textContent = `共 ${results.length} 道题`;
  if (list) {
    list.innerHTML = visible.length
      ? visible.map(bankCardHTML).join("")
      : emptyState({
          iconName: "search",
          title: "没有找到匹配的题目",
          description: "试试更换关键词、分类或题型。",
          action: `<button type="button" class="btn btn-secondary btn-sm" data-action="reset-filters">清空筛选</button>`,
        });
  }
  if (more) {
    const remaining = results.length - visible.length;
    more.hidden = remaining <= 0;
    more.innerHTML = remaining > 0 ? `加载更多（剩余 ${remaining} 道）${icon("chevronDown", 16)}` : "";
  }
}

function syncTopicSelect(root) {
  const select = root.querySelector("#bank-topic");
  if (!select) return;
  select.innerHTML = topicOptionsHTML();
}

function syncControls(root) {
  const search = root.querySelector("#bank-search");
  const category = root.querySelector("#bank-category");
  const type = root.querySelector("#bank-type");
  if (search && search.value !== filters.search) search.value = filters.search;
  if (category) category.value = filters.categoryId;
  if (type) type.value = filters.type;
  syncTopicSelect(root);
}

export function renderBank(root, params = new URLSearchParams()) {
  const categoryParam = params.get("category");
  const topicParam = params.get("topic");
  const typeParam = params.get("type");
  const searchParam = params.get("q");

  if (categoryParam) {
    filters.categoryId = categoryParam;
    filters.topicId = "";
  }
  if (topicParam) {
    const topic = getTopic(topicParam);
    if (topic) {
      filters.topicId = topic.id;
      filters.categoryId = topic.categoryId;
    }
  }
  if (typeParam === "single" || typeParam === "multiple") filters.type = typeParam;
  if (searchParam !== null) filters.search = searchParam;
  if (filters.topicId) {
    const topic = getTopic(filters.topicId);
    if (topic && filters.categoryId && topic.categoryId !== filters.categoryId) {
      filters.topicId = "";
    }
  }
  page = 1;

  root.innerHTML = `
    <div class="page bank-page">
      <header class="page-head">
        <div>
          <span class="section-kicker">Question bank</span>
          <h2>题库浏览</h2>
          <p>683 道题已按法规、操作、设备、理论和安全分类。支持全文搜索和知识点筛选。</p>
        </div>
        <div class="page-head-badge">${icon("library", 18)} ${data.meta.total} 道题</div>
      </header>

      <section class="card filter-card bank-filter">
        <div class="search-field search-field-large">
          ${icon("search", 18)}
          <input type="search" id="bank-search" placeholder="搜索题干、选项、题号或标签…" autocomplete="off" value="${escapeHtml(filters.search)}" />
          <kbd>搜索</kbd>
        </div>
        <div class="filter-row">
          <div class="select-wrap select-compact">
            ${icon("layers", 16)}
            <select id="bank-category" class="select">
              <option value="">全部分类</option>
              ${data.categories
                .map(
                  (category) =>
                    `<option value="${category.id}" ${filters.categoryId === category.id ? "selected" : ""}>${escapeHtml(category.name)}（${category.count}）</option>`,
                )
                .join("")}
            </select>
            ${icon("chevronDown", 15)}
          </div>
          <div class="select-wrap select-compact">
            ${icon("tag", 16)}
            <select id="bank-topic" class="select">${topicOptionsHTML()}</select>
            ${icon("chevronDown", 15)}
          </div>
          <div class="select-wrap select-compact">
            ${icon("practice", 16)}
            <select id="bank-type" class="select">
              <option value="">全部题型</option>
              <option value="single" ${filters.type === "single" ? "selected" : ""}>单选</option>
              <option value="multiple" ${filters.type === "multiple" ? "selected" : ""}>多选</option>
            </select>
            ${icon("chevronDown", 15)}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="reset-filters">${icon("rotate", 15)} 重置</button>
          <span class="filter-count" id="bank-count"></span>
        </div>
      </section>

      <div id="bank-list" class="bank-list"></div>
      <div class="load-more-wrap">
        <button type="button" class="btn btn-secondary" id="bank-more" data-action="load-more"></button>
      </div>
    </div>`;

  const updateSearch = debounce(() => {
    filters.search = root.querySelector("#bank-search")?.value || "";
    page = 1;
    paintResults(root);
  }, 220);

  const onChange = (event) => {
    if (event.target.id === "bank-category") {
      filters.categoryId = event.target.value;
      if (filters.topicId) {
        const topic = getTopic(filters.topicId);
        if (topic && topic.categoryId !== filters.categoryId) filters.topicId = "";
      }
      syncTopicSelect(root);
      page = 1;
      paintResults(root);
      return;
    }
    if (event.target.id === "bank-topic") {
      filters.topicId = event.target.value;
      if (filters.topicId) {
        const topic = getTopic(filters.topicId);
        if (topic && !filters.categoryId) {
          filters.categoryId = topic.categoryId;
          const categorySelect = root.querySelector("#bank-category");
          if (categorySelect) categorySelect.value = filters.categoryId;
          syncTopicSelect(root);
        }
      }
      page = 1;
      paintResults(root);
      return;
    }
    if (event.target.id === "bank-type") {
      filters.type = event.target.value;
      page = 1;
      paintResults(root);
    }
  };

  const onInput = (event) => {
    if (event.target.id === "bank-search") updateSearch();
  };

  const onClick = (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "load-more") {
      page += 1;
      paintResults(root);
      return;
    }
    if (action.dataset.action === "reset-filters") {
      filters = { search: "", categoryId: "", topicId: "", type: "" };
      page = 1;
      syncControls(root);
      paintResults(root);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  paintResults(root);

  return () => {
    updateSearch.cancel?.();
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    root.innerHTML = "";
  };
}
