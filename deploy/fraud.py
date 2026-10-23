"""Read only the scorer's service token, then exec the existing FastAPI entrypoint."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen


def token() -> str:
    filename = Path(os.environ.get("SERVICE_TOKEN_FILE", "/run/secrets/service_token"))
    if filename.is_symlink() or not filename.is_file() or filename.stat().st_size > 128:
        raise ValueError("Invalid scorer service token file.")
    value = filename.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("Scorer service token must be 32-byte lowercase hex.")
    return value


if __name__ == "__main__":
    service_token = token()
    if sys.argv[1:] == ["--health"]:
        request = Request("http://127.0.0.1:4011/internal/health", headers={"Authorization": "Bearer " + service_token})
        with urlopen(request, timeout=3) as response:
            result = json.load(response)
            if result.get("ok") is not True or result.get("service") != "fraud":
                raise SystemExit(1)
    else:
        # Keep database and encryption credentials outside the scoring process.
        for key in list(os.environ):
            if "DATABASE" in key or key.startswith("PG") or key == "AUTH_ENCRYPTION_KEY":
                os.environ.pop(key, None)
        os.environ["SERVICE_TOKEN"] = service_token
        os.execv(sys.executable, [sys.executable, "-B", "main.py"])
