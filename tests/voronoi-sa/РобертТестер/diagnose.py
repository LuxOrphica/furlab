#!/usr/bin/env python3
"""
Локализатор разрыва R2 для inventory_voronoi_sa. Считает геометрию С НУЛЯ по
экспортному JSON (shapely), не доверяя внутренним числам солвера.

Назначение: ПЕРЕД любым proposal на фикс геометрии — прогнать и приложить вывод.
Показывает ГДЕ теряется площадь, КТО обязан был её взять, и какого ТИПА потеря.
Это не приёмка (для приёмки verify_voronoi_sa.py) — это «куда смотреть».

Запуск: python3 diagnose.py <run.json>
"""
import sys, json
from collections import defaultdict
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid
from itertools import combinations

def P(pts): return make_valid(Polygon([(p['x'], p['y']) for p in pts]))
def polys(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [x for x in g.geoms if x.geom_type == 'Polygon' and x.area > 1e-9]

def main(path):
    d = json.load(open(path))
    eo = d.get('effectiveOptions', {})
    pl = [p for p in d['placements'] if not p.get('isTerritoryPlaceholder')]
    zone = P(d['zone']['points']); zA = zone.area; bnd = zone.exterior

    tags  = [p.get('inventoryTag') for p in pl]
    cores = [P(p['alignedCoreContour']).intersection(zone) if p.get('alignedCoreContour') else None for p in pl]
    frags = [P(p['inZoneCoreContour']) if p.get('inZoneCoreContour') else None for p in pl]
    cores = [c for c in cores if c is not None]
    fr    = [f for f in frags if f is not None]
    Uc = unary_union(cores); Uf = unary_union(fr)
    covC = Uc.intersection(zone).area / zA * 100
    covF = Uf.intersection(zone).area / zA * 100

    print('='*66)
    print('DIAGNOSE %s' % path.split('/')[-1])
    print('seed=%s mode=%s кусков=%d' % (eo.get('seed'), eo.get('territoryMode'), len(pl)))
    print('-'*66)
    print('покрытие фрагменты covF = %6.3f %%' % covF)
    print('Union(yadra) n zone covC = %6.3f %%' % covC)
    print('[R2] razryv = covC-covF = %6.3f pp  = %d mm2' % (covC-covF, round((covC-covF)/100*zA)))
    print('  (frag < core на кусок — НОРМА: наезд ядер уходит соседу по партиции;')
    print('   баг — это ОБЪЕДИНЁННЫЙ разрыв ниже, накрытое ядрами но ничьё)')

    gap = Uc.difference(Uf)
    if gap.area < 1:
        print('\nRAZRYV ~= 0 -- partitsiya otdayet fragmentam vsyo nakrytoye. Lokalizovat nechego.')
        return 0

    # эксклюзив (1 ядро) vs перекрытие (>=2)
    twoplus = unary_union([a.intersection(b) for a, b in combinations(cores, 2) if a.intersects(b)])
    exclusive = Uc.difference(twoplus)
    g_excl = gap.intersection(exclusive).area
    g_over = gap.intersection(twoplus).area
    # блоб vs полоса
    comps = sorted(polys(gap), key=lambda x: -x.area)
    blobA = stripA = intA = 0
    for h in comps:
        er = h.buffer(-1.5).area
        if h.distance(bnd) >= 2.0: intA += h.area
        if h.area > 0 and er/h.area > 0.5: blobA += h.area
        elif h.area > 0 and er/h.area < 0.2: stripA += h.area

    print('-'*66)
    print('РАЗЛОЖЕНИЕ РАЗРЫВА (%d мм²):' % round(gap.area))
    print('  эксклюзив(1 ядро)=%d  перекрытие(>=2)=%d мм²' % (round(g_excl), round(g_over)))
    print('  блобы(толстые)=%d  полосы(граница)=%d  внутренние=%d мм²' % (round(blobA), round(stripA), round(intA)))

    # топ-компоненты: кто накрывает, кто обязан взять
    print('-'*66)
    print('ТОП КОМПОНЕНТЫ РАЗРЫВА (кто должен был покрыть):')
    for i, h in enumerate(comps[:8], 1):
        c = h.centroid
        cov = [tags[k] for k, cc in enumerate(cores) if cc.intersection(h).area > h.area*0.05]
        excl = h.intersection(exclusive).area / h.area > 0.6 if h.area > 0 else False
        kind = 'блоб' if (h.buffer(-1.5).area/h.area > 0.5 if h.area>0 else 0) else 'полоса'
        loc  = 'ВНУТР' if h.distance(bnd) >= 2.0 else 'край'
        if excl and len(cov) == 1:
            verdict = 'EKSKLUZIV -> OBYAZAN vzat %s, ego frag upuskayet (usecheniye core^territory)' % cov[0]
        elif excl:
            verdict = 'эксклюзив, накрывает %s' % (','.join(cov[:3]))
        else:
            verdict = 'перекрытие %d ядер (%s) -> exclusive-фикс НЕ закроет' % (len(cov), ','.join(cov[:3]))
        print('  #%d %5d мм² (%5.0f,%5.0f) %-5s %-5s | %s' % (i, round(h.area), c.x, c.y, loc, kind, verdict))

    # на кусок: сколько разрыва накрывает его ядро (= сколько он обязан был взять)
    print('-'*66)
    print('КУСКИ, ЧЬИ ЯДРА НАКРЫВАЮТ РАЗРЫВ (куда смотреть в первую очередь):')
    deficit = sorted(((cores[k].intersection(gap).area, tags[k], fr_area(frags, pl, k), cores[k].area)
                      for k in range(len(cores))), reverse=True)
    for a, tag, fa, ca in deficit[:8]:
        if a < 50: continue
        print('  %-16s nakryvayet razryva %5d mm2 | frag=%d yadro^zone=%d (%.0f%%)'
              % (tag, round(a), round(fa), round(ca), fa/ca*100 if ca else 0))

    # подсказка
    print('-'*66)
    print('ПОДСКАЗКА:')
    if blobA > 0.6*gap.area:
        print('  Разрыв = в основном ТОЛСТЫЕ БЛОБЫ -> core∩territory режет целые куски.')
        print('  Самая частая причина: mpToPoints берёт только mp[0] (мультиполигон),')
        print('  ИЛИ territory != объединение назначенных ячеек.')
        print('  СЛЕДУЮЩИЙ ШАГ (в коде, не догадкой): для кусков из списка выше залогируй')
        print('    число колец core∩territory ДО mpToPoints + area_territory vs nAssignedCells*9.')
        print('    >1 кольца, а во фрагменте 1 -> чини mpToPoints (все доли) + схему.')
        print('    1 кольцо при свежем билде -> чини построение territory.')
    if g_over > 0.2*gap.area:
        print('  ВНИМАНИЕ: %d мм² разрыва в ПЕРЕКРЫТИИ ядер -> любой exclusive-подход их НЕ закроет.' % round(g_over))
        print('  Их закроет только правильное core∩territory (владелец территории включает свою область).')
    return 0

def fr_area(frags, pl, k):
    f = frags[k]
    return f.area if f is not None else 0.0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python3 diagnose.py <run.json>'); sys.exit(2)
    sys.exit(main(sys.argv[1]))
