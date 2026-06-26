import argparse
import shutil
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--dst", required=True)
    p.add_argument("--pattern", default="*.png")
    args = p.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    dst.mkdir(parents=True, exist_ok=True)

    files = sorted(src.glob(args.pattern))
    if not files:
        print(f"No files for pattern: {args.pattern} in {src}")
        return

    copied = 0
    for f in files:
        if not f.is_file():
            continue
        out = dst / f.name
        shutil.copy2(f, out)
        copied += 1

    print(f"Copied: {copied}")


if __name__ == "__main__":
    main()
