# FURLAB -> CLO Import Script
# Run in CLO Python Editor: Edit > Python Script
#
# Imports the latest export ZIP from FurLab and creates pattern pieces.
# Leave ZIP_PATH empty to auto-find the latest furlab_export_*.zip.

import os
import json
import zipfile
import tempfile
import urllib.request

# ---- CONFIG ----
# Leave empty to auto-find the latest furlab_export_*.zip in Downloads or Desktop.
# Or set explicitly: ZIP_PATH = r"C:\Users\...\Downloads\furlab_export_2026-05-15.zip"
ZIP_PATH = r""
# Used when no local ZIP is found. Keep 127.0.0.1 when CLO runs on the same PC.
FURLAB_URL = "http://127.0.0.1:5600"
# ----------------


def log(msg):
    print(f"[FURLAB] {msg}")


def pick_zip_file():
    if ZIP_PATH and os.path.exists(ZIP_PATH):
        return ZIP_PATH

    # Always try server first — guarantees the freshest export.
    downloaded = download_latest_zip()
    if downloaded:
        return downloaded

    # Fall back to user directories (not Temp — stale cached downloads live there).
    home = os.path.expanduser("~")
    userprofile = os.environ.get("USERPROFILE", "")
    onedrive = os.environ.get("OneDrive", "") or os.environ.get("OneDriveConsumer", "")
    search_dirs = [
        os.path.join(home, "Downloads"),
        os.path.join(home, "Desktop"),
        os.path.join(home, "Загрузки"),
        os.path.join(home, "Рабочий стол"),
        os.path.join(userprofile, "Downloads"),
        os.path.join(userprofile, "Desktop"),
        os.path.join(userprofile, "Загрузки"),
        os.path.join(userprofile, "Рабочий стол"),
        os.path.join(onedrive, "Desktop"),
        os.path.join(onedrive, "Рабочий стол"),
    ]
    candidates = []
    seen_dirs = set()
    for d in search_dirs:
        if not d or d in seen_dirs:
            continue
        seen_dirs.add(d)
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.startswith("furlab_export") and f.endswith(".zip"):
                    full = os.path.join(d, f)
                    candidates.append((os.path.getmtime(full), full))
    if candidates:
        candidates.sort(reverse=True)
        log(f"Auto-selected: {candidates[0][1]}")
        return candidates[0][1]

    log("ERROR: FurLab server unavailable and no furlab_export_*.zip found in Downloads or Desktop.")
    log("Keep FurLab server running on port 5600, or set ZIP_PATH explicitly.")
    return None


def download_latest_zip():
    if not FURLAB_URL:
        return None
    url = FURLAB_URL.rstrip("/") + "/api/export/latest-zip"
    out_path = os.path.join(tempfile.gettempdir(), "furlab_export_latest.zip")
    try:
        log(f"Trying FurLab server: {url}")
        with urllib.request.urlopen(url, timeout=10) as response:
            data = response.read()
        if not data or len(data) < 4 or data[:4] != b"PK\x03\x04":
            log("WARNING: FurLab server did not return a ZIP file.")
            return None
        with open(out_path, "wb") as f:
            f.write(data)
        log(f"Downloaded latest ZIP: {out_path}")
        return out_path
    except Exception as e:
        log(f"WARNING: cannot download latest ZIP from FurLab server: {e}")
        return None


def hex_to_rgb_norm(hex_color):
    h = hex_color.lstrip("#")
    return [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]


def extract_zip_preserve_names(zip_path):
    """Extract ZIP to a temp dir, preserving UTF-8/Cyrillic filenames on Windows."""
    tmp_dir = tempfile.mkdtemp(prefix="furlab_")
    log(f"Extracting to: {tmp_dir}")
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            fname = info.filename
            # ZIP spec uses UTF-8 when flag 0x800 is set; otherwise cp437.
            if not (info.flag_bits & 0x800):
                try:
                    fname = fname.encode("cp437").decode("utf-8")
                except Exception:
                    pass
            out_path = os.path.join(tmp_dir, fname.replace("/", os.sep))
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            if not fname.endswith("/"):
                with zf.open(info) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())
    return tmp_dir


