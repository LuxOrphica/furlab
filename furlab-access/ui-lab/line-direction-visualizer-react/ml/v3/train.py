import argparse
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm


@dataclass
class Item:
    image: Path
    mask: Path


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


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

    def forward(self, x: torch.Tensor) -> torch.Tensor:
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

    def forward(self, x: torch.Tensor) -> torch.Tensor:
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


class MezdraDataset(Dataset):
    def __init__(self, items: List[Item], img_size: int, augment: bool):
        self.items = items
        self.img_size = int(img_size)
        self.augment = augment

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        it = self.items[idx]
        img = cv2.imread(str(it.image), cv2.IMREAD_COLOR)
        m = cv2.imread(str(it.mask), cv2.IMREAD_GRAYSCALE)
        if img is None or m is None:
            raise RuntimeError(f"Failed to read pair: {it.image} / {it.mask}")

        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (self.img_size, self.img_size), interpolation=cv2.INTER_AREA)
        m = cv2.resize(m, (self.img_size, self.img_size), interpolation=cv2.INTER_NEAREST)

        if self.augment:
            if random.random() < 0.5:
                img = np.fliplr(img).copy()
                m = np.fliplr(m).copy()
            if random.random() < 0.3:
                alpha = random.uniform(0.9, 1.1)
                beta = random.uniform(-10, 10)
                img = np.clip(img.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8)

        x = torch.from_numpy(img.transpose(2, 0, 1)).float() / 255.0
        y = torch.from_numpy((m > 127).astype(np.float32)).unsqueeze(0)
        return x, y


def dice_loss(logits: torch.Tensor, y: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    p = torch.sigmoid(logits)
    inter = (p * y).sum(dim=(1, 2, 3))
    den = p.sum(dim=(1, 2, 3)) + y.sum(dim=(1, 2, 3))
    dice = (2.0 * inter + eps) / (den + eps)
    return 1.0 - dice.mean()


def build_items(images: Path, masks: Path) -> List[Item]:
    exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
    out: List[Item] = []
    for f in sorted(images.iterdir()):
        if not f.is_file() or f.suffix.lower() not in exts:
            continue
        m = masks / f.name
        if m.exists():
            out.append(Item(f, m))
    return out


def split_items(items: List[Item], val_ratio: float) -> Tuple[List[Item], List[Item]]:
    items = items[:]
    random.shuffle(items)
    n_val = max(1, int(len(items) * val_ratio)) if len(items) > 3 else 1
    return items[n_val:], items[:n_val]


def iou_score(logits: torch.Tensor, y: torch.Tensor) -> float:
    p = (torch.sigmoid(logits) > 0.5).float()
    inter = (p * y).sum().item()
    union = ((p + y) > 0).float().sum().item()
    if union <= 0:
        return 0.0
    return inter / union


def train(args):
    seed_everything(args.seed)

    images = Path(args.images)
    masks = Path(args.masks)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    items = build_items(images, masks)
    if len(items) < 2:
        raise RuntimeError("Need at least 2 image+mask pairs")

    train_items, val_items = split_items(items, args.val_ratio)
    print(f"pairs={len(items)} train={len(train_items)} val={len(val_items)}")

    train_ds = MezdraDataset(train_items, args.img_size, augment=True)
    val_ds = MezdraDataset(val_items, args.img_size, augment=False)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=1, shuffle=False, num_workers=0)

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    model = UNetSmall().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)

    bce = nn.BCEWithLogitsLoss()
    best_iou = -1.0

    for epoch in range(1, args.epochs + 1):
        model.train()
        tloss = 0.0
        for x, y in tqdm(train_loader, desc=f"train {epoch}/{args.epochs}", leave=False):
            x = x.to(device)
            y = y.to(device)
            logits = model(x)
            loss = 0.5 * bce(logits, y) + 0.5 * dice_loss(logits, y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            tloss += float(loss.item())

        model.eval()
        vloss = 0.0
        viou = 0.0
        with torch.no_grad():
            for x, y in val_loader:
                x = x.to(device)
                y = y.to(device)
                logits = model(x)
                loss = 0.5 * bce(logits, y) + 0.5 * dice_loss(logits, y)
                vloss += float(loss.item())
                viou += iou_score(logits, y)

        tl = tloss / max(1, len(train_loader))
        vl = vloss / max(1, len(val_loader))
        vi = viou / max(1, len(val_loader))
        print(f"epoch={epoch} train_loss={tl:.4f} val_loss={vl:.4f} val_iou={vi:.4f}")

        if vi > best_iou:
            best_iou = vi
            torch.save(
                {
                    "model": model.state_dict(),
                    "img_size": args.img_size,
                    "best_val_iou": best_iou,
                },
                out_path,
            )

    print(f"saved: {out_path} best_val_iou={best_iou:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True)
    parser.add_argument("--masks", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--img-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cpu", action="store_true")
    train(parser.parse_args())
