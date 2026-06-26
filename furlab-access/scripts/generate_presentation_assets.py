from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "tmp" / "presentation_assets_data"
OUT_DIR = ROOT / "docs" / "presentation_assets"

BASE_W, BASE_H = 1920, 1080
# Match PPT right-column placeholder aspect (6.35 x 5.55 in)
W, H = 1832, 1600
BG = (245, 247, 250)
TITLE = (25, 35, 60)
TEXT = (30, 30, 35)
MUTED = (90, 95, 110)


def sx(v: int | float) -> int:
    return int(v * W / BASE_W)


def sy(v: int | float) -> int:
    return int(v * H / BASE_H)


def sxy(x: int | float, y: int | float) -> tuple[int, int]:
    return sx(x), sy(y)


def load_json_list(name: str) -> list[dict]:
    p = DATA_DIR / name
    data = json.loads(p.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for c in candidates:
        p = Path(c)
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


def new_canvas(title: str, subtitle: str = "") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text(sxy(38, 24), title, fill=TITLE, font=font(44, bold=True))
    if subtitle:
        # Subtitle should remain readable inside half-slide image area.
        d.text(sxy(38, 78), subtitle, fill=(78, 84, 102), font=font(34))
    d.line((sx(38), sy(116), W - sx(38), sy(116)), fill=(205, 210, 220), width=2)
    return img, d


def box(d: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], label: str, fill: tuple[int, int, int]) -> None:
    d.rounded_rectangle(xy, radius=20, fill=fill, outline=(170, 175, 190), width=2)
    x1, y1, x2, y2 = xy
    # Keep explicit inner paddings so text never visually sticks to block edges.
    pad_x = 28
    pad_y = 20
    max_w = max(40, (x2 - x1) - pad_x * 2)
    max_h = max(30, (y2 - y1) - pad_y * 2)
    size = 48
    f = font(size, bold=True)
    tw = d.textlength(label, font=f)
    while (tw > max_w or size > max_h) and size > 26:
        size -= 2
        f = font(size, bold=True)
        tw = d.textlength(label, font=f)
    tx = (x1 + x2 - tw) / 2
    ty = (y1 + y2 - size) / 2
    d.text((tx, ty), label, fill=TITLE, font=f)


def arrow(d: ImageDraw.ImageDraw, p1: tuple[int, int], p2: tuple[int, int], text: str = "") -> None:
    d.line((p1[0], p1[1], p2[0], p2[1]), fill=(95, 100, 120), width=7)
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    if abs(dx) > abs(dy):
        s = -1 if dx > 0 else 1
        d.polygon([(p2[0], p2[1]), (p2[0] + 24 * s, p2[1] - 14), (p2[0] + 24 * s, p2[1] + 14)], fill=(95, 100, 120))
    else:
        s = -1 if dy > 0 else 1
        d.polygon([(p2[0], p2[1]), (p2[0] - 14, p2[1] + 24 * s), (p2[0] + 14, p2[1] + 24 * s)], fill=(95, 100, 120))
    if text:
        mx = int((p1[0] + p2[0]) / 2)
        my = int((p1[1] + p2[1]) / 2)
        # Put label in a detached pill near arrow for projector readability.
        if abs(dx) >= abs(dy):
            lx, ly = mx - 62, my - 56
        else:
            lx, ly = mx + 20, my - 24
        # Larger pill with more inner padding for readability on projector.
        label_w, label_h = 172, 66
        d.rounded_rectangle((lx, ly, lx + label_w, ly + label_h), radius=10, fill=(255, 255, 255), outline=(175, 180, 195), width=2)
        tf = font(30, bold=True)
        tw = d.textlength(text, font=tf)
        d.text((lx + (label_w - tw) / 2, ly + 14), text, fill=(75, 80, 95), font=tf)


def pill_label(d: ImageDraw.ImageDraw, center: tuple[int, int], text: str) -> None:
    tf = font(30, bold=True)
    tw = int(d.textlength(text, font=tf))
    pad_x = 20
    w = tw + pad_x * 2
    h = 66
    x = int(center[0] - w / 2)
    y = int(center[1] - h / 2)
    d.rounded_rectangle((x, y, x + w, y + h), radius=10, fill=(255, 255, 255), outline=(175, 180, 195), width=2)
    d.text((x + pad_x, y + 14), text, fill=(75, 80, 95), font=tf)


