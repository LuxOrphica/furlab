#!/usr/bin/env python3
"""
Диагностика R2 gap: для каждого куска вычислить вклад в разрыв covC - covF.
Per-piece: R2_k = (alignedCoreContour ∩ zone).area - (inZoneCoreContour).area

Запуск: python diagnose_r2_gap.py <run.json>
"""
import sys, json, math
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid

EROSION_MM = 1.5

def P(pts):
    return make_valid(Polygon([(p['x'], p['y']) for p in pts]))

def main(path):
    d = json.load(open(path, encoding='utf-8'))
    eo = d.get('effectiveOptions', {})
    pl_raw = [p for p in d['placements'] if not p.get('isTerritoryPlaceholder')]
    zone = P(d['zone']['points'])
    zA = zone.area

    rows = []
    for p in pl_raw:
        tag = p.get('inventoryTag', '?')
        core_full = P(p['alignedCoreContour']) if p.get('alignedCoreContour') else None
        core_frag = P(p['inZoneCoreContour'])  if p.get('inZoneCoreContour')  else None

        a_full = core_full.intersection(zone).area if core_full else 0.0
        a_frag = core_frag.area                    if core_frag else 0.0

        gap_k = a_full - a_frag
        rows.append((gap_k, a_full, a_frag, tag, p))

    rows.sort(key=lambda r: -r[0])

    total_gap  = sum(r[0] for r in rows)
    total_full = sum(r[1] for r in rows)
    total_frag = sum(r[2] for r in rows)

    print('=' * 72)
    print('R2 GAP BREAKDOWN  %s' % path.split('/')[-1].split('\\')[-1])
    print('zone area = %.0f mm2' % zA)
    print()
    print('Сводка per-piece (core_full∩zone) - (frag):')
    print('%-20s  %8s  %8s  %8s  %6s' % ('tag', 'full∩zone', 'frag', 'gap_k', 'gap%'))
    print('-' * 72)
    accum = 0.0
    for gap_k, a_full, a_frag, tag, p in rows[:25]:
        pct_zone = gap_k / zA * 100
        accum += gap_k
        print('%-20s  %8.0f  %8.0f  %8.0f  %5.2f%%' % (tag, a_full, a_frag, gap_k, pct_zone))

    print('-' * 72)
    print('%-20s  %8.0f  %8.0f  %8.0f  %5.2f%%' % (
        'ИТОГО', total_full, total_frag, total_gap, total_gap / zA * 100))
    print()
    print('Замечание: если total_gap / zA ≈ R2_pp/100 — разбивка полная.')
    print('           Расхождение = Union-overlap между кусками (нормально).')
    print()

    # Куски с gap > 100 мм²: что случилось?
    big = [(gap_k, a_full, a_frag, tag, p) for gap_k, a_full, a_frag, tag, p in rows if gap_k > 100]
    if big:
        print('=== ДЕТАЛИ кусков с gap > 100 мм² ===')
        for gap_k, a_full, a_frag, tag, p in big:
            print()
            print('  TAG: %s   gap=%.0f мм²   full∩zone=%.0f   frag=%.0f' % (tag, gap_k, a_full, a_frag))
            # Вычислим "surplus" — часть full∩zone, которой нет во fragment
            core_full = P(p['alignedCoreContour'])
            core_frag = P(p['inZoneCoreContour'])
            surplus = core_full.intersection(zone).difference(core_frag)
            for part in ([surplus] if surplus.geom_type == 'Polygon' else
                         [g for g in surplus.geoms if g.geom_type == 'Polygon']):
                if part.area < 10: continue
                c = part.centroid
                ero = part.buffer(-EROSION_MM).area
                print('    SURPLUS: %.0f мм²  центр(%.0f, %.0f)  erodable=%s' % (
                    part.area, c.x, c.y, 'yes' if ero > 1 else 'no(sliver)'))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python diagnose_r2_gap.py <run.json>'); sys.exit(2)
    main(sys.argv[1])
