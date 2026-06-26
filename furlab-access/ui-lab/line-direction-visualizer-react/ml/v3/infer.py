import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class DoubleConv(nn.Module):
    def __init__(self, c_in: int, c_out: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(c_in, c_out, 3, padding=1, bias=False),
            nn.BatchNorm2d(c_out),
            nn.ReLU(inplace=True),
            nn.Conv2d(c_out, c_out, 3, padding=1, bias=False),
            nn.BatchNorm2d(c_out),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.net(x)


class UNetSmall(nn.Module):
    def __init__(self):
        super().__init__()
        self.d1 = DoubleConv(3, 32)
        self.d2 = DoubleConv(32, 64)
        self.d3 = DoubleConv(64, 128)
        self.b = DoubleConv(128, 256)
        self.u3 = DoubleConv(256 + 128, 128)
        self.u2 = DoubleConv(128 + 64, 64)
        self.u1 = DoubleConv(64 + 32, 32)
        self.out = nn.Conv2d(32, 1, 1)

    def forward(self, x):
        x1 = self.d1(x)
        x2 = self.d2(F.max_pool2d(x1, 2))
        x3 = self.d3(F.max_pool2d(x2, 2))
        xb = self.b(F.max_pool2d(x3, 2))
        y = F.interpolate(xb, scale_factor=2, mode="bilinear", align_corners=False)
        y = self.u3(torch.cat([y, x3], dim=1))
        y = F.interpolate(y, scale_factor=2, mode="bilinear", align_corners=False)
        y = self.u2(torch.cat([y, x2], dim=1))
        y = F.interpolate(y, scale_factor=2, mode="bilinear", align_corners=False)
        y = self.u1(torch.cat([y, x1], dim=1))
        return self.out(y)


def largest_component(mask: np.ndarray) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    idx = int(np.argmax(areas)) + 1
    out = np.zeros_like(mask, dtype=np.uint8)
    out[labels == idx] = 255
    return out


def contour_from_mask(mask: np.ndarray):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return [], {"x": 0, "y": 0, "w": 0, "h": 0}, 0
    c = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(c)
    area = int(cv2.contourArea(c))
    pts = [{"x": int(p[0][0]), "y": int(p[0][1])} for p in c]
    return pts, {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}, area


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-mask", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--thr", type=float, default=0.5)
    parser.add_argument("--cpu", action="store_true")
    args = parser.parse_args()

    ckpt = torch.load(args.model, map_location="cpu")
    img_size = int(ckpt.get("img_size", 512))

    model = UNetSmall()
    model.load_state_dict(ckpt["model"])
    model.eval()

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    model.to(device)

    src = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if src is None:
        raise RuntimeError(f"Failed to read input: {args.input}")

    h0, w0 = src.shape[:2]
    rgb = cv2.cvtColor(src, cv2.COLOR_BGR2RGB)
    small = cv2.resize(rgb, (img_size, img_size), interpolation=cv2.INTER_AREA)
    x = torch.from_numpy(small.transpose(2, 0, 1)).float().unsqueeze(0) / 255.0
    x = x.to(device)

    t0 = time.perf_counter()
    with torch.no_grad():
        logits = model(x)
        prob = torch.sigmoid(logits)[0, 0].detach().cpu().numpy()
    t1 = time.perf_counter()

    m = (prob >= args.thr).astype(np.uint8) * 255
    m = cv2.resize(m, (w0, h0), interpolation=cv2.INTER_NEAREST)
    m = largest_component(m)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel, iterations=1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel, iterations=1)

    contour, bbox, area = contour_from_mask(m)

    out_mask = Path(args.out_mask)
    out_json = Path(args.out_json)
    out_mask.parent.mkdir(parents=True, exist_ok=True)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_mask), m)

    payload = {
        "input": str(Path(args.input).name),
        "bbox": bbox,
        "area": int(area),
        "processingTimeMs": round((t1 - t0) * 1000.0, 3),
        "contour": contour,
    }
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
