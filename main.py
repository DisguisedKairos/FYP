"""Run with SERVICE_TOKEN set: python main.py (private loopback port 4011)."""
from __future__ import annotations

import os

from fraud_service.application import create_app

app = create_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("FRAUD_PORT", os.environ.get("PORT", "4011")))
    if not 1 <= port <= 65535:
        raise ValueError("FRAUD_PORT must be an integer from 1 to 65535.")
    uvicorn.run(app, host=os.environ.get("FRAUD_HOST", "127.0.0.1"), port=port, access_log=False, proxy_headers=False, server_header=False)
