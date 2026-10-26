#!/usr/bin/env python3
"""Convert the A-class amateur radio question bank PDF into structured JSON.

Usage:
    python3 scripts/pdf_to_json.py A类题库.pdf data/questions.json

Requires: pypdf (pip install pypdf)
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

from pypdf import PdfReader

PAGE_MARK_RE = re.compile(r"\n?===== PAGE \d+ =====\n?")
FIELD_RE = re.compile(r"^\[([A-Z])\](.*)$")
CJK_RE = re.compile(r"[\u3400-\u9fff]")
SPACE_AROUND_PUNCT_RE = re.compile(r"\s+([，。；：、！？）》”’])")
SPACE_AFTER_OPEN_RE = re.compile(r"([（《“‘])\s+")

CATEGORY_DEFS = {
    "1": {
        "id": "law",
        "name": "法律法规类",
        "short": "法律法规",
        "description": "无线电管理法规、电台设置与执照、呼号、使用规范、法律责任与频率划分。",
    },
    "2": {
        "id": "operation",
        "name": "电台操作类",
        "short": "电台操作",
        "description": "频段规划、呼叫与通联程序、英语通话、Q 简语、调制方式与数字通信。",
    },
    "3": {
        "id": "equipment",
        "name": "设备天线类",
        "short": "设备天线",
        "description": "收发信机、天线与馈线、收发信机指标、业余卫星与弱信号通信。",
    },
    "4": {
        "id": "theory",
        "name": "理论基础类",
        "short": "理论基础",
        "description": "电工与无线电基础、电子元件、测量方法与仪表使用。",
    },
    "5": {
        "id": "safety",
        "name": "安全规范类",
        "short": "安全规范",
        "description": "电磁环境、防雷接地、用电安全、电池安全与火灾处置。",
    },
}

TOPIC_DEFS = {
    "1.1": ("law-1-1", "无线电管理法规"),
    "1.2": ("law-1-2", "电台设置与执照"),
    "1.3": ("law-1-3", "操作能力验证"),
    "1.4": ("law-1-4", "呼号管理"),
    "1.5": ("law-1-5", "电台使用规范"),
    "1.6": ("law-1-6", "监督检查与法律责任"),
    "1.7": ("law-1-7", "频率划分与使用"),
    "2.1": ("op-2-1", "频段与通信区域"),
    "2.2": ("op-2-2", "呼叫与通联程序"),
    "2.3": ("op-2-3", "英语通话"),
    "2.4": ("op-2-4", "Q 简语与缩语"),
    "2.5": ("op-2-5", "调制与发射类别"),
    "2.6": ("op-2-6", "数字通信"),
    "3.1": ("eq-3-1", "收发信机基础"),
    "3.3": ("eq-3-3", "天线与馈线"),
    "3.6": ("eq-3-6", "收发信机原理与指标"),
    "3.8": ("eq-3-8", "业余卫星与弱信号通信"),
    "4.1": ("th-4-1", "电工与无线电基础"),
    "4.6": ("th-4-6", "测量与仪表"),
    "5.1": ("sf-5-1", "用电安全与电磁环境"),
}

# Deterministic keyword tags. They are saved into the JSON so the browser never
# needs to infer tags from the question text again.
KEYWORD_RULES = [
    ("法规条文", ("条例", "办法", "规定", "法律", "法规", "国家标准", "GB")),
    ("执照", ("执照",)),
    ("呼号", ("呼号", "分区号")),
    ("频率", ("频率", "频段", "波段", "MHz", "kHz", "GHz", "Hz")),
    ("干扰", ("干扰", "杂散", "谐波", "互调", "镜像")),
    ("天线", ("天线", "馈线", "驻波", "SWR", "巴伦", "同轴")),
    ("安全", ("安全", "触电", "防雷", "接地", "漏电", "灭火", "电池")),
    ("通联", ("呼叫", "通联", "CQ", "信号报告", "QSL", "守听")),
    ("Q简语", ("Q简语", "QRP", "QSL", "QRV", "QSK", "QRM", "QRN", "QSY", "QSB", "QRZ", "QTH")),
    ("英语", ("英语", "拼读", "字母", "NATO", "ITU")),
    ("卫星", ("卫星", "AMSAT", "OSCAR", "EME", "流星余迹")),
    ("数字通信", ("数字", "D-STAR", "C4FM", "YSF", "DMR", "FT8", "APRS", "DATV", "SSTV")),
    ("电工基础", ("电阻", "电容", "电感", "电压", "电流", "功率", "欧姆", "阻抗")),
    ("测量", ("万用表", "示波器", "驻波表", "测量", "仪表")),
    ("应急通信", ("应急", "遇险", "救援", "灾害")),
]

MAX_KEYWORD_TAGS = 3


def smart_join(left: str, right: str) -> str:
    """Join wrapped PDF lines without introducing spaces inside Chinese text."""
    if not left:
        return right
    if not right:
        return left
    if left[-1] in "，。；：、！？）》”’…":
        return left + right
    if right[0] in "，。；：、！？）》”’…":
        return left + right
    if left[-1] in "（《“‘([{":
        return left + right
    if CJK_RE.match(left[-1]) and CJK_RE.match(right[0]):
        return left + right
    return left + " " + right


def normalize_text(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text).strip()
    # Tighten Chinese/ASCII spacing produced by PDF line wrapping.
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[A-Za-z0-9（《“])", "", text)
    text = re.sub(r"(?<=[A-Za-z0-9）》)）])\s+(?=[\u3400-\u9fff])", "", text)
    text = re.sub(r"(?<=[0-9])\s+(?=[年月日时分秒个瓦米伏安欧赫兹])", "", text)
    text = SPACE_AROUND_PUNCT_RE.sub(r"\1", text)
    text = SPACE_AFTER_OPEN_RE.sub(r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def parse_blocks(raw: str) -> list[dict[str, str]]:
    raw = PAGE_MARK_RE.sub("\n", raw)
    blocks: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    last_field = ""

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("[J]"):
            current = {"J": line[3:].strip()}
            blocks.append(current)
            last_field = "J"
            continue

        match = FIELD_RE.match(line)
        if match and current is not None:
            last_field = match.group(1)
            current[last_field] = match.group(2).strip()
            continue

        if current is not None and last_field:
            current[last_field] = smart_join(current.get(last_field, ""), line)

    return blocks


def keyword_tags(question: str, options: list[str], category_id: str) -> list[str]:
    haystack = question + " " + " ".join(options)
    tags: list[str] = []
    for tag, needles in KEYWORD_RULES:
        if any(needle in haystack for needle in needles):
            tags.append(tag)
    # A few words are too generic outside their own category.
    if category_id == "law" and "安全" in tags:
        tags.remove("安全")
    if category_id == "law" and "电工基础" in tags:
        tags.remove("电工基础")
    return tags[:MAX_KEYWORD_TAGS]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", nargs="?", default="A类题库.pdf")
    parser.add_argument("out", nargs="?", default="data/questions.json")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    print(f"Reading {pdf_path} ...")
    reader = PdfReader(str(pdf_path))
    raw = "\n".join((page.extract_text() or "") for page in reader.pages)
    blocks = parse_blocks(raw)
    print(f"Extracted {len(blocks)} raw questions from {len(reader.pages)} pages.")

    figures: dict[str, str] = {}
    figures_path = Path(args.out).parent / "figures.json"
    if figures_path.exists():
        figures = json.loads(figures_path.read_text(encoding="utf-8")).get("figures", {})
        print(f"Loaded {len(figures)} labeled figures from {figures_path}.")

    questions: list[dict] = []
    seen_ids: set[str] = set()
    skipped: list[str] = []

    for block in blocks:
        required = "PIQTABCD"
        if any(key not in block for key in required):
            skipped.append(block.get("I", block.get("J", "?")))
            continue

        qid = block["I"].strip()
        if qid in seen_ids:
            skipped.append(qid)
            continue
        seen_ids.add(qid)

        question_text = normalize_text(block["Q"])
        options = [
            {"key": key, "text": normalize_text(block[key])} for key in "ABCD"
        ]
        answer = "".join(sorted(set(block["T"].strip().upper())))
        if not answer or any(key not in "ABCD" for key in answer):
            skipped.append(qid)
            continue

        section = block["P"].strip()
        section_parts = section.split(".")
        category_key = section_parts[0]
        topic_key = ".".join(section_parts[:2])
        category = CATEGORY_DEFS.get(category_key)
        topic = TOPIC_DEFS.get(topic_key)
        if not category or not topic:
            skipped.append(qid)
            continue

        keyword_list = keyword_tags(
            question_text, [option["text"] for option in options], category["id"]
        )
        tags = [category["name"], topic[1], *keyword_list]

        image = None
        image_note = None
        fig_code = block.get("J") if block.get("J") not in (None, "", "LX") else None
        if block.get("F"):
            filename = block["F"].strip()
            fig_code = Path(filename).stem or fig_code
        if fig_code and fig_code in figures:
            image = figures[fig_code]
            image_note = f"题库附图 {fig_code}（来自《总题库附图标记.pdf》）"
        elif block.get("F"):
            filename = block["F"].strip()
            image = f"assets/{filename}"
            image_note = "原 PDF 配图。"

        questions.append(
            {
                "id": qid,
                "no": len(questions) + 1,
                "type": "single" if len(answer) == 1 else "multiple",
                "answer": list(answer),
                "question": question_text,
                "options": options,
                "section": section,
                "categoryId": category["id"],
                "category": category["name"],
                "topicId": topic[0],
                "topic": topic[1],
                "tags": tags,
                "sourceId": block["J"] if block.get("J") not in (None, "", "LX") else None,
                "image": image,
                "imageNote": image_note,
                "figureCode": fig_code if image else None,
                "mnemonic": "",
            }
        )

    # Preserve previously generated mnemonics when rebuilding the bank.
    preserved_mnemonics = 0
    out_path = Path(args.out)
    if out_path.exists():
        try:
            previous = json.loads(out_path.read_text(encoding="utf-8"))
            previous_mnemonics = {
                question.get("id"): question.get("mnemonic", "")
                for question in previous.get("questions", [])
            }
            for question in questions:
                mnemonic = previous_mnemonics.get(question["id"], "")
                if mnemonic:
                    question["mnemonic"] = mnemonic
                    preserved_mnemonics += 1
        except (json.JSONDecodeError, OSError) as error:
            print(f"  warning: could not preserve old mnemonics ({error})")

    # Build topic/category indexes with counts.
    topic_counts = Counter(q["topicId"] for q in questions)
    category_counts = Counter(q["categoryId"] for q in questions)
    topics = []
    for key in sorted(TOPIC_DEFS, key=lambda item: [int(part) for part in item.split(".")]):
        topic_id, topic_name = TOPIC_DEFS[key]
        topics.append(
            {
                "id": topic_id,
                "name": topic_name,
                "section": key,
                "categoryId": CATEGORY_DEFS[key.split(".")[0]]["id"],
                "count": topic_counts.get(topic_id, 0),
            }
        )

    categories = []
    for key in sorted(CATEGORY_DEFS):
        category = CATEGORY_DEFS[key]
        categories.append(
            {
                "id": category["id"],
                "name": category["name"],
                "short": category["short"],
                "description": category["description"],
                "count": category_counts.get(category["id"], 0),
            }
        )

    type_counts = Counter(q["type"] for q in questions)
    tag_counts = Counter(tag for q in questions for tag in q["tags"])

    payload = {
        "meta": {
            "title": "A 类业余无线电台操作技术能力验证题库",
            "shortTitle": "A 类题库",
            "source": pdf_path.name,
            "sourcePages": len(reader.pages),
            "total": len(questions),
            "singleCount": type_counts.get("single", 0),
            "multipleCount": type_counts.get("multiple", 0),
            "version": "1.0.0",
            "generatedAt": date.today().isoformat(),
            "exam": {
                "questionCount": 40,
                "durationMinutes": 25,
                "passPercent": 75,
                "singleCount": 32,
                "multipleCount": 8,
            },
            "tags": [
                {"name": name, "count": count}
                for name, count in tag_counts.most_common()
            ],
            "categories": categories,
            "topics": topics,
        },
        "questions": questions,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote {len(questions)} questions to {out_path}")
    print(f"  single: {type_counts.get('single', 0)}, multiple: {type_counts.get('multiple', 0)}")
    if preserved_mnemonics:
        print(f"  preserved mnemonics: {preserved_mnemonics}")
    if skipped:
        print(f"  skipped: {len(skipped)} -> {skipped[:10]}")
    print("  categories: " + ", ".join(f"{c['name']} {c['count']}" for c in categories))
    print("  topics: " + ", ".join(f"{t['name']} {t['count']}" for t in topics))


if __name__ == "__main__":
    main()
