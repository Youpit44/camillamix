import json
from datetime import datetime
from pathlib import Path

LOG_FILE = Path(__file__).resolve().parent.parent.joinpath("audit.log")


def log_change(user: str, action: str, details: dict):
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "user": user,
        "action": action,
        "details": details,
    }
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


__all__ = ["log_change"]