def simplify_contour(points, min_dist_mm=1.5):
    """Remove points closer than min_dist_mm and remove spike vertices (acute angle < 8°)."""
    import math
    if len(points) < 3:
        return points

    # Step 1: remove points that are too close to the previous one
    out = [points[0]]
    for p in points[1:]:
        px, py = p[0], p[1]
        lx, ly = out[-1][0], out[-1][1]
        if ((px - lx) ** 2 + (py - ly) ** 2) ** 0.5 >= min_dist_mm:
            out.append(p)
    # Check last vs first
    if len(out) > 2:
        fx, fy = out[0][0], out[0][1]
        lx, ly = out[-1][0], out[-1][1]
        if ((fx - lx) ** 2 + (fy - ly) ** 2) ** 0.5 < min_dist_mm:
            out = out[:-1]
    if len(out) < 3:
        return points

    # Step 2: remove spike vertices — where the interior angle is < 8°
    # A spike means the point sticks out sharply and then comes back (notch or needle)
    MIN_ANGLE_DEG = 8.0
    changed = True
    while changed and len(out) >= 3:
        changed = False
        cleaned = []
        n = len(out)
        for j in range(n):
            prev = out[(j - 1) % n]
            curr = out[j]
            nxt  = out[(j + 1) % n]
            # Vectors from curr to prev and curr to next
            ax, ay = prev[0] - curr[0], prev[1] - curr[1]
            bx, by = nxt[0]  - curr[0], nxt[1]  - curr[1]
            la = math.sqrt(ax*ax + ay*ay)
            lb = math.sqrt(bx*bx + by*by)
            if la < 1e-9 or lb < 1e-9:
                changed = True  # duplicate point — skip it
                continue
            cos_a = max(-1.0, min(1.0, (ax*bx + ay*by) / (la * lb)))
            angle_deg = math.degrees(math.acos(cos_a))
            if angle_deg < MIN_ANGLE_DEG:
                changed = True  # spike — drop this vertex
                continue
            cleaned.append(curr)
        if changed:
            out = cleaned if len(cleaned) >= 3 else out
            changed = len(cleaned) >= 3 and cleaned != out

    return out if len(out) >= 3 else points


def contour_to_clo_points(points):
    """Convert FurLab manifest points into CLO CreatePatternWithPoints tuples.

    CLO CreatePatternWithPoints uses screen coordinates (Y increases downward),
    same as FurLab — no Y inversion needed. Winding must be CCW in screen space
    (which looks CW in standard math orientation).
    """
    clo_points = [(float(p["x"]), float(p["y"]), 0) for p in points]
    clo_points = simplify_contour(clo_points, min_dist_mm=1.5)
    # In screen Y-down space CCW means area2 < 0 (shoelace sum negative).
    area2 = sum(
        (clo_points[j][0] - clo_points[j - 1][0]) * (clo_points[j][1] + clo_points[j - 1][1])
        for j in range(len(clo_points))
    )
    if area2 < 0:
        clo_points = list(reversed(clo_points))
    return clo_points


