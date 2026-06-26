import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon


def as_polygon(points: List[Dict[str, float]]) -> Polygon:
    ring = [(float(p["x"]), float(p["y"])) for p in points]
    if len(ring) < 3:
        return Polygon()
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        return Polygon()
    if poly.geom_type != "Polygon":
        # keep largest component
        geoms = list(getattr(poly, "geoms", []))
        polys = [g for g in geoms if g.geom_type == "Polygon"]
        if not polys:
            return Polygon()
        poly = max(polys, key=lambda x: x.area)
    return poly


def rasterize_poly(poly: Polygon, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    m = np.zeros((len(xs), len(ys)), dtype=bool)
    if poly.is_empty:
        return m
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            if poly.covers(Point(float(x), float(y))):
                m[i, j] = True
    return m


@dataclass(frozen=True)
class Placement:
    piece_id: str
    x: float
    y: float
    theta_deg: float
    gain_cells: int
    overlap_cells: int


class OracleSolver:
    def __init__(
        self,
        zone_poly: Polygon,
        pieces: List[Tuple[str, Polygon]],
        r_preview: float = 10.0,
        r_final: float = 2.0,
        theta_min: float = -15.0,
        theta_max: float = 15.0,
        n_angles: int = 12,
        lambda_overlap: float = 1.0,
        max_iter: int = 200,
        seed: int = 0,
    ):
        self.zone = zone_poly
        self.zone_bounds = self.zone.bounds
        self.pieces = [(pid, p.buffer(0) if not p.is_valid else p) for pid, p in pieces if not p.is_empty]
        self.r_preview = float(r_preview)
        self.r_final = float(r_final)
        self.theta_min = float(theta_min)
        self.theta_max = float(theta_max)
        self.n_angles = int(max(1, n_angles))
        self.lambda_overlap = float(lambda_overlap)
        self.max_iter = int(max_iter)
        self.rng = np.random.default_rng(int(seed))
        self.placements: List[Placement] = []

    def _build_grid(self, r: float):
        minx, miny, maxx, maxy = self.zone_bounds
        xs = np.arange(minx, maxx + r, r, dtype=float)
        ys = np.arange(miny, maxy + r, r, dtype=float)
        mask_t = rasterize_poly(self.zone, xs, ys)
        k = np.zeros(mask_t.shape, dtype=np.uint16)
        return xs, ys, mask_t, k

    def _pick_target(self, mask_t: np.ndarray, k: np.ndarray) -> Optional[Tuple[int, int]]:
        uc = mask_t & (k == 0)
        idx = np.argwhere(uc)
        if len(idx) == 0:
            return None
        i = self.rng.integers(0, len(idx))
        return int(idx[i][0]), int(idx[i][1])

    def _piece_anchors(self, poly: Polygon) -> List[Tuple[float, float]]:
        c = poly.centroid
        pts = [(float(c.x), float(c.y))]
        ext = list(poly.exterior.coords[:-1])
        if len(ext) > 0:
            step = max(1, len(ext) // 6)
            for i in range(0, len(ext), step):
                pts.append((float(ext[i][0]), float(ext[i][1])))
        return pts[:8]

    def _candidate_score(self, cand_poly: Polygon, xs: np.ndarray, ys: np.ndarray, mask_t: np.ndarray, k: np.ndarray):
        m = rasterize_poly(cand_poly, xs, ys) & mask_t
        gain = int(np.count_nonzero(m & (k == 0)))
        overlap = int(np.count_nonzero(m & (k > 0)))
        score = float(gain) - self.lambda_overlap * float(overlap)
        return score, gain, overlap, m

    def solve_preview(self):
        xs, ys, mask_t, k = self._build_grid(self.r_preview)
        angles = np.linspace(self.theta_min, self.theta_max, self.n_angles, dtype=float)
        used = set()

        for _ in range(self.max_iter):
            t = self._pick_target(mask_t, k)
            if t is None:
                break
            ti, tj = t
            tx, ty = float(xs[ti]), float(ys[tj])
            best = None
            for pid, piece in self.pieces:
                if pid in used:
                    continue
                anchors = self._piece_anchors(piece)
                for ai, (ax, ay) in enumerate(anchors):
                    for a in angles:
                        p = rotate(piece, float(a), origin=(ax, ay), use_radians=False)
                        p = translate(p, xoff=(tx - ax), yoff=(ty - ay))
                        if p.is_empty:
                            continue
                        score, gain, overlap, m = self._candidate_score(p, xs, ys, mask_t, k)
                        if gain <= 0:
                            continue
                        if best is None or score > best["score"]:
                            best = {
                                "pid": pid,
                                "x": tx,
                                "y": ty,
                                "theta": float(a),
                                "score": score,
                                "gain": gain,
                                "overlap": overlap,
                                "mask": m,
                            }
            if best is None:
                continue
            k[best["mask"]] = k[best["mask"]] + 1
            used.add(best["pid"])
            self.placements.append(
                Placement(
                    piece_id=str(best["pid"]),
                    x=float(best["x"]),
                    y=float(best["y"]),
                    theta_deg=float(best["theta"]),
                    gain_cells=int(best["gain"]),
                    overlap_cells=int(best["overlap"]),
                )
            )

        uc = mask_t & (k == 0)
        ov = mask_t & (k > 1)
        cell_area = float(self.r_preview * self.r_preview)
        uncovered = int(np.count_nonzero(uc)) * cell_area
        overlap = int(np.count_nonzero(ov)) * cell_area
        covered = int(np.count_nonzero(mask_t)) - int(np.count_nonzero(uc))
        coverage = (float(covered) / float(max(1, np.count_nonzero(mask_t)))) * 100.0
        return {
            "coveragePercent": coverage,
            "uncoveredMm2": uncovered,
            "overlapMm2": overlap,
            "placementsCount": len(self.placements),
            "placements": [p.__dict__ for p in self.placements],
        }


def run_case(case_obj: Dict[str, Any]) -> Dict[str, Any]:
    zone = as_polygon(case_obj["zone"]["points"])
    pieces = []
    for p in case_obj.get("pieces", []):
        poly = as_polygon(p["points"])
        if poly.is_empty:
            continue
        pieces.append((str(p.get("id", "")), poly))
    params = case_obj.get("params", {})
    solver = OracleSolver(
        zone_poly=zone,
        pieces=pieces,
        r_preview=float(params.get("rPreview", 10.0)),
        r_final=float(params.get("rFinal", 2.0)),
        theta_min=float(params.get("thetaMin", -15.0)),
        theta_max=float(params.get("thetaMax", 15.0)),
        n_angles=int(params.get("nAngles", 12)),
        lambda_overlap=float(params.get("lambdaOverlap", 1.0)),
        max_iter=int(params.get("maxIter", 200)),
        seed=int(case_obj.get("seed", 0)),
    )
    out = solver.solve_preview()
    out["caseName"] = str(case_obj.get("name", "unnamed"))
    out["seed"] = int(case_obj.get("seed", 0))
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, help="Path to case json")
    args = ap.parse_args()
    with open(args.case, "r", encoding="utf-8") as f:
        case_obj = json.load(f)
    result = run_case(case_obj)
    print(json.dumps(result, ensure_ascii=False, indent=2))

