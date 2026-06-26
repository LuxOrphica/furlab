import argparse
import csv
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np


@dataclass
class Row:
    created_at: str
    source_image_name: str
    source_image_path: str
    contour_points: List[Dict[str, float]]
    image_width: int
    image_height: int
    manual_contour_applied: bool
    inventory_tag: str
    raw: Dict


def safe_int(v) -> int:
    try:
        return int(v)
    except Exception:
        return 0


def parse_rows(ndjson_path: Path) -> List[Row]:
    out: List[Row] = []
    if not ndjson_path.exists():
        return out
    for line in ndjson_path.read_text(encoding="utf-8-sig").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except Exception:
            continue
        pts = obj.get("contourPoints") or []
        if not isinstance(pts, list) or len(pts) < 3:
            continue
        src_name = str(obj.get("sourceImageName") or "").strip()
        if not src_name:
            continue
        metrics = obj.get("metrics") or {}
        out.append(
            Row(
                created_at=str(obj.get("createdAt") or ""),
                source_image_name=src_name,
                source_image_path=str(obj.get("sourceImagePath") or "").strip(),
                contour_points=pts,
                image_width=safe_int(obj.get("imageWidth")),
                image_height=safe_int(obj.get("imageHeight")),
                manual_contour_applied=bool(metrics.get("manualContourApplied")),
                inventory_tag=str(obj.get("inventoryTag") or "").strip().upper(),
                raw=obj,
            )
        )
    return out


def dedupe_latest(rows: List[Row]) -> List[Row]:
    by_key: Dict[str, Row] = {}
    for r in rows:
        key = r.source_image_name.lower()
        prev = by_key.get(key)
        if prev is None or r.created_at >= prev.created_at:
            by_key[key] = r
    return list(by_key.values())


def find_image(row: Row, search_dirs: List[Path]) -> Optional[Path]:
    if row.source_image_path:
        p = Path(row.source_image_path)
        if p.exists() and p.is_file():
            return p
    for d in search_dirs:
        p = d / row.source_image_name
        if p.exists() and p.is_file():
            return p
    return None


def contour_to_mask(points: List[Dict[str, float]], w: int, h: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    poly = []
    for p in points:
        try:
            x = int(round(float(p.get("x", 0))))
            y = int(round(float(p.get("y", 0))))
        except Exception:
            continue
        poly.append([x, y])
    if len(poly) >= 3:
        arr = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.fillPoly(mask, [arr], 255)
    return mask


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--annotations", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--search-dirs",
        nargs="+",
        default=[
            "ui-lab/assets/uploads",
            "ui-lab/assets/uploads_real_only",
            "ml/datasets/mezdra_v1/images",
        ],
    )
    ap.add_argument("--latest-per-image", action="store_true")
    ap.add_argument("--manual-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    ann = Path(args.annotations)
    out_root = Path(args.out)
    out_images = out_root / "images"
    out_masks = out_root / "masks"
    out_images.mkdir(parents=True, exist_ok=True)
    out_masks.mkdir(parents=True, exist_ok=True)

    rows = parse_rows(ann)
    total_parsed = len(rows)
    if args.manual_only:
        rows = [r for r in rows if r.manual_contour_applied]
    if args.latest_per_image:
        rows = dedupe_latest(rows)

    search_dirs = [Path(d) for d in args.search_dirs]
    report_rows = []
    exported = 0
    missing = 0

    for row in sorted(rows, key=lambda r: (r.source_image_name.lower(), r.created_at)):
        src = find_image(row, search_dirs)
        if src is None:
            missing += 1
            report_rows.append(
                {
                    "image": row.source_image_name,
                    "status": "missing_source",
                    "createdAt": row.created_at,
                    "inventoryTag": row.inventory_tag,
                    "manualContourApplied": row.manual_contour_applied,
                    "sourcePath": row.source_image_path,
                }
            )
            continue

        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            missing += 1
            report_rows.append(
                {
                    "image": row.source_image_name,
                    "status": "unreadable_source",
                    "createdAt": row.created_at,
                    "inventoryTag": row.inventory_tag,
                    "manualContourApplied": row.manual_contour_applied,
                    "sourcePath": str(src),
                }
            )
            continue

        h, w = img.shape[:2]
        mask = contour_to_mask(row.contour_points, w, h)
        if int((mask > 0).sum()) <= 0:
            report_rows.append(
                {
                    "image": row.source_image_name,
                    "status": "empty_mask",
                    "createdAt": row.created_at,
                    "inventoryTag": row.inventory_tag,
                    "manualContourApplied": row.manual_contour_applied,
                    "sourcePath": str(src),
                }
            )
            continue

        dst_img = out_images / row.source_image_name
        dst_mask = out_masks / row.source_image_name
        if not args.force and dst_img.exists() and dst_mask.exists():
            report_rows.append(
                {
                    "image": row.source_image_name,
                    "status": "exists_skipped",
                    "createdAt": row.created_at,
                    "inventoryTag": row.inventory_tag,
                    "manualContourApplied": row.manual_contour_applied,
                    "sourcePath": str(src),
                }
            )
            continue

        shutil.copy2(src, dst_img)
        cv2.imwrite(str(dst_mask), mask)
        exported += 1
        report_rows.append(
            {
                "image": row.source_image_name,
                "status": "ok",
                "createdAt": row.created_at,
                "inventoryTag": row.inventory_tag,
                "manualContourApplied": row.manual_contour_applied,
                "sourcePath": str(src),
            }
        )

    report_path = out_root / "report.csv"
    with report_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "image",
                "status",
                "createdAt",
                "inventoryTag",
                "manualContourApplied",
                "sourcePath",
            ],
        )
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    summary = {
        "rowsParsed": total_parsed,
        "rowsSelected": len(rows),
        "exported": exported,
        "missing": missing,
        "report": str(report_path),
        "out": str(out_root),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
