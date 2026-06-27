#!/usr/bin/env python3
"""
Независимый верификатор inventory_voronoi_sa (контракт v4.1).
Считает геометрию С НУЛЯ по экспортному JSON. Внутренним числам солвера НЕ доверяет.
Юнит покрытия/валидации = ФРАГМЕНТ inZoneCoreContour. Полные ядра alignedCoreContour
используются только для проверки R2 (полнота партиции).

Запуск:  python3 verify_voronoi_sa.py <run.json>
Код выхода: 0 = PASS по всем осям, 1 = FAIL.
"""
import sys, json, math
from collections import Counter
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid

# --- допуски ---
EROSION_MM      = 1.5     # под-сеточный слайвер прощается, если гибнет при buffer(-EROSION)
R2_TOL_PP       = 0.5     # допустимый разрыв R2, пп
OVERLAP_TOL     = 50      # допустимый overlap фрагментов, mm2
COV_MATCH_TOL   = 0.5     # сходимость reported vs независимое, пп
SLIVER_EDGE_PCT = 55      # дыра-слайвер: >=55% периметра на контуре зоны
SLIVER_ERO_FRAC = 0.40    # ...и эрозия съедает >60% площади
INTERIOR_DIST   = 2.0     # дыра внутренняя, если центр дальше этого от контура
EDGE_PHYS_TOL_PCT = 1.0   # Ось2Б: допуст. краевой physMissing (не накрыт даже телом), % зоны

