# manually set model pointers or roll back
# PYTHONPATH=src python scripts/promote.py --active <version> | --shadow <version> | --rollback

import argparse

from fraud_service.utils.io import load_yaml
from fraud_service.modeling.registry import (
    read_active_model,
    read_rollback_model,
    write_active_model,
    write_shadow_model,
    write_rollback_model,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--active", type=str, default=None, help="Set this version as ACTIVE")
    ap.add_argument("--shadow", type=str, default=None, help="Set this version as SHADOW")
    ap.add_argument("--rollback", action="store_true", help="Roll back ACTIVE to the previous ROLLBACK version")
    ap.add_argument("--config", type=str, default="config.yaml")
    args = ap.parse_args()

    cfg = load_yaml(args.config)
    paths = cfg.get("paths", {})
    active_path = paths.get("active_ptr", "artifacts/models/ACTIVE_MODEL.json")
    shadow_path = paths.get("shadow_ptr", "artifacts/models/SHADOW_MODEL.json")
    rollback_path = paths.get("rollback_ptr", "artifacts/models/ROLLBACK_MODEL.json")

    if args.rollback:
        rb = read_rollback_model(rollback_path)
        if not rb:
            raise SystemExit(f"No rollback version found at {rollback_path}")
        cur = read_active_model(active_path)
        write_active_model(active_path, rb)
        if cur:
            write_rollback_model(rollback_path, cur)
        print(f"ACTIVE -> {rb}  (previous: {cur})")
        return

    if args.active:
        cur = read_active_model(active_path)
        if cur:
            write_rollback_model(rollback_path, cur)
            print(f"ROLLBACK <- {cur}")
        write_active_model(active_path, args.active)
        print(f"ACTIVE -> {args.active}")

    if args.shadow:
        write_shadow_model(shadow_path, args.shadow)
        print(f"SHADOW -> {args.shadow}")

    if not args.active and not args.shadow:
        ap.print_help()


if __name__ == "__main__":
    main()
