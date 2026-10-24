"""Authenticated, bounded FastAPI HTTP boundary for private model inference."""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .model import OllamaFraudModel
from .schemas import AssessmentRequest

BODY_LIMIT = 16 * 1024


def _reject_constant(_: str) -> None:
    raise ValueError("JSON numbers must be finite.")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("JSON keys must be unique.")
        value[key] = item
    return value


class ServiceBoundary:
    """Authenticate before reading a body; bound bytes including chunked requests."""
    def __init__(self, app: ASGIApp, token: str):
        self.app = app
        self.expected = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        async def fail(status: int, message: str) -> None:
            headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
            if status == 401:
                headers["WWW-Authenticate"] = "Bearer"
            await JSONResponse({"error": message}, status_code=status, headers=headers)(scope, receive, send)
        headers = scope.get("headers", [])
        authorization = [value for key, value in headers if key.lower() == b"authorization"]
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0], self.expected):
            await fail(401, "Service authentication required.")
            return
        body = b""
        if scope["method"] in ("POST", "PUT", "PATCH", "DELETE"):
            content_types = [value for key, value in headers if key.lower() == b"content-type"]
            if len(content_types) != 1 or content_types[0].split(b";", 1)[0].strip().lower() != b"application/json":
                await fail(415, "Send application/json.")
                return
            lengths = [value for key, value in headers if key.lower() == b"content-length"]
            if len(lengths) > 1 or (lengths and not re.fullmatch(b"[0-9]+", lengths[0])):
                await fail(400, "Invalid content length.")
                return
            if lengths and int(lengths[0]) > BODY_LIMIT:
                await fail(413, "Screening request is too large.")
                return
            parts: list[bytes] = []
            size = 0
            while True:
                try:
                    event = await asyncio.wait_for(receive(), timeout=10)
                except TimeoutError:
                    await fail(408, "Screening request timed out.")
                    return
                if event["type"] == "http.disconnect":
                    return
                if event["type"] != "http.request":
                    continue
                part = event.get("body", b"")
                size += len(part)
                if size > BODY_LIMIT:
                    await fail(413, "Screening request is too large.")
                    return
                parts.append(part)
                if not event.get("more_body", False):
                    break
            body = b"".join(parts)
            try:
                parsed = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
                if not isinstance(parsed, dict):
                    raise ValueError("Expected an object.")
            except (ValueError, UnicodeError, RecursionError):
                await fail(400, "Send one valid JSON object with unique keys and finite numbers.")
                return
        delivered = False
        async def replay_receive() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()
        async def protected_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = [(key, value) for key, value in message.get("headers", []) if key.lower() not in (b"cache-control", b"x-content-type-options")]
                message["headers"] = response_headers + [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")]
            await send(message)
        await self.app(scope, replay_receive, protected_send)


def create_app(*, token: str | None = None, model: OllamaFraudModel | None = None) -> FastAPI:
    configured_token = os.environ.get("SERVICE_TOKEN", "") if token is None else token
    if not isinstance(configured_token, str) or not re.fullmatch(r"[A-Za-z0-9._~-]{24,512}", configured_token):
        raise ValueError("SERVICE_TOKEN must contain 24-512 visible token characters.")
    model = model or OllamaFraudModel()
    application = FastAPI(title="Greenlink private fraud model", docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    application.add_middleware(ServiceBoundary, token=configured_token)

    @application.exception_handler(RequestValidationError)
    async def invalid_input(_: Request, error: RequestValidationError) -> JSONResponse:
        # FastAPI's default includes rejected inputs. Never echo secrets/raw payloads.
        fields = [{"field": ".".join(str(part) for part in item["loc"]), "type": item["type"]} for item in error.errors()]
        return JSONResponse({"error": "Invalid screening request.", "details": fields}, status_code=422)

    @application.get("/internal/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "fraud", "status": "ready", "provider": "ollama", "modelVersion": model.version}

    @application.get("/internal/model")
    async def metadata() -> dict[str, Any]:
        try:
            return {"ok": True, "model": await asyncio.to_thread(model.info)}
        except (OSError, ValueError, TimeoutError, RecursionError):
            return JSONResponse({"error": "The configured local Ollama model is unavailable."}, status_code=503)

    @application.post("/internal/assess")
    async def assess(payload: AssessmentRequest) -> dict[str, Any]:
        try:
            result = await asyncio.to_thread(model.assess, payload)
        except (ArithmeticError, OSError, ValueError, TimeoutError, RecursionError):
            return JSONResponse({"error": "Model inference is unavailable. No payment was executed."}, status_code=503)
        return {"ok": True, "risk": result}

    return application
