#!/usr/bin/env python3
"""
Диагностика R2-разрыва: для каждого placement печатает
area(core∩zone), area(frag), diff и топ-10 по потере.
"""
import sys, json
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid

def P(pts):
    return make_valid(Polygon([(p['x'], p['y']) for p in pts]))

path = sys.argv[1] if len(sys.argv) > 1 else None
if not path:
    import glob, os
    files = sorted(glob.glob('F:/FURLAB/Тест/вороной тест/voronoi_sa_run_zone_1_*.json'))
    path = files[-1]

print("FILE:", path)
d = json.load(open(path))
zone = P(d['zone']['points'])
zA = zone.area

pl = [p for p in d['placements'] if not p.get('isTerritoryPlaceholder')]

rows = []
for p in pl:
    core = P(p['alignedCoreContour']) if p.get('alignedCoreContour') else None
    frag = P(p['inZoneCoreContour']) if p.get('inZoneCoreContour') else None
    core_in_zone = core.intersection(zone).area if core else 0
    frag_area    = frag.intersection(zone).area if frag else 0
    diff = core_in_zone - frag_area
    rows.append((p.get('inventoryTag','?'), core_in_zone, frag_area, diff))

rows.sort(key=lambda r: -r[3])

print(f"\n{'TAG':<22} {'core_zone':>10} {'frag':>10} {'loss':>10} {'loss%':>7}")
print('-'*65)
for tag, cz, fa, diff in rows[:15]:
    pct = diff/cz*100 if cz else 0
    print(f"{tag:<22} {cz:>10.0f} {fa:>10.0f} {diff:>10.0f} {pct:>6.1f}%")

total_core = sum(r[1] for r in rows)
total_frag = sum(r[2] for r in rows)
print('-'*65)
print(f"{'TOTAL':<22} {total_core:>10.0f} {total_frag:>10.0f} {total_core-total_frag:>10.0f}")
print(f"\nR2 = {(total_core-total_frag)/zA*100:.2f}пп  zone={zA:.0f}мм²")
