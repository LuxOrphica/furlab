#!/usr/bin/env python3
"""
Diagnostika Shaga 3: klassifikaciya kraevykh provalov po zakryvaemosti.

Dlya kazhdogo tolstogo provala (thickgap iz Os'2) proveryaet:
  1. Est' li NEISPOL'ZOVANNYY kandidat iz inventory, chej bboxMinMm >= minWidthMm
     I areaMm2 >= MIN_COVER_FRAC * provala (kusok fizicheski mozhet napolnit' proval)
  2. Otsutstviye v placements (esli tag ne vstrechen => ne ispol'zovan)

VNIMANIE: geometriya kandidatov v JSON ne khranitsya (tol'ko bbox/area).
Otsyuda: otsutstviye geometrii => otsenka PRIBLIZITEL'NAYA po bbox.
  "Zakryvaemyy" = est' kandidat s fizikami, dostatochnymi dlya vklyuchivaniya v proval.
  Garantii razmeshcheniya bez povorota i NFP - net.

Zapusk: python diagnose_step3.py <run.json>
"""
import sys, json, math
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid

EROSION_MM      = 1.5
INTERIOR_DIST   = 2.0
SLIVER_EDGE_PCT = 55
SLIVER_ERO_FRAC = 0.40
MIN_COVER_FRAC  = 0.25   # kandidat dolzhen imet' area >= 25% provala

