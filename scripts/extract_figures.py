#!/usr/bin/env python3
"""Extract the labeled figures from 总题库附图标记.pdf.

The PDF contains 53 raster figures, each followed by an LKxxxx label. We pair
figures with labels in content order and save them as public/assets/figures/.

Usage:
    python3 scripts/extract_figures.py
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = ROOT / "总题库附图标记.pdf"
OUT_DIR = ROOT / "public" / "assets" / "figures"
MAP_PATH = ROOT / "public" / "data" / "figures.json"
LABEL_RE = re.compile(r"LK\d+")


def content_image_order(page, reader) -> list[str]:
    stream = ContentStream(page.get_contents(), reader)
    order: list[str] = []
    for operands, operator in stream.operations:
        if operator == b"Do" and operands:
            name = str(operands[0]).lstrip("/")
            order.append(name)
    return order


def main() -> None:
    reader = PdfReader(str(PDF_PATH))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    figures: dict[str, str] = {}
    pages: list[dict] = []

    for page_index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        labels = LABEL_RE.findall(text)
        # One label in the source PDF loses its final digit: LK060 -> LK0603.
        labels = ["LK0603" if label == "LK060" else label for label in labels]
        order = content_image_order(page, reader)
        image_map = {Path(image.name).stem: image for image in page.images}

        if len(labels) != len(order):
            raise SystemExit(
                f"page {page_index + 1}: labels={len(labels)} images={len(order)}; cannot pair"
            )

        page_items = []
        for label, name in zip(labels, order):
            image = image_map.get(name)
            if image is None:
                raise SystemExit(f"page {page_index + 1}: image {name} not found")
            target = OUT_DIR / f"{label}.jpg"
            target.write_bytes(image.data)
            relative = target.relative_to(ROOT / "public").as_posix()
            figures[label] = relative
            page_items.append({"label": label, "image": relative, "source": name})

        pages.append({"page": page_index + 1, "figures": page_items})
        print(f"page {page_index + 1}: extracted {len(page_items)} figures")

    payload = {
        "source": PDF_PATH.name,
        "generatedAt": date.today().isoformat(),
        "count": len(figures),
        "figures": figures,
        "pages": pages,
    }
    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    MAP_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(figures)} figures to {OUT_DIR}")
    print(f"Wrote map to {MAP_PATH}")
    print("Example:", {key: figures[key] for key in list(figures)[:3]})


if __name__ == "__main__":
    main()