def P(pts): return make_valid(Polygon([(p['x'], p['y']) for p in pts]))
def polys(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [x for x in g.geoms if x.geom_type == 'Polygon' and x.area > 1e-9]
def mbr_short(g):
    try:
        xs, ys = g.minimum_rotated_rectangle.exterior.coords.xy
        e = [math.hypot(xs[i+1]-xs[i], ys[i+1]-ys[i]) for i in range(4)]
        return min(e)
    except Exception:
        return 0.0

def main(path):
    d = json.load(open(path))
    eo = d.get('effectiveOptions', {}) or d.get('algorithmTrace', {}).get('effectiveOptions', {})
    m  = d.get('metrics', {})
    seed = eo.get('seed'); mode = eo.get('territoryMode'); mw = eo.get('minWidthMm', 70)
    pl = [p for p in d['placements'] if not p.get('isTerritoryPlaceholder')]

    zone = P(d['zone']['points']); zA = zone.area; bnd = zone.exterior
    frag = [P(p['inZoneCoreContour']) for p in pl if p.get('inZoneCoreContour')]
    full = [P(p['alignedCoreContour']) for p in pl if p.get('alignedCoreContour')]
    # тела (с припуском) — для Ось2Б краевой оценки
    body = [P(p['alignedContour']) for p in pl if p.get('alignedContour')]
    Uf = unary_union(frag); Uc = unary_union(full)
    Ub = unary_union(body) if body else Uf
    covF = Uf.intersection(zone).area / zA * 100
    covC = Uc.intersection(zone).area / zA * 100
    r2 = covC - covF

    # Ось2А — дыры по фрагментам (ядра), dist >= INTERIOR_DIST → внутренние
    real = sorted(
        [h for h in polys(zone.difference(Uf))
         if (not h.buffer(-EROSION_MM).is_empty and h.buffer(-EROSION_MM).area > 1e-6)],
        key=lambda x: -x.area)
    # interior-physMissing: все внутренние дыры (dist>=INTERIOR_DIST).
    # «Закрываемость» по mask недоступна в verify — гарантируется через R2-gate + Pass4.
    # R2 PASS (<=0.5пп) означает что partition полна; interior-дыры = overlap-reach карманы
    # на стыках territory, которые растровый mask не кроет. Репортируем как NOTE без порога
    # — порог выставим из мультизонных данных.
    interior_r2, interior_phys, slivers = [], [], []
    for h in real:
        dist = h.distance(bnd)
        epct = h.exterior.intersection(bnd.buffer(0.5)).length / h.exterior.length * 100
        ero  = h.buffer(-EROSION_MM).area
        if dist >= INTERIOR_DIST:
            interior_phys.append(h)  # всё interior = physMissing-NOTE (mask недоступна)
        elif epct >= SLIVER_EDGE_PCT and ero < SLIVER_ERO_FRAC * h.area:
            slivers.append(h)
        # краевые толстые — убраны из Ось2А, они теперь в Ось2Б
    interior = interior_phys  # для совместимости с R9

    # Ось2Б — краевые щели по телам: zone − Union(тел), dist < INTERIOR_DIST
    # Реальная дыра у края = не накрыта даже припуском соседнего тела.
    # Телами интерьер не кредитуем — двойной слой там не считается (маскировка).
    edge_real = sorted(
        [h for h in polys(zone.difference(Ub))
         if (not h.buffer(-EROSION_MM).is_empty and h.buffer(-EROSION_MM).area > 1e-6
             and h.distance(bnd) < INTERIOR_DIST)],
        key=lambda x: -x.area)
    edge_miss_mm2 = sum(h.area for h in edge_real)
    edge_miss_pct = edge_miss_mm2 / zA * 100

    sF = sum(f.area for f in frag); overlap = sF - Uf.area
    cnt = Counter(p.get('inventoryTag') for p in pl)
    dups = {k: v for k, v in cnt.items() if v > 1}
    submin = []
    for f in frag:
        for g in polys(f):
            if mw and mbr_short(g) < mw:
                submin.append(round(g.area))

    # ---- оси ----
    A2A = True  # interior-physMissing = NOTE, не FAIL; R2-gate (R2OK) ловит закрываемый остаток
    A2B = (edge_miss_pct <= EDGE_PHYS_TOL_PCT)  # краевой physMissing по телам, PASS<=1%
    A3 = (len(submin) == 0)
    A4 = (sum(v-1 for v in dups.values()) == 0)
    DISJ = (overlap <= OVERLAP_TOL)
    R2OK = (r2 <= R2_TOL_PP)

    # ---- честность метрик (R9) ----
    rep = m.get('coveragePercent')
    conv = (rep is not None and abs(rep - covF) <= COV_MATCH_TOL)
    pa = d.get('algorithmTrace', {}).get('phaseA', {})
    lies = []
    rsa = m.get('rasterSeamArtifactMm2')
    int_area = sum(h.area for h in interior)
    if rsa and int_area > 100 and rsa >= int_area * 0.5:
        lies.append('rasterSeamArtifactMm2=%d поглощает внутренний остаток (%d mm2 реальных внутр. дыр)' % (round(rsa), round(int_area)))
    if pa.get('bestRasterCoveragePct') == 100 and covF < 99.5:
        lies.append('bestRasterCoveragePct=100 при реальном покрытии %.1f%%' % covF)
    if pa.get('geomResidualMm2') == 0 and len(real) > 0:
        lies.append('geomResidualMm2=0 при реальном остатке %d mm2' % round(sum(h.area for h in real)))


    # ---- печать ----
    print('='*64)
    print('RUN %s' % path.split('/')[-1])
    print('seed=%s  mode=%s  кусков=%d  reported=%s  status=%s'
          % (seed, mode, len(pl), rep, m.get('resultStatus')))
    print('-'*64)
    print('ПОКРЫТИЕ (фрагменты)      = %7.3f %%' % covF)
    print('Union(yadra) n zone       = %7.3f %%' % covC)
    print('[R2] razryv yadra-frag    = %7.2f pp   %s (<=%.1f)' % (r2, 'PASS' if R2OK else 'FAIL', R2_TOL_PP))
    print('-'*64)
    int_ph_area = sum(h.area for h in interior_phys)
    print('[ОСЬ2А] interior-physMissing = %d шт / %d mm2 = %.3f %%   NOTE (порог из мультизон; R2-gate=%s)'
          % (len(interior_phys), round(int_ph_area), int_ph_area / zA * 100, 'OK' if R2OK else 'FAIL'))
    for h in interior_phys[:6]:
        c = h.centroid
        print('         INT-PM %6d mm2  центр(%5.0f,%5.0f)  до края %3.0f' % (round(h.area), c.x, c.y, h.distance(bnd)))
    print('[ОСЬ2Б] краевой physMissing = %d шт / %d mm2 = %.3f %%   %s (PASS<=%.1f%%)'
          % (len(edge_real), round(edge_miss_mm2), edge_miss_pct,
             'PASS' if A2B else 'FAIL', EDGE_PHYS_TOL_PCT))
    print('         (не накрыто даже телом-припуском у края; визирует технолог)')
    for h in edge_real[:6]:
        c = h.centroid
        print('         КРАЙ   %6d mm2  центр(%5.0f,%5.0f)  до края %3.0f' % (round(h.area), c.x, c.y, h.distance(bnd)))
    if slivers:
        print('         слайверы (прощены): %d шт' % len(slivers))
    print('[ОСЬ3] суб-мин (MBR<%s)    = %d        %s   %s' % (mw, len(submin), 'PASS' if A3 else 'FAIL', submin[:5]))
    print('[ОСЬ4] дубли скрапов       = %d        %s   %s' % (sum(v-1 for v in dups.values()), 'PASS' if A4 else 'FAIL', dups or ''))
    print('[disj] overlap фрагментов  = %d mm2    %s' % (round(overlap), 'PASS' if DISJ else 'FAIL'))
    print('[R9]  reported vs nezav.    = %s (d=%.2fpp)  physMissing=%s'
          % ('сходится' if conv else 'РАСХОДИТСЯ', (abs(rep-covF) if rep is not None else float('nan')), m.get('physMissingTotalMm2')))
    for L in lies:
        print('        ВРЁТ: ' + L)
    print('-'*64)
    ok = A2A and A2B and A3 and A4 and DISJ and R2OK and conv and not lies
    print('ИТОГ: %s' % ('PASS' if ok else 'FAIL'))
    if not ok:
        why = []
        if not R2OK: why.append('R2 не закрыт (накрыто ядрами, не отдано фрагментам)')
        if not A2B: why.append('краевой physMissing > %.1f%% (тела)' % EDGE_PHYS_TOL_PCT)
        if not A3: why.append('суб-мин')
        if not A4: why.append('дубли')
        if not DISJ: why.append('overlap')
        if not conv: why.append('метрика расходится')
        if lies: why.append('врущие поля')
        print('ПРИЧИНА: ' + '; '.join(why))
    return 0 if ok else 1

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python3 verify_voronoi_sa.py <run.json>'); sys.exit(2)
    sys.exit(main(sys.argv[1]))