def P(pts):
    return make_valid(Polygon([(p['x'], p['y']) for p in pts]))

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
    d = json.load(open(path, encoding='utf-8'))
    eo = d.get('effectiveOptions', {})
    min_w = eo.get('minWidthMm', 70)
    seed  = eo.get('seed')
    mode  = eo.get('territoryMode')

    pl_raw = [p for p in d['placements'] if not p.get('isTerritoryPlaceholder')]
    cands  = d.get('candidates', [])

    zone = P(d['zone']['points'])
    zA   = zone.area
    bnd  = zone.exterior

    frag = [P(p['inZoneCoreContour']) for p in pl_raw if p.get('inZoneCoreContour')]
    Uf   = unary_union(frag)

    # --- tolstye provaly (kopiya logiki verify) ---
    real = sorted(
        [h for h in polys(zone.difference(Uf))
         if not h.buffer(-EROSION_MM).is_empty and h.buffer(-EROSION_MM).area > 1e-6],
        key=lambda x: -x.area)
    interior, thickgap = [], []
    for h in real:
        dist = h.distance(bnd)
        epct = (h.exterior.intersection(bnd.buffer(0.5)).length
                / h.exterior.length * 100) if h.exterior.length > 0 else 0
        ero  = h.buffer(-EROSION_MM).area
        if dist >= INTERIOR_DIST:
            interior.append(h)
        elif not (epct >= SLIVER_EDGE_PCT and ero < SLIVER_ERO_FRAC * h.area):
            thickgap.append(h)

    used_tags = set(p.get('inventoryTag') for p in pl_raw)

    # --- neispol'zovannye kandidaty (tol'ko metadannye, ne geometriya) ---
    unused = []
    for c in cands:
        tag = c.get('inventoryTag') or c.get('tag')
        if tag in used_tags:
            continue
        bbox_w = c.get('bboxWidthMm', 0)
        bbox_h = c.get('bboxHeightMm', 0)
        bbox_min = min(bbox_w, bbox_h)
        area_mm2 = c.get('areaMm2', 0)
        unused.append({
            'tag': tag,
            'bbox_min': bbox_min,
            'bbox_max': max(bbox_w, bbox_h),
            'area_mm2': area_mm2,
            'valid_width': bbox_min >= min_w,
        })

    print('=' * 70)
    print('DIAGNOSE STEP3  %s' % path.replace('\\', '/').split('/')[-1])
    print('seed=%s  mode=%s  kuskov=%d  kandidatov=%d  neispol=%d'
          % (seed, mode, len(pl_raw), len(cands), len(unused)))
    print('minWidthMm=%s  MIN_COVER_FRAC=%.0f%%' % (min_w, MIN_COVER_FRAC * 100))
    print('Tolstykh provalov (thickgap): %d  summy %d mm2'
          % (len(thickgap), round(sum(h.area for h in thickgap))))
    if interior:
        print('Vnutrennikh dyr (spravka): %d  summa %d mm2'
              % (len(interior), round(sum(h.area for h in interior))))
    print('VNIMANIE: geometriya neispol. kandidatov otsustvuet -- otsenka PO BBOX')
    print('-' * 70)

    closeable_mm2   = 0.0
    uncloseable_mm2 = 0.0

    for i, gap in enumerate(thickgap, 1):
        c    = gap.centroid
        dist = gap.distance(bnd)
        mbr  = mbr_short(gap)
        print('\n[PROVAL #%d]  %d mm2  centr(%.0f,%.0f)  do kraya %.1f mm  MBR_short=%.0f mm'
              % (i, round(gap.area), c.x, c.y, dist, mbr))

        # skoree vsego provaly u kraya -> rasstoyanie do bnd ~ 0
        # iskhem kandidatov, chem pokryt'

        # Klyuchevaya proverka: esli proval sam uzhe minWidth -> lyuboy frag tam budet sub-min
        if mbr < min_w:
            print('  !! MBR_short provala (%.0f mm) < minWidthMm (%s mm)' % (mbr, min_w))
            print('     => lyuboy kusok tam dayet sub-min fragment => SA otbrakuyet => istinnyy physMissing')
            uncloseable_mm2 += gap.area
            continue

        valid_hits   = [u for u in unused if u['valid_width'] and u['area_mm2'] >= gap.area * MIN_COVER_FRAC]
        invalid_hits = [u for u in unused if not u['valid_width'] and u['area_mm2'] >= gap.area * MIN_COVER_FRAC]

        if valid_hits:
            print('  ZAKRYVAEMYY -- est\' %d kandidatov s bbox_min >= %s mm i area >= %.0f mm2:'
                  % (len(valid_hits), min_w, gap.area * MIN_COVER_FRAC))
            for u in sorted(valid_hits, key=lambda x: -x['area_mm2'])[:5]:
                print('    %-18s  bbox=%.0fx%.0f mm  area=%d mm2'
                      % (u['tag'], u['bbox_min'], u['bbox_max'], round(u['area_mm2'])))
            closeable_mm2 += gap.area
        elif invalid_hits:
            print('  CHASTICHNO -- est\' %d kandidatov, no vse sub-min (bbox_min < %s mm):'
                  % (len(invalid_hits), min_w))
            for u in sorted(invalid_hits, key=lambda x: -x['area_mm2'])[:3]:
                print('    %-18s  bbox_min=%.0f mm  area=%d mm2'
                      % (u['tag'], u['bbox_min'], round(u['area_mm2'])))
            uncloseable_mm2 += gap.area
        else:
            print('  NET KANDIDATOV (vse ispolzovany ili slishkom maly) -- istinnyy physMissing')
            uncloseable_mm2 += gap.area

    # --- stat iska gde yadra size khitov ---
    print('\n' + '=' * 70)
    total_gap = closeable_mm2 + uncloseable_mm2
    print('ITOGO PROVALOV:  %d mm2' % round(total_gap))
    print('  Zakryvaemye (est\' validnyy kandidat po bbox): %d mm2  (%.0f%%)'
          % (round(closeable_mm2), closeable_mm2 / total_gap * 100 if total_gap else 0))
    print('  NE zakryvaemye (istinnyy physMissing):        %d mm2  (%.0f%%)'
          % (round(uncloseable_mm2), uncloseable_mm2 / total_gap * 100 if total_gap else 0))
    print()

    # svodka po neispolzovannym kandidatam
    valid_unused = [u for u in unused if u['valid_width']]
    print('Vsego neispol\'zovannykh:  %d' % len(unused))
    print('  s bbox_min >= %s mm (validnye po shirine):  %d' % (min_w, len(valid_unused)))
    print('  s bbox_min <  %s mm (sub-min, SA otbrakuyet): %d' % (min_w, len(unused) - len(valid_unused)))
    if valid_unused:
        total_valid_area = sum(u['area_mm2'] for u in valid_unused)
        print('  Summa ploshchadi validnykh neispol.: %d mm2' % round(total_valid_area))

    print()
    if closeable_mm2 > 0:
        print('VYVOD: Shag 3 imeet smysl -- est\' validnye kandidaty dlya zakrytiya provalov.')
        print('  Tsel\' SA: razm. neispol. kuskov, nakryvayushchikh %d mm2 provalov.' % round(closeable_mm2))
        print('  Otstatok (%d mm2) -- dokumentirovannyy physMissing.' % round(uncloseable_mm2))
    else:
        print('VYVOD: Vse provaly -- istinnyy physMissing (zony provala uzhhe minWidthMm).')
        print('  SA ne zakroyet bez snizheniya minWidthMm. Provaly -- chestnyy physMissing.')
        print('  Shag 3 v forme "razm. eshche kuskov" nedostizim bez izmeneniya kontrakta.')
    print('=' * 70)
    return 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python diagnose_step3.py <run.json>'); sys.exit(2)
    sys.exit(main(sys.argv[1]))