def parse_dxf_contour(dxf_path):
    """Parse LWPOLYLINE points from FURLAB-generated DXF FRAGMENT_CONTOUR layer."""
    points = []
    try:
        with open(dxf_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = [line.strip() for line in f.readlines()]

        in_polyline = False
        in_fragment_layer = False
        x = None

        i = 0
        while i < len(lines):
            if lines[i] == "0" and i + 1 < len(lines) and lines[i + 1] == "LWPOLYLINE":
                in_polyline = True
                in_fragment_layer = False
                x = None
                i += 2
                continue
            if in_polyline:
                if lines[i] == "8" and i + 1 < len(lines):
                    in_fragment_layer = lines[i + 1] == "FRAGMENT_CONTOUR"
                    i += 2
                    continue
                if lines[i] == "10" and i + 1 < len(lines):
                    x = float(lines[i + 1])
                    i += 2
                    continue
                if lines[i] == "20" and i + 1 < len(lines) and x is not None:
                    if in_fragment_layer:
                        points.append({"x": x, "y": float(lines[i + 1])})
                    x = None
                    i += 2
                    continue
                if lines[i] == "0":
                    in_polyline = False
            i += 1
    except Exception as e:
        print(f"[FURLAB] DXF parse error {dxf_path}: {e}")
    return points


def run_import(zip_path, fabric_api, pattern_api):
    """Import a FurLab ZIP using CLO API modules, or fake modules in tests."""
    if not zip_path or not os.path.exists(zip_path):
        log(f"ERROR: ZIP not found: {zip_path}")
        return {"ok": False, "created": 0, "skipped": 0, "errors": 1, "error": "zip_not_found"}

    log(f"Loading: {zip_path}")
    tmp_dir = extract_zip_preserve_names(zip_path)

    manifest_path = os.path.join(tmp_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        log("ERROR: manifest.json not found in ZIP")
        return {"ok": False, "created": 0, "skipped": 0, "errors": 1, "error": "manifest_not_found", "tmpDir": tmp_dir}
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    entries = manifest.get("entries", [])
    log(f"Manifest keys: {list(manifest.keys())}")
    log(f"Fragments: {len(entries)}")
    if entries:
        e0 = entries[0]
        log(f"Entry[0] keys: {list(e0.keys())}")
        pts = e0.get("points")
        log(f"Entry[0] points type={type(pts).__name__}, len={len(pts) if pts else 0}")

    # CLO built-in Fur_Strand zfab files — used as fallback if jfab loads as wrong type
    CLO_FUR_LIBRARY = r"C:\Users\Public\Documents\CLO\Assets\Materials\Fabric"
    CLO_FUR_ZFABS = [
        os.path.join(CLO_FUR_LIBRARY, "Fur_Mink_Skin.zfab"),
        os.path.join(CLO_FUR_LIBRARY, "Fur_Fox.zfab"),
        os.path.join(CLO_FUR_LIBRARY, "Fur_Angora.zfab"),
    ]
    clo_fur_zfab = next((p for p in CLO_FUR_ZFABS if os.path.exists(p)), None)
    log(f"CLO fur zfab: {clo_fur_zfab}")

    material_index = {}
    base_fabric_count = fabric_api.GetFabricCount(False)
    log(f"Base fabric count: {base_fabric_count}")

    for entry in entries:
        jfab_rel = entry.get("materialJfabPath")
        if not jfab_rel or jfab_rel in material_index:
            continue
        jfab_abs = os.path.join(tmp_dir, jfab_rel.replace("/", os.sep))
        if not os.path.exists(jfab_abs):
            mat_dir = os.path.join(tmp_dir, "materials")
            fallback = None
            if os.path.isdir(mat_dir):
                jfabs = [f for f in os.listdir(mat_dir) if f.lower().endswith(".jfab")]
                if jfabs:
                    fallback = os.path.join(mat_dir, jfabs[0])
                    log(f"  jfab fallback: {jfabs[0]}")
            if not fallback:
                log(f"WARNING: jfab not found and no fallback: {jfab_rel}")
                continue
            jfab_abs = fallback

        # Read our custom parameters from jfab
        mat_name = os.path.splitext(os.path.basename(jfab_rel))[0]
        our_jd = None
        try:
            with open(jfab_abs, "r", encoding="utf-8") as _f:
                our_jd = json.load(_f)
            mat_name = our_jd.get("qsNameUTF8") or our_jd.get("qsName") or mat_name
        except Exception as _e:
            log(f"  jfab read failed: {_e}")

        if clo_fur_zfab:
            # Step 1: load CLO zfab to get a real fur-type material
            idx_temp = fabric_api.AddFabric(clo_fur_zfab)
            log(f"  zfab placeholder at index {idx_temp}")

            # Step 2: export it as jfab — this gives us native CLO fur structure
            exported_jfab = os.path.join(tempfile.gettempdir(), f"furlab_fur_native_{idx_temp}.jfab")
            try:
                fabric_api.ExportFabric(exported_jfab, idx_temp)
                log(f"  exported native jfab: {exported_jfab}")
            except Exception as _e:
                log(f"  ExportFabric failed: {_e}")
                exported_jfab = None

            # Step 3: patch native jfab with our parameters
            if exported_jfab and os.path.exists(exported_jfab) and our_jd:
                try:
                    with open(exported_jfab, "r", encoding="utf-8") as _f:
                        native = json.load(_f)

                    # Patch names and metadata
                    for k in ("qsName","qsNameUTF8","qsFabricName","qsFabricNameUTF8"):
                        native[k] = mat_name
                    # Override composition/type — clear mink-specific values from template
                    for k in ("fabricContent","fabricContentUTF8"):
                        our_val = (our_jd or {}).get(k)
                        native[k] = our_val if (our_val and our_val not in ("None", "")) else "Fur"
                    native["fabricType"] = "Fur"
                    native["fabricTypeUTF8"] = "Fur"

                    # Patch physical property info
                    if native.get("mapPhysical"):
                        native["mapPhysical"]["qsPhysicalPropertyName"]     = mat_name
                        native["mapPhysical"]["qsPhysicalPropertyNameUTF8"] = mat_name
                        our_pp = (our_jd or {}).get("mapPhysical") or {}
                        for pk in ("fSuK","fSvK","fBvK","fBvK_v2","fBuK","fBuK_v2","fHK","fBhK",
                                   "fDensity","fThickness","fFriction","fIDS"):
                            if pk in our_pp:
                                native["mapPhysical"][pk] = our_pp[pk]

                    # Patch fabric file info (Created by, Data State, etc.)
                    today = __import__("datetime").date.today()
                    date_str = f"{today.year}.{today.month}.{today.day}"
                    ffi_patch = {
                        "qsPPCreatedBy": "FURLAB", "qsPPCreatedByUTF8": "FURLAB",
                        "qsPPDataState": "Confirmed", "qsPPDataStateUTF8": "Confirmed",
                        "qsDate": date_str, "qsDateUTF8": date_str,
                        "qsUserId": "FURLAB", "qsUserIdUTF8": "FURLAB",
                    }
                    if native.get("listFabricFileInfo"):
                        native["listFabricFileInfo"][0].update(ffi_patch)
                    else:
                        native["listFabricFileInfo"] = [ffi_patch]

                    # Collect all listFaceMaterial arrays to patch
                    fm_lists = []
                    if native.get("mapMaterial2D"):
                        fm_lists += native["mapMaterial2D"].get("listFaceMaterial") or []
                    for cw in (native.get("mapColorwayInfo") or {}).get("listColorwayInfo") or []:
                        for m2d in cw.get("listMaterial2D") or []:
                            fm_lists += m2d.get("listFaceMaterial") or []

                    # Read params from our jfab
                    our_fm = ((our_jd.get("mapMaterial2D") or {}).get("listFaceMaterial") or [{}])[0]
                    FUR_KEYS = [
                        "v3BaseColor","v4Ambient","v4Diffuse","fAmbientIntensity","fDiffuseIntensity",
                        "mapBaseColor","mapAmbientColor","mapDiffuseColor","mapFurMidColor","mapFurTipColor",
                        "fFurLength","fFurThickness","fFurDensity","fFurTaper","fFurBend",
                        "fFurGlossiness","fFurGlossinessBoost","fFurSoftness","fFurMelanin","fFurPheoMelanin",
                        "fFurCurlRadius","fFurKnots","fFurLengthVar","fFurThicknessVar","fFurMidPos","fFurTipPos",
                        "bUseFurGradationColor","bUseFurInterpolationColor","fFurGravity",
                    ]
                    for fm in fm_lists:
                        for k in FUR_KEYS:
                            if k in our_fm:
                                fm[k] = our_fm[k]

                    safe_name = "".join(c for c in mat_name if c.isalnum() or c in " _-") or f"fur_{idx_temp}"
                    patched_path = os.path.join(tempfile.gettempdir(), f"{safe_name}.jfab")
                    with open(patched_path, "w", encoding="utf-8") as _f:
                        json.dump(native, _f)
                    log(f"  patched jfab saved: {patched_path}")

                    # Step 4: load patched jfab (placeholder stays but patterns go to this one)
                    idx = fabric_api.AddFabric(patched_path)
                    log(f"  final fabric at index {idx} (patched fur + our params)")
                except Exception as _e:
                    log(f"  patch failed: {_e}, keeping placeholder idx={idx_temp}")
                    idx = idx_temp
            else:
                idx = idx_temp
        else:
            idx = fabric_api.AddFabric(jfab_abs)
            log(f"Added fabric (jfab fallback): {jfab_rel} -> index {idx}")

        material_index[jfab_rel] = idx
        log(f"  material '{mat_name}' at index {idx}")

    log(f"pattern_api functions: {[x for x in dir(pattern_api) if not x.startswith('_')]}")

    pattern_base = pattern_api.GetPatternCount()
    created = 0
    skipped = 0
    errors = 0

    for i, entry in enumerate(entries):
        frag_id = entry.get("fragmentId", f"frag_{i}")
        dxf_rel = entry.get("dxfPath", "")
        jfab_rel = entry.get("materialJfabPath")
        nap_deg = float(entry.get("napDirectionDeg", 0))
        zone_id = entry.get("zoneId", "?")

        points = entry.get("points")
        if not points:
            dxf_abs = os.path.join(tmp_dir, dxf_rel.replace("/", os.sep)) if dxf_rel else None
            points = parse_dxf_contour(dxf_abs) if dxf_abs and os.path.exists(dxf_abs) else None

        if not points or len(points) < 3:
            skipped += 1
            log(f"SKIP {frag_id}: no geometry")
            continue

        area_mm2 = float(entry.get("areaMm2") or 0)
        if area_mm2 > 0 and area_mm2 < 100:
            skipped += 1
            log(f"SKIP {frag_id}: fragment too small ({area_mm2:.1f} mm²)")
            continue

        clo_points = contour_to_clo_points(points)
        if i == 0:
            log(f"First fragment: {len(clo_points)} points, first={clo_points[0]}")

        try:
            pattern_api.CreatePatternWithPoints(clo_points)
            pat_idx = pattern_base + created
            created += 1
            log(f"Created pattern {pat_idx} for fragment {frag_id} (zone {zone_id})")

            try:
                pattern_api.SetPatternPieceGrainDirection(pat_idx, nap_deg)
            except Exception as e:
                log(f"  grain direction warning: {e}")

            if jfab_rel and jfab_rel in material_index:
                fab_idx = material_index[jfab_rel]
                try:
                    pattern_api.SetPatternPieceFabricIndex(pat_idx, fab_idx)
                except Exception as e:
                    log(f"  fabric assign warning: {e}")
        except Exception as e:
            errors += 1
            log(f"ERROR creating pattern {frag_id}: {e}")

    log(f"Done. Created {created} / skipped {skipped} / errors {errors} out of {len(entries)} entries.")
    return {"ok": errors == 0, "created": created, "skipped": skipped, "errors": errors, "tmpDir": tmp_dir}


def main():
    log(f"ZIP_PATH setting: '{ZIP_PATH}'")
    zip_path = pick_zip_file()
    log(f"Selected ZIP: {zip_path}")
    if not zip_path:
        log("Cancelled: no file selected.")
        return

    import fabric_api
    import pattern_api
    run_import(zip_path, fabric_api, pattern_api)


if __name__ == "__main__":
    main()
