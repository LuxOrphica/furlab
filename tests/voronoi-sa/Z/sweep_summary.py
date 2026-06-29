#!/usr/bin/env python3
"""Сводка по seed-свипу: для каждого прогона запускает verify_voronoi_sa.py и парсит результат."""
import json
import os
import re
import subprocess
import sys

SWEEP_DIR = "/home/z/my-project/scripts/sweep_v5"
VERIFIER = "/home/z/my-project/furlab/tests/voronoi-sa/РобертТестер/verify_voronoi_sa.py"

files = sorted(os.listdir(SWEEP_DIR))
print(f"{'file':<35} {'seed':<8} {'covF':<8} {'R2':<8} {'intHoles':<10} {'edgHoles':<10} {'submin':<7} {'dups':<5} {'ovlp':<7} {'aesth':<8} {'ИТОГ':<8}")
print("-" * 130)

for f in files:
    if not f.endswith(".json"):
        continue
    path = os.path.join(SWEEP_DIR, f)
    try:
        result = subprocess.run(["python3", VERIFIER, path],
                                capture_output=True, text=True, timeout=30)
        out = result.stdout
        # parse
        def grab(pat, default=""):
            m = re.search(pat, out)
            return m.group(1) if m else default
        covF = grab(r"ПОКРЫТИЕ \(фрагменты\)\s*=\s*([\d.]+)")
        r2 = grab(r"\[R2\][^P]*PASS\s*\(<=\.?\d*\)" if "PASS" in out else r"\[R2\][^F]*FAIL", "")
        r2_match = re.search(r"\[R2\].*?(PASS|FAIL)\s*\(<=(\d+\.?\d*)\)\s*\n.*?=\s*([-\d.]+)\s*pp", out)
        r2_status = r2_match.group(1) if r2_match else "?"
        r2_val = r2_match.group(3) if r2_match else "?"
        r2_str = f"{r2_val} {r2_status[:1]}"
        # interior-physMissing
        int_match = re.search(r"\[ОСЬ2А\] interior-physMissing = (\d+) шт / (\d+) mm2", out)
        int_str = f"{int_match.group(1)}шт/{int_match.group(2)}мм²" if int_match else "?"
        # edge
        edg_match = re.search(r"\[ОСЬ2Б\] краевой physMissing = (\d+) шт / (\d+) mm2", out)
        edg_str = f"{edg_match.group(1)}шт/{edg_match.group(2)}мм²" if edg_match else "?"
        # sub-min
        sm_match = re.search(r"\[ОСЬ3\] суб-мин.*?= (\d+)", out)
        sm = sm_match.group(1) if sm_match else "?"
        # dups
        dup_match = re.search(r"\[ОСЬ4\] дубли.*?= (\d+)", out)
        dup = dup_match.group(1) if dup_match else "?"
        # overlap
        ov_match = re.search(r"\[disj\] overlap.*?= (\d+)", out)
        ov = ov_match.group(1) if ov_match else "?"
        # aesthetics pass rate
        with open(path) as fh:
            d = json.load(fh)
        ae = d.get("aesthetics", {})
        ae_rate = ae.get("passRate", 0)
        ae_str = f"{ae_rate*100:.0f}%"
        # seed
        eo = d.get("effectiveOptions", {})
        seed = eo.get("seed", "?")
        # итог
        itog_match = re.search(r"ИТОГ:\s*(\w+)", out)
        itog = itog_match.group(1) if itog_match else "?"
        print(f"{f:<35} {seed:<8} {covF:<8} {r2_str:<8} {int_str:<10} {edg_str:<10} {sm:<7} {dup:<5} {ov:<7} {ae_str:<8} {itog:<8}")
    except subprocess.TimeoutExpired:
        print(f"{f:<35} TIMEOUT")
    except Exception as e:
        print(f"{f:<35} ERROR: {e}")
