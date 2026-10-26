#!/usr/bin/env python3
"""Merge AI-generated mnemonic JSON files into data/questions.json.

Each input file must be a JSON object: {"MC1-0001": "速记语", ...}

Usage:
    python3 scripts/apply_mnemonics.py work/mnemonics/batch*.json
    python3 scripts/apply_mnemonics.py --questions data/questions.json --allow-missing
"""
from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", help="JSON mapping files or glob patterns")
    parser.add_argument("--questions", default="data/questions.json")
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()

    paths: list[Path] = []
    for pattern in args.files:
        matches = glob.glob(pattern)
        if matches:
            paths.extend(Path(path) for path in matches)
        else:
            paths.append(Path(pattern))

    mapping: dict[str, str] = {}
    for path in sorted(set(paths)):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise SystemExit(f"{path}: expected a JSON object")
        for key, value in payload.items():
            if not isinstance(value, str) or not value.strip():
                raise SystemExit(f"{path}: invalid mnemonic for {key!r}")
            if key in mapping and mapping[key] != value:
                raise SystemExit(f"duplicate mnemonic for {key}: {path}")
            mapping[key] = value.strip()

    questions_path = Path(args.questions)
    data = json.loads(questions_path.read_text(encoding="utf-8"))
    questions = data["questions"]
    ids = {question["id"] for question in questions}

    missing = sorted(ids - set(mapping))
    extra = sorted(set(mapping) - ids)
    if extra:
        raise SystemExit(f"mnemonic IDs not found in question bank: {extra[:20]} (+{max(0, len(extra) - 20)})")
    if missing and not args.allow_missing:
        raise SystemExit(f"missing mnemonics for {len(missing)} questions: {missing[:20]}")

    for question in questions:
        mnemonic = mapping.get(question["id"], "")
        if mnemonic:
            question["mnemonic"] = mnemonic

    questions_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lengths = [len(question["mnemonic"]) for question in questions if question.get("mnemonic")]
    print(f"Merged {len(mapping)} mnemonics into {questions_path}")
    print(f"  questions: {len(questions)}, with mnemonic: {len(lengths)}, missing: {len(ids) - len(lengths)}")
    if lengths:
        print(f"  length min/avg/max: {min(lengths)} / {sum(lengths) / len(lengths):.1f} / {max(lengths)}")


if __name__ == "__main__":
    main()