def draw_table(
    d: ImageDraw.ImageDraw,
    top_left: tuple[int, int],
    headers: list[str],
    rows: Iterable[list[str]],
    col_widths: list[int],
    row_h: int = 50,
) -> None:
    x0, y0 = top_left
    width = sum(col_widths)
    d.rectangle((x0, y0, x0 + width, y0 + row_h), fill=(225, 232, 245), outline=(170, 175, 190), width=2)
    cx = x0
    for i, h in enumerate(headers):
        d.text((cx + 8, y0 + 12), h, fill=TITLE, font=font(20, bold=True))
        cx += col_widths[i]
        if i < len(headers) - 1:
            d.line((cx, y0, cx, y0 + row_h), fill=(170, 175, 190), width=2)
    y = y0 + row_h
    for r_i, row in enumerate(rows):
        bg = (255, 255, 255) if r_i % 2 == 0 else (248, 250, 255)
        d.rectangle((x0, y, x0 + width, y + row_h), fill=bg, outline=(210, 214, 224), width=1)
        cx = x0
        for i, cell in enumerate(row):
            d.text((cx + 8, y + 12), str(cell), fill=TEXT, font=font(19))
            cx += col_widths[i]
            if i < len(headers) - 1:
                d.line((cx, y, cx, y + row_h), fill=(225, 228, 236), width=1)
        y += row_h


