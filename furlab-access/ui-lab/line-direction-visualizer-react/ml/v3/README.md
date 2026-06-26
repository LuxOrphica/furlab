# v3 ML Pilot (Mezdra Segmentation)

Цель: выделять **мездру** (не мех) как бинарную маску и строить внешний контур.

## Структура
- `ml/datasets/mezdra_v1/images` — исходные сканы (`.png/.jpg`)
- `ml/datasets/mezdra_v1/masks` — бинарные маски мездры (`0/255`, тот же размер, имя файла такое же)
- `ml/runs` — чекпоинты обучения
- `ml/preds` — результаты инференса

## Установка
```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r ml/v3/requirements.txt
```

## Быстрая подготовка датасета
Скопировать ваши реальные сканы:
```bash
python ml/v3/prepare_dataset.py \
  --src "ui-lab/assets/uploads" \
  --dst "ml/datasets/mezdra_v1/images" \
  --pattern "Gemini_Generated_Image_*.png"
```

Разметить маски (полуавто GrabCut):
```bash
python ml/v3/annotate_grabcut.py \
  --images "ml/datasets/mezdra_v1/images" \
  --masks "ml/datasets/mezdra_v1/masks"
```

Управление в окне разметки:
- `r` — выбрать ROI мышью
- `f` — FG-кисть (мездра)
- `b` — BG-кисть (фон/мех)
- `g` — запустить GrabCut
- `s` — сохранить маску
- `n` — следующий файл
- `q` — выход

## Обучение
```bash
python ml/v3/train.py \
  --images "ml/datasets/mezdra_v1/images" \
  --masks "ml/datasets/mezdra_v1/masks" \
  --out "ml/runs/mezdra_unet_v1.pt" \
  --epochs 40 --img-size 512 --batch-size 4
```

## Инференс + контур
```bash
python ml/v3/infer.py \
  --model "ml/runs/mezdra_unet_v1.pt" \
  --input "ui-lab/assets/uploads/Gemini_Generated_Image_t6n2yot6n2yot6n2.png" \
  --out-mask "ml/preds/t6n2_mask.png" \
  --out-json "ml/preds/t6n2_contour.json"
```

`out-json` содержит:
- `bbox`
- `area`
- `processingTimeMs`
- `contour` (внешний)

## Критерий на пилоте
- контур идет по мездре, не по бахроме
- без срыва в узкий контур
- время инференса приемлемо

## Единый датасет (рекомендованный поток)
Чтобы не терять данные из `data/training/annotations.ndjson`, сначала собираем
единый датасет `ml/datasets/mezdra_unified_v1`:

```bash
npm run ml:sync-unified
```

Потом учим модель только на unified-наборе:

```bash
npm run ml:train-unified
```

---

## Teacher -> Student (без ломки baseline)
Идея: используем текущий rule-based контур как teacher (маска `masks_teacher`),
а вручную отредактированный контур как target (`masks_gt`).
ML не заменяет baseline, а учится улучшать его.

### 1) Сбор датасета из `data/training/annotations.ndjson`
```bash
python ml/v3/build_teacher_student_dataset.py ^
  --annotations "data/training/annotations.ndjson" ^
  --out "ml/datasets/mezdra_ts_v1" ^
  --search-dirs "ui-lab/assets/uploads" "ml/datasets/mezdra_v1/images" ^
  --latest-per-image --manual-only
```

Выход:
- `ml/datasets/mezdra_ts_v1/images`
- `ml/datasets/mezdra_ts_v1/masks_teacher`
- `ml/datasets/mezdra_ts_v1/masks_gt`
- `ml/datasets/mezdra_ts_v1/report.csv`

### 2) Обучение refiner (RGB + teacher mask -> GT mask)
```bash
python ml/v3/train_refiner.py ^
  --dataset "ml/datasets/mezdra_ts_v1" ^
  --out "ml/runs/mezdra_refiner_v1.pt" ^
  --epochs 40 --img-size 512 --batch-size 4
```

### 3) Инференс refiner
```bash
python ml/v3/infer_refiner.py ^
  --model "ml/runs/mezdra_refiner_v1.pt" ^
  --input "ui-lab/assets/uploads/Gemini_Generated_Image_t6n2yot6n2yot6n2.png" ^
  --out-mask "ml/preds/t6n2_refined_mask.png" ^
  --out-json "ml/preds/t6n2_refined_contour.json"
```

### 4) Пакетная оценка refiner
```bash
python ml/v3/eval_folder.py ^
  --infer-script infer_refiner.py ^
  --model "ml/runs/mezdra_refiner_v1.pt" ^
  --input-dir "ml/datasets/mezdra_ts_v1/images" ^
  --out-dir "ml/preds/mezdra_ts_v1_refiner_eval" ^
  --thr 0.5
```
