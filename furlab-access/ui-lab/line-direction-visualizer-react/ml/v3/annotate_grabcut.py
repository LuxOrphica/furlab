import argparse
from pathlib import Path

import cv2
import numpy as np


GC_BGD = 0
GC_FGD = 1
GC_PR_BGD = 2
GC_PR_FGD = 3


def sorted_images(images_dir: Path):
    exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
    return sorted([p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in exts])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True)
    parser.add_argument("--masks", required=True)
    args = parser.parse_args()

    images_dir = Path(args.images)
    masks_dir = Path(args.masks)
    masks_dir.mkdir(parents=True, exist_ok=True)

    files = sorted_images(images_dir)
    if not files:
        print("No images found")
        return

    mode = "fg"
    brush = 6
    ix = 0

    while 0 <= ix < len(files):
        f = files[ix]
        img = cv2.imread(str(f), cv2.IMREAD_COLOR)
        if img is None:
            ix += 1
            continue

        h, w = img.shape[:2]
        mask_file = masks_dir / f.name
        gc_mask = np.full((h, w), GC_PR_BGD, dtype=np.uint8)

        if mask_file.exists():
            m = cv2.imread(str(mask_file), cv2.IMREAD_GRAYSCALE)
            if m is not None and m.shape[:2] == (h, w):
                gc_mask[:] = GC_BGD
                gc_mask[m > 127] = GC_FGD

        draw = img.copy()
        result = img.copy()
        rect = (max(1, int(w * 0.15)), max(1, int(h * 0.15)), int(w * 0.7), int(h * 0.7))

        dragging = False

        def redraw() -> None:
            nonlocal result
            fg = np.where((gc_mask == GC_FGD) | (gc_mask == GC_PR_FGD), 255, 0).astype(np.uint8)
            ov = img.copy()
            ov[fg > 0] = (0.55 * ov[fg > 0] + 0.45 * np.array([255, 200, 80])).astype(np.uint8)
            result = ov

        def on_mouse(event, x, y, flags, param):
            nonlocal dragging, gc_mask
            if event == cv2.EVENT_LBUTTONDOWN:
                dragging = True
            elif event == cv2.EVENT_LBUTTONUP:
                dragging = False
            elif event == cv2.EVENT_MOUSEMOVE and dragging:
                val = GC_FGD if mode == "fg" else GC_BGD
                cv2.circle(gc_mask, (x, y), brush, int(val), -1)
                redraw()

        cv2.namedWindow("annotate", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("annotate", min(1400, w), min(900, h))
        cv2.setMouseCallback("annotate", on_mouse)
        redraw()

        print(f"\n{ix + 1}/{len(files)} {f.name}")
        print("r=roi, f=fg brush, b=bg brush, g=grabcut, s=save, n=next, p=prev, q=quit")

        while True:
            vis = result.copy()
            cv2.putText(vis, f"{f.name} | mode:{mode} | brush:{brush}", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 220, 30), 2, cv2.LINE_AA)
            cv2.imshow("annotate", vis)
            k = cv2.waitKey(20) & 0xFF
            if k == 255:
                continue
            if k == ord("q"):
                cv2.destroyAllWindows()
                return
            if k == ord("f"):
                mode = "fg"
            elif k == ord("b"):
                mode = "bg"
            elif k == ord("["):
                brush = max(1, brush - 1)
            elif k == ord("]"):
                brush = min(60, brush + 1)
            elif k == ord("r"):
                x, y, rw, rh = cv2.selectROI("annotate", img, showCrosshair=True, fromCenter=False)
                if rw > 2 and rh > 2:
                    rect = (int(x), int(y), int(rw), int(rh))
                    gc_mask[:] = GC_BGD
                    x0, y0, ww, hh = rect
                    gc_mask[y0:y0 + hh, x0:x0 + ww] = GC_PR_FGD
                    redraw()
            elif k == ord("g"):
                bgd = np.zeros((1, 65), np.float64)
                fgd = np.zeros((1, 65), np.float64)
                x0, y0, ww, hh = rect
                cv2.grabCut(img, gc_mask, (x0, y0, ww, hh), bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
                redraw()
            elif k == ord("s"):
                out = np.where((gc_mask == GC_FGD) | (gc_mask == GC_PR_FGD), 255, 0).astype(np.uint8)
                cv2.imwrite(str(mask_file), out)
                print(f"Saved: {mask_file}")
            elif k == ord("n"):
                ix += 1
                break
            elif k == ord("p"):
                ix = max(0, ix - 1)
                break

        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
