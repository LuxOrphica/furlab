import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, help="Path to oracle case json")
    ap.add_argument("--out", default="", help="Optional output path")
    args = ap.parse_args()

    case_path = Path(args.case)
    with case_path.open("r", encoding="utf-8") as f:
        case_obj = json.load(f)
    try:
        from oracle_solver import run_case
    except Exception as e:  # pragma: no cover
        raise SystemExit(
            "Oracle dependencies are missing. Install with: "
            "python -m pip install -r scripts/oracle_requirements.txt\n"
            f"Details: {e}"
        )
    result = run_case(case_obj)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
