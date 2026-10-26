#!/usr/bin/env node
/**
 * Generate one AI mnemonic per question with the DeepSeek API.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-... node scripts/generate_mnemonics.mjs
 *   DEEPSEEK_API_KEY=sk-... node scripts/generate_mnemonics.mjs --force
 *   DEEPSEEK_API_KEY=sk-... node scripts/generate_mnemonics.mjs --topic op-2-4 --limit 20
 *
 * By default it only fills questions whose mnemonic is empty. The bundled
 * questions.json already has mnemonics for all 683 questions; this script is
 * for regenerating them after rebuilding the PDF bank.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(name);

const questionsPath = path.resolve(getArg("--questions", "data/questions.json"));
const outPath = path.resolve(getArg("--out", questionsPath));
const apiKey = getArg("--key", process.env.DEEPSEEK_API_KEY || "");
const model = getArg("--model", "deepseek-flash");
const baseUrl = getArg("--base-url", "https://api.deepseek.com");
const topic = getArg("--topic", "");
const limit = Number(getArg("--limit", "0")) || 0;
const concurrency = Math.max(1, Math.min(Number(getArg("--concurrency", "3")) || 3, 8));
const force = hasFlag("--force");
const dryRun = hasFlag("--dry-run");

function endpointFrom(base) {
  const parsed = new URL(base);
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/chat/completions")) pathname += "/chat/completions";
  parsed.pathname = pathname;
  parsed.search = "";
  return parsed.toString();
}

function buildPrompt(question) {
  const options = question.options.map((option) => `${option.key}. ${option.text}`).join("\n");
  return `你是一名中国业余无线电台 A 类操作技术能力验证辅导老师。请为下面这道题写一句中文速记语，帮助考生记住正确答案。

要求：
- 只输出速记语本身，不要解释、不要引号、不要换行。
- 12–32 个汉字，可以保留必要的英文术语、频率或字母。
- 必须准确对应标准答案；多选题要兼顾全部正确选项。
- 尽量具体、口诀化，避免“认真审题”这类空话。

【题型】${question.type === "multiple" ? "多选" : "单选"}
【分类】${question.category} / ${question.topic}
【题目】${question.question}
【选项】
${options}
【标准答案】${question.answer.join("、")}`;
}

async function requestMnemonic(question, attempt = 1) {
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: "你只输出一句中文速记语，不输出任何其他内容。",
      },
      { role: "user", content: buildPrompt(question) },
    ],
    max_tokens: model.includes("reasoner") ? 1200 : 120,
    stream: false,
  };
  if (!model.includes("reasoner")) requestBody.temperature = 0.45;

  const response = await fetch(endpointFrom(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message || text;
    } catch {
      // Keep raw text.
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const wait = attempt * 1500;
      console.warn(`  retry ${attempt} in ${wait}ms (HTTP ${response.status})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return requestMnemonic(question, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}: ${message.slice(0, 180)}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || "";
  const cleaned = text
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  if (!cleaned) throw new Error("empty response");
  return cleaned.slice(0, 90);
}

async function main() {
  const data = JSON.parse(await readFile(questionsPath, "utf8"));
  let questions = data.questions.filter((question) => (force ? true : !question.mnemonic));
  if (topic) questions = questions.filter((question) => question.topicId === topic);
  if (limit > 0) questions = questions.slice(0, limit);

  console.log(`Questions to process: ${questions.length}`);
  if (dryRun) {
    questions.slice(0, 8).forEach((question) => console.log(`  ${question.id} ${question.question.slice(0, 50)}`));
    return;
  }
  if (!questions.length) {
    console.log("Nothing to do. Use --force to regenerate existing mnemonics.");
    return;
  }
  if (!apiKey) {
    console.error("Missing DeepSeek API key. Set DEEPSEEK_API_KEY or pass --key.");
    process.exit(1);
  }

  let cursor = 0;
  let completed = 0;
  let failed = 0;
  const byId = new Map(data.questions.map((question) => [question.id, question]));

  async function worker() {
    while (cursor < questions.length) {
      const index = cursor;
      cursor += 1;
      const question = questions[index];
      try {
        const mnemonic = await requestMnemonic(question);
        byId.get(question.id).mnemonic = mnemonic;
        completed += 1;
        console.log(`[${completed + failed}/${questions.length}] ${question.id} ${mnemonic}`);
      } catch (error) {
        failed += 1;
        console.warn(`[${completed + failed}/${questions.length}] ${question.id} failed: ${error.message}`);
      }
      if ((completed + failed) % 10 === 0) {
        await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Done. updated=${completed}, failed=${failed}, file=${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
