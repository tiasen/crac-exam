/* Question data, filters, progress statistics and session finalization. */

import {
  answerLabel,
  dateKey,
  notifyShell,
  runtime,
  sameAnswer,
  saveState,
  shuffle,
  state,
  unique,
} from "./core.js";

export const data = {
  meta: null,
  questions: [],
  byId: new Map(),
  categories: [],
  topics: [],
  categoryById: new Map(),
  topicById: new Map(),
};

export async function loadQuestionData() {
  const response = await fetch("/data/questions.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`题库加载失败（HTTP ${response.status}）`);
  const payload = await response.json();
  if (!payload?.questions?.length) throw new Error("题库 JSON 中没有题目");

  data.meta = payload.meta;
  data.questions = payload.questions;
  data.byId = new Map(payload.questions.map((question) => [question.id, question]));
  data.categories = payload.meta.categories || [];
  data.topics = payload.meta.topics || [];
  data.categoryById = new Map(data.categories.map((category) => [category.id, category]));
  data.topicById = new Map(data.topics.map((topic) => [topic.id, topic]));
  runtime.dataVersion = `${payload.meta.version || "1"}-${payload.meta.generatedAt || ""}`;
  return data;
}

export function getQuestion(questionId) {
  return data.byId.get(questionId) || null;
}

export function getMnemonic(question) {
  if (!question) return "";
  return state.mnemonicOverrides[question.id] || question.mnemonic || "";
}

export function getCategory(categoryId) {
  return data.categoryById.get(categoryId) || null;
}

export function getTopic(topicId) {
  return data.topicById.get(topicId) || null;
}

export function questionsByCategory(categoryId) {
  return data.questions.filter((question) => question.categoryId === categoryId);
}

export function questionsByTopic(topicId) {
  return data.questions.filter((question) => question.topicId === topicId);
}

function matchesSearch(question, needle) {
  if (!needle) return true;
  const haystack = [
    question.id,
    question.sourceId || "",
    question.question,
    question.topic,
    question.category,
    ...question.tags,
    ...question.options.map((option) => option.text),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterQuestions({
  search = "",
  categoryId = "",
  topicId = "",
  type = "",
} = {}) {
  const needle = search.trim().toLowerCase();
  return data.questions.filter((question) => {
    if (categoryId && question.categoryId !== categoryId) return false;
    if (topicId && question.topicId !== topicId) return false;
    if (type && question.type !== type) return false;
    return matchesSearch(question, needle);
  });
}

export function selectQuestions({
  categoryIds = [],
  topicId = "",
  types = [],
  onlyWrong = false,
  count = 20,
  order = "random",
} = {}) {
  const categorySet = new Set(categoryIds);
  const typeSet = new Set(types);
  const wrongSet = new Set(
    Object.entries(state.wrong)
      .filter(([, entry]) => !entry.mastered)
      .map(([id]) => id),
  );

  let pool = data.questions.filter((question) => {
    if (categorySet.size && !categorySet.has(question.categoryId)) return false;
    if (topicId && question.topicId !== topicId) return false;
    if (typeSet.size && !typeSet.has(question.type)) return false;
    if (onlyWrong && !wrongSet.has(question.id)) return false;
    return true;
  });

  pool =
    order === "sequence"
      ? [...pool].sort((a, b) => a.no - b.no)
      : shuffle(pool);

  if (count !== "all") {
    const limit = Math.max(0, Number(count) || 0);
    pool = pool.slice(0, limit);
  }
  return pool;
}

export function getWrongEntries({
  status = "active",
  categoryId = "",
  search = "",
  sort = "recent",
} = {}) {
  const needle = search.trim().toLowerCase();
  const entries = Object.entries(state.wrong)
    .map(([id, entry]) => ({ id, question: getQuestion(id), meta: entry }))
    .filter((entry) => entry.question)
    .filter(({ meta }) => {
      if (status === "active") return !meta.mastered;
      if (status === "mastered") return Boolean(meta.mastered);
      return true;
    })
    .filter(({ question }) => !categoryId || question.categoryId === categoryId)
    .filter(({ question }) => matchesSearch(question, needle));

  if (sort === "count") {
    entries.sort((a, b) => (b.meta.count || 0) - (a.meta.count || 0));
  } else if (sort === "oldest") {
    entries.sort((a, b) => (a.meta.lastAt || 0) - (b.meta.lastAt || 0));
  } else {
    entries.sort((a, b) => (b.meta.lastAt || 0) - (a.meta.lastAt || 0));
  }
  return entries;
}

export function getWrongCount() {
  return Object.values(state.wrong).filter((entry) => !entry.mastered).length;
}

export function getMasteredCount() {
  return Object.values(state.wrong).filter((entry) => entry.mastered).length;
}

export function markMastered(questionId, mastered = true) {
  const entry = state.wrong[questionId];
  if (!entry) return;
  entry.mastered = Boolean(mastered);
  entry.masteredAt = mastered ? Date.now() : null;
  if (!mastered) entry.correctStreak = 0;
  saveState();
  notifyShell();
}

export function deleteWrongEntry(questionId) {
  delete state.wrong[questionId];
  saveState();
  notifyShell();
}

function recordWrong(questionId, answer = []) {
  const entry = state.wrong[questionId] || {
    count: 0,
    correctStreak: 0,
    firstAt: Date.now(),
  };
  entry.count = (entry.count || 0) + 1;
  entry.lastAnswer = [...answer].sort();
  entry.lastAt = Date.now();
  entry.mastered = false;
  entry.masteredAt = null;
  entry.correctStreak = 0;
  state.wrong[questionId] = entry;
}

function recordCorrect(questionId) {
  const entry = state.wrong[questionId];
  if (!entry || entry.mastered) return;
  entry.correctStreak = (entry.correctStreak || 0) + 1;
  entry.lastCorrectAt = Date.now();
}

export function getLatestAttempts() {
  const attempts = new Map();
  const records = [...state.records].sort((a, b) => a.finishedAt - b.finishedAt);
  for (const record of records) {
    for (const [questionId, result] of Object.entries(record.results || {})) {
      attempts.set(questionId, { ...result, at: record.finishedAt, recordId: record.id });
    }
  }
  return attempts;
}

function calculateStreak(records) {
  if (!records.length) return 0;
  const days = new Set(records.map((record) => dateKey(record.finishedAt)));
  const cursor = new Date();
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(dateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

export function getStats() {
  const attempts = getLatestAttempts();
  const records = state.records;
  let practiced = 0;
  let totalAnswered = 0;
  let totalCorrect = 0;
  for (const [questionId, result] of attempts) {
    if (!getQuestion(questionId) || !result.attempted) continue;
    practiced += 1;
  }
  for (const record of records) {
    for (const result of Object.values(record.results || {})) {
      if (!result.attempted) continue;
      totalAnswered += 1;
      if (result.correct) totalCorrect += 1;
    }
  }
  const exams = records.filter((record) => record.kind === "exam");
  const passedExams = exams.filter((record) => record.passed === true).length;
  const today = dateKey();
  let todayAnswered = 0;
  for (const record of records) {
    if (dateKey(record.finishedAt) !== today) continue;
    for (const result of Object.values(record.results || {})) {
      if (result.attempted) todayAnswered += 1;
    }
  }

  const categoryProgress = data.categories.map((category) => {
    const questions = questionsByCategory(category.id);
    let attempted = 0;
    let correct = 0;
    for (const question of questions) {
      const result = attempts.get(question.id);
      if (!result?.attempted) continue;
      attempted += 1;
      if (result.correct) correct += 1;
    }
    return {
      ...category,
      attempted,
      correct,
      accuracy: attempted ? (correct / attempted) * 100 : 0,
      coverage: questions.length ? (attempted / questions.length) * 100 : 0,
    };
  });

  const topicProgress = data.topics
    .map((topic) => {
      const questions = questionsByTopic(topic.id);
      let attempted = 0;
      let correct = 0;
      for (const question of questions) {
        const result = attempts.get(question.id);
        if (!result?.attempted) continue;
        attempted += 1;
        if (result.correct) correct += 1;
      }
      return {
        ...topic,
        attempted,
        correct,
        accuracy: attempted ? (correct / attempted) * 100 : 0,
      };
    })
    .filter((topic) => topic.attempted > 0);

  const weakTopics = [...topicProgress]
    .filter((topic) => topic.accuracy < 85 && topic.attempted >= 3)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)
    .slice(0, 4);

  return {
    totalQuestions: data.questions.length,
    practiced,
    coverage: data.questions.length ? (practiced / data.questions.length) * 100 : 0,
    totalAnswered,
    totalCorrect,
    accuracy: totalAnswered ? (totalCorrect / totalAnswered) * 100 : 0,
    wrongCount: getWrongCount(),
    masteredCount: getMasteredCount(),
    examCount: exams.length,
    passedExams,
    examPassRate: exams.length ? (passedExams / exams.length) * 100 : 0,
    todayAnswered,
    streak: calculateStreak(records),
    categoryProgress,
    topicProgress,
    weakTopics,
    attempts,
  };
}

export function getRecord(recordId) {
  return state.records.find((record) => record.id === recordId) || null;
}

export function getRecentRecords(limit = 5) {
  return state.records.slice(0, limit);
}

export function deleteRecord(recordId) {
  state.records = state.records.filter((record) => record.id !== recordId);
  saveState();
  notifyShell();
}

export function clearRecords() {
  state.records = [];
  saveState();
  notifyShell();
}

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function sessionProgress(session) {
  if (!session) return { answered: 0, correct: 0, total: 0, accuracy: 0 };
  const total = session.questionIds.length;
  let answered = 0;
  let correct = 0;
  if (session.kind === "practice") {
    for (const questionId of Object.keys(session.submitted || {})) {
      const question = getQuestion(questionId);
      if (!question) continue;
      answered += 1;
      if (sameAnswer(session.answers[questionId] || [], question.answer)) correct += 1;
    }
  } else {
    for (const questionId of session.questionIds) {
      const answer = session.answers[questionId] || [];
      if (!answer.length) continue;
      answered += 1;
      const question = getQuestion(questionId);
      if (question && sameAnswer(answer, question.answer)) correct += 1;
    }
  }
  return {
    answered,
    correct,
    total,
    accuracy: answered ? (correct / answered) * 100 : 0,
  };
}

export function finalizeSession(session) {
  if (!session) throw new Error("没有可提交的答题会话");
  if (session.finished && session.recordId) {
    const existing = getRecord(session.recordId);
    if (existing) return existing;
  }

  const questionIds = unique(session.questionIds || []);
  const results = {};
  let correct = 0;
  let attempted = 0;

  for (const questionId of questionIds) {
    const question = getQuestion(questionId);
    if (!question) continue;
    const answer = [...(session.answers?.[questionId] || [])].map(String).sort();
    const wasAttempted = answer.length > 0;
    const isCorrect = sameAnswer(answer, question.answer);
    if (isCorrect) correct += 1;
    if (wasAttempted) attempted += 1;
    results[questionId] = {
      answer,
      correct: isCorrect,
      attempted: wasAttempted,
    };
    if (isCorrect) {
      recordCorrect(questionId);
    } else if (session.kind === "exam" || wasAttempted) {
      recordWrong(questionId, answer);
    }
  }

  const total = questionIds.length;
  const finishedAt = Date.now();
  const passPercent =
    session.kind === "exam"
      ? Number(session.config?.passPercent ?? state.settings.exam.passPercent ?? 75)
      : null;
  const record = {
    id: makeId("rec"),
    sessionId: session.id,
    kind: session.kind === "exam" ? "exam" : "practice",
    label:
      session.label ||
      (session.kind === "exam" ? "模拟考试" : "综合练习"),
    startedAt: session.startedAt || finishedAt,
    finishedAt,
    durationSec: Math.max(1, Math.round((finishedAt - (session.startedAt || finishedAt)) / 1000)),
    questionIds,
    results,
    total,
    attempted,
    correct,
    accuracy: total ? (correct / total) * 100 : 0,
    passPercent,
    passed:
      passPercent === null ? null : total > 0 && (correct / total) * 100 >= passPercent - 1e-9,
    config: session.config || {},
  };

  session.finished = true;
  session.recordId = record.id;
  state.records.unshift(record);
  if (state.records.length > 120) state.records.length = 120;
  if (session.kind === "practice") {
    state.activePractice = null;
  } else {
    state.activeExam = null;
  }
  saveState();
  notifyShell();
  return record;
}

export function recordAnswerLabel(record, questionId) {
  return answerLabel(record.results?.[questionId]?.answer || []);
}

export function recordTagSummary(record) {
  const config = record.config || {};
  const labels = [];
  if (record.kind !== "exam") {
    if (config.onlyWrong) {
      labels.push("错题重练");
    } else if (config.label) {
      labels.push(config.label);
    }
  }
  if (config.topicName) labels.push(config.topicName);
  if (config.categoryNames?.length) labels.push(...config.categoryNames.slice(0, 2));
  return unique(labels).slice(0, 3);
}

export function recordStatusText(record) {
  if (record.kind === "exam") return record.passed ? "合格" : "未合格";
  return `${Math.round(record.accuracy)}% 正确率`;
}
