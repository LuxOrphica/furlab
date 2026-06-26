import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path


def image_files(folder: Path):
    exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
    return sorted([p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts])


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--input-dir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--thr", type=float, default=0.5)
    p.add_argument("--infer-script", default="infer.py")
    args = p.parse_args()

    in_dir = Path(args.input_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    infer_py = Path(__file__).with_name(args.infer_script)
    for img in image_files(in_dir):
        stem = img.stem
        out_mask = out_dir / f"{stem}_mask.png"
        out_json = out_dir / f"{stem}_contour.json"
        cmd = [
            sys.executable,
            str(infer_py),
            "--model",
            args.model,
            "--input",
            str(img),
            "--out-mask",
            str(out_mask),
            "--out-json",
            str(out_json),
            "--thr",
            str(args.thr),
        ]
        subprocess.run(cmd, check=True)
        payload = json.loads(out_json.read_text(encoding="utf-8"))
        bbox = payload.get("bbox") or {}
        rows.append(
            {
                "file": img.name,
                "area": payload.get("area", 0),
                "bboxW": bbox.get("w", 0),
                "bboxH": bbox.get("h", 0),
                "processingTimeMs": payload.get("processingTimeMs", 0),
                "mask": out_mask.name,
                "json": out_json.name,
            }
        )

    csv_path = out_dir / "summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["file"])
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"Done: {len(rows)} files")
    print(f"CSV: {csv_path}")


if __name__ == "__main__":
    main()
