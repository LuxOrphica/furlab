import argparse
import csv
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np


def skin_like_mask(img_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    m = (
        (l >= 95) & (l <= 215) &
        (a >= 120) & (a <= 156) &
        (b >= 124) & (b <= 172)
    )
    mask = (m.astype(np.uint8) * 255)
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k5, iterations=2)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    out = np.zeros_like(mask)
    if n > 1:
        idx = int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
        out[labels == idx] = 255
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, k5, iterations=1)
    return out


@dataclass
class Row:
    created_at: str
    source_image_name: str
    contour_points: List[Dict[str, float]]
    image_width: int
    image_height: int
    manual_contour_applied: bool
    raw: Dict


def parse_rows(ndjson_path: Path) -> List[Row]:
    rows: List[Row] = []
    for line in ndjson_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        pts = obj.get("contourPoints") or []
        if not isinstance(pts, list) or len(pts) < 3:
            continue

        src_name = (obj.get("sourceImageName") or "").strip()
        if not src_name:
            continue

        m = obj.get("metrics") or {}
        rows.append(
            Row(
                created_at=str(obj.get("createdAt") or ""),
                source_image_name=src_name,
                contour_points=pts,
                image_width=int(obj.get("imageWidth") or 0),
                image_height=int(obj.get("imageHeight") or 0),
                manual_contour_applied=bool(m.get("manualContourApplied")),
                raw=obj,
            )
        )
    return rows


def dedupe_latest(rows: List[Row]) -> List[Row]:
    by_name: Dict[str, Row] = {}
    for r in rows:
        prev = by_name.get(r.source_image_name)
        if prev is None or r.created_at >= prev.created_at:
            by_name[r.source_image_name] = r
    return list(by_name.values())


def find_image(name: str, search_dirs: List[Path]) -> Optional[Path]:
    for d in search_dirs:
        p = d / name
        if p.exists() and p.is_file():
            return p
    return None


def contour_to_mask(points: List[Dict[str, float]], w: int, h: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    poly = []
    for p in points:
        x = int(round(float(p.get("x", 0))))
        y = int(round(float(p.get("y", 0))))
        poly.append([x, y])
    if len(poly) >= 3:
        arr = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.fillPoly(mask, [arr], 255)
    return mask


def iou(a: np.ndarray, b: np.ndarray) -> float:
    aa = a > 0
    bb = b > 0
    inter = np.logical_and(aa, bb).sum()
    union = np.logical_or(aa, bb).sum()
    if union <= 0:
        return 0.0
    return float(inter / union)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--annotations", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--search-dirs",
        nargs="+",
        default=[
            "ui-lab/assets/uploads",
            "ml/datasets/mezdra_v1/images",
        ],
    )
    ap.add_argument("--latest-per-image", action="store_true")
    ap.add_argument("--manual-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    ann = Path(args.annotations)
    out_root = Path(args.out)
    out_img = out_root / "images"
    out_gt = out_root / "masks_gt"
    out_teacher = out_root / "masks_teacher"
    out_img.mkdir(parents=True, exist_ok=True)
    out_gt.mkdir(parents=True, exist_ok=True)
    out_teacher.mkdir(parents=True, exist_ok=True)

    rows = parse_rows(ann)
    if args.manual_only:
        rows = [r for r in rows if r.manual_contour_applied]
    if args.latest_per_image:
        rows = dedupe_latest(rows)

    search_dirs = [Path(d) for d in args.search_dirs]
    report_rows = []
    missing = 0
    exported = 0

    for r in sorted(rows, key=lambda x: (x.source_image_name, x.created_at)):
        src = find_image(r.source_image_name, search_dirs)
        if src is None:
            missing += 1
            report_rows.append(
                {
                    "image": r.source_image_name,
                    "status": "missing_source",
                    "createdAt": r.created_at,
                    "manualContourApplied": r.manual_contour_applied,
                    "gtArea": 0,
                    "teacherArea": 0,
                    "teacherIoUWithGt": "",
                }
            )
            continue

        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            missing += 1
            report_rows.append(
                {
                    "image": r.source_image_name,
                    "status": "unreadable_source",
                    "createdAt": r.created_at,
                    "manualContourApplied": r.manual_contour_applied,
                    "gtArea": 0,
                    "teacherArea": 0,
                    "teacherIoUWithGt": "",
                }
            )
            continue

        h, w = img.shape[:2]
        gt = contour_to_mask(r.contour_points, w, h)
        teacher = skin_like_mask(img)

        out_name = r.source_image_name
        dst_img = out_img / out_name
        dst_gt = out_gt / out_name
        dst_teacher = out_teacher / out_name
        if not args.force and dst_img.exists() and dst_gt.exists() and dst_teacher.exists():
            continue

        shutil.copy2(src, dst_img)
        cv2.imwrite(str(dst_gt), gt)
        cv2.imwrite(str(dst_teacher), teacher)
        exported += 1

        report_rows.append(
            {
                "image": r.source_image_name,
                "status": "ok",
                "createdAt": r.created_at,
                "manualContourApplied": r.manual_contour_applied,
                "gtArea": int((gt > 0).sum()),
                "teacherArea": int((teacher > 0).sum()),
                "teacherIoUWithGt": round(iou(teacher, gt), 6),
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
                "manualContourApplied",
                "gtArea",
                "teacherArea",
                "teacherIoUWithGt",
            ],
        )
        w.writeheader()
        for rr in report_rows:
            w.writerow(rr)

    summary = {
        "rowsParsed": len(rows),
        "exported": exported,
        "missing": missing,
        "report": str(report_path),
        "out": str(out_root),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