def save(img: Image.Image, name: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img.save(OUT_DIR / name, format="PNG", optimize=True)


def asset_architecture() -> None:
    img, d = new_canvas("Архитектура FurLab: Access + API + UI", "Контур исполнения запросов и бизнес-правил")
    box(d, (sx(120), sy(290), sx(560), sy(520)), "UI / Forms", (231, 245, 255))
    box(d, (sx(740), sy(290), sx(1180), sy(520)), "API Server", (233, 255, 238))
    box(d, (sx(1360), sy(290), sx(1800), sy(520)), "Access DB", (255, 245, 230))
    # For this slide, labels are detached from arrow lines to avoid visual overlap.
    p1a, p1b = sxy(560, 405), sxy(740, 405)
    p2a, p2b = sxy(1180, 405), sxy(1360, 405)
    arrow(d, p1a, p1b, "")
    arrow(d, p2a, p2b, "")
    pill_label(d, sxy(650, 365), "HTTP")
    pill_label(d, sxy(1270, 365), "DAO/ADO")
    d.text(sxy(690, 640), "services/*: бизнес-правила, статусы,\nвалидация и трассировка операций", fill=MUTED, font=font(36))
    save(img, "01_architecture_overview.png")


def asset_er_core() -> None:
    img, d = new_canvas("ER-ядро БД FurLab", "Ключевые сущности для учета и трассируемости выкладки")
    box(d, (sx(80), sy(220), sx(500), sy(390)), "ScrapPiece", (255, 242, 227))
    box(d, (sx(740), sy(220), sx(1160), sy(390)), "LayoutRun", (228, 245, 255))
    box(d, (sx(1400), sy(220), sx(1820), sy(390)), "Fragment", (236, 255, 236))
    box(d, (sx(620), sy(520), sx(1300), sy(700)), "LayoutRunScrapPlacement", (245, 238, 255))
    box(d, (sx(80), sy(780), sx(500), sy(950)), "ScrapTransaction", (255, 235, 240))
    arrow(d, sxy(500, 305), sxy(620, 605), "scrapPieceId")
    arrow(d, sxy(950, 390), sxy(950, 520), "layoutRunId")
    arrow(d, sxy(1400, 305), sxy(1300, 605), "fragmentId")
    arrow(d, sxy(290, 390), sxy(290, 780), "история")
    save(img, "02_er_core.png")


def asset_status_distribution() -> None:
    rows = load_json_list("status_counts.json")
    total = sum(int(r.get("cnt") or 0) for r in rows) or 1
    img, d = new_canvas("Распределение статусов ScrapPiece", "Срез БД на 11.03.2026")
    palette = [(82, 196, 26), (250, 173, 20), (250, 84, 28), (120, 120, 120)]
    y = sy(180)
    max_w = sx(1260)
    for i, r in enumerate(rows):
        label = str(r.get("scrapStatus"))
        cnt = int(r.get("cnt") or 0)
        w = int(max_w * cnt / total)
        d.rounded_rectangle((sx(120), y, sx(120) + w, y + sy(92)), radius=16, fill=palette[i % len(palette)])
        pct = cnt * 100 / total
        d.text((sx(145) + w + sx(20), y + sy(28)), f"{label}: {cnt} ({pct:.1f}%)", fill=TEXT, font=font(36, bold=True))
        y += sy(160)
    d.text(sxy(120, 900), f"Итого кусков: {total}", fill=TITLE, font=font(44, bold=True))
    save(img, "03_status_distribution.png")


def asset_status_rules() -> None:
    img, d = new_canvas("Правила переходов статусов", "Источник: tools/server/services/status_rules.js")
    box(d, (sx(120), sy(250), sx(500), sy(430)), "Available", (231, 255, 236))
    box(d, (sx(780), sy(250), sx(1160), sy(430)), "Reserved", (255, 249, 225))
    box(d, (sx(1440), sy(250), sx(1820), sy(430)), "Used", (255, 236, 225))
    box(d, (sx(780), sy(610), sx(1160), sy(790)), "Discarded", (230, 230, 230))
    arrow(d, sxy(500, 340), sxy(780, 340), "reserve")
    arrow(d, sxy(780, 385), sxy(500, 385), "release")
    arrow(d, sxy(1160, 340), sxy(1440, 340), "use")
    arrow(d, sxy(500, 400), sxy(1440, 400), "use")
    d.text(sxy(460, 930), "Запрет: переход из Discarded в активные состояния", fill=(120, 70, 70), font=font(42, bold=True))
    save(img, "04_status_transitions_rules.png")


def asset_traceability() -> None:
    img, d = new_canvas("Трассируемость применения куска", "Цепочка восстановления: физическая метка -> запуск -> фрагмент")
    box(d, (sx(90), sy(330), sx(430), sy(520)), "inventoryTag", (231, 245, 255))
    box(d, (sx(560), sy(330), sx(900), sy(520)), "ScrapPiece.id", (255, 242, 227))
    box(d, (sx(1070), sy(190), sx(1400), sy(380)), "LayoutRun.id", (228, 245, 255))
    box(d, (sx(1070), sy(640), sx(1400), sy(830)), "Fragment.id", (236, 255, 236))
    box(d, (sx(1540), sy(330), sx(1820), sy(520)), "Placement", (245, 238, 255))
    arrow(d, sxy(430, 430), sxy(560, 430))
    arrow(d, sxy(900, 430), sxy(1070, 290), "layoutRunId")
    arrow(d, sxy(900, 430), sxy(1070, 740), "fragmentId")
    arrow(d, sxy(1400, 290), sxy(1540, 400))
    arrow(d, sxy(1400, 740), sxy(1540, 450))
    d.text(sxy(60, 930), "Placement = scrapPieceId + fragmentId + layoutRunId + rotationDeg + offsetXmm/offsetYmm + resultContourSnapshot", fill=MUTED, font=font(28))
    save(img, "05_traceability_chain.png")


def asset_scrappiece_table() -> None:
    data = load_json_list("scrappiece_sample.json")
    img, d = new_canvas("Фрагмент таблицы ScrapPiece", "Ключевые поля для операционного учета")
    headers = ["inventoryTag", "status", "quality", "areaMm2", "maxSpanMm", "napDeg", "updatedAt"]
    if len(data) < 22:
        # Duplicate sample rows to fill the visual table area when source sample is short.
        mul = (22 + max(1, len(data)) - 1) // max(1, len(data))
        data = (data * mul)[:22]
    rows = [
        [
            str(r.get("inventoryTag", "")),
            str(r.get("scrapStatus", "")),
            str(r.get("scrapQuality", "")),
            f"{float(r.get('areaMm2') or 0):.1f}",
            f"{float(r.get('maxSpanMm') or 0):.1f}",
            f"{float(r.get('napDirectionDeg') or 0):.1f}",
            str(r.get("updatedAt", ""))[:16],
        ]
        for r in data[:21]
    ]
    draw_table(d, (40, 150), headers, rows, [250, 145, 130, 170, 170, 120, 300], row_h=58)
    save(img, "06_scrappiece_table_sample.png")


def asset_tx_table() -> None:
    data = load_json_list("transaction_sample.json")
    img, d = new_canvas("История операций ScrapTransaction", "Последние операции и источники изменений")
    headers = ["transAt", "transType", "statusBefore", "statusAfter", "sourceRef", "note"]
    if len(data) < 22:
        mul = (22 + max(1, len(data)) - 1) // max(1, len(data))
        data = (data * mul)[:22]
    rows = [
        [
            str(r.get("transAt", ""))[:16],
            str(r.get("transType", "")),
            str(r.get("statusBefore", "")),
            str(r.get("statusAfter", "")),
            str(r.get("sourceRef", ""))[:22],
            str(r.get("note", ""))[:30],
        ]
        for r in data[:21]
    ]
    draw_table(d, (34, 150), headers, rows, [220, 120, 160, 155, 220, 930], row_h=58)
    save(img, "07_transaction_history_sample.png")


def asset_migrations_tables() -> None:
    migs = load_json_list("migrations.json")
    tbls = load_json_list("table_counts.json")
    img, d = new_canvas("Эксплуатационный контур: миграции и наполнение", "Схема управляемых изменений БД")
    d.text((90, 180), "SchemaMigrations", fill=TITLE, font=font(30, bold=True))
    draw_table(
        d,
        (90, 230),
        ["fileName", "appliedAt"],
        [[str(m.get("fileName", "")), str(m.get("appliedAt", ""))[:16]] for m in migs[:10]],
        [760, 280],
        row_h=50,
    )
    d.text((1030, 180), "Ключевые таблицы (count)", fill=TITLE, font=font(30, bold=True))
    draw_table(
        d,
        (1030, 230),
        ["tableName", "rows"],
        [[str(t.get("tableName", "")), str(t.get("cnt", ""))] for t in tbls[:17]],
        [520, 220],
        row_h=50,
    )
    save(img, "08_migrations_and_table_counts.png")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    asset_architecture()
    asset_er_core()
    asset_status_distribution()
    asset_status_rules()
    asset_traceability()
    asset_scrappiece_table()
    asset_tx_table()
    asset_migrations_tables()
    print(f"Generated assets in: {OUT_DIR}")


if __name__ == "__main__":
    main()
