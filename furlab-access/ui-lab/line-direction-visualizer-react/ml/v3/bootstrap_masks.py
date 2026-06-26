import argparse
from pathlib import Path

import cv2
import numpy as np


def skin_like_mask(img_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # Heuristic mezdra band in Lab (needs manual correction later).
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


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--images", required=True)
    p.add_argument("--masks", required=True)
    p.add_argument("--force", action="store_true")
    args = p.parse_args()

    images = Path(args.images)
    masks = Path(args.masks)
    masks.mkdir(parents=True, exist_ok=True)

    count = 0
    for f in sorted(images.iterdir()):
        if not f.is_file():
            continue
        if f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}:
            continue
        out = masks / f.name
        if out.exists() and not args.force:
            continue
        img = cv2.imread(str(f), cv2.IMREAD_COLOR)
        if img is None:
            continue
        m = skin_like_mask(img)
        cv2.imwrite(str(out), m)
        count += 1

    print(f"Bootstrap masks created: {count}")


if __name__ == "__main__":
    main()
