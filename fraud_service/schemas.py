"""Strict server-to-server screening contract. No credentials or raw history."""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_CENTS = 9_000_000_000_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
Identifier = Annotated[str, Field(min_length=1, max_length=150, pattern=r"^[A-Za-z0-9:_-]+$")]
Cents = Annotated[int, Field(strict=True, ge=0, le=MAX_CENTS)]
AggregateCents = Annotated[int, Field(strict=True, ge=0, le=MAX_SAFE_INTEGER)]
Count = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False, frozen=True)


class HistorySummary(StrictModel):
    averageOutgoingCents: Annotated[float, Field(ge=0, le=MAX_CENTS)]
    outgoingCount10m: Count
    outgoingAmount10m: AggregateCents
    dailyOutgoingCents: AggregateCents
    historyCount: Count
    knownPayee: bool

    @model_validator(mode="after")
    def consistent_history(self) -> "HistorySummary":
        if not math.isfinite(self.averageOutgoingCents):
            raise ValueError("Historical averages must be finite.")
        if self.outgoingCount10m > self.historyCount:
            raise ValueError("Recent count cannot exceed total history count.")
        if self.outgoingCount10m == 0 and self.outgoingAmount10m != 0:
            raise ValueError("A zero recent count must have zero recent value.")
        if self.historyCount == 0 and (self.averageOutgoingCents != 0 or self.knownPayee or self.dailyOutgoingCents != 0):
            raise ValueError("Empty history cannot contain a historical average, daily value or known recipient.")
        return self


class AssessmentRequest(StrictModel):
    transactionId: Identifier
    userId: Identifier
    sourceAccountId: Identifier
    payloadHash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    type: Literal["transfer", "bill"]
    amountCents: Annotated[int, Field(strict=True, ge=1, le=MAX_CENTS)]
    accountBalanceCents: Cents
    payee: Annotated[str, Field(min_length=1, max_length=150, pattern=r"^[A-Za-z0-9:_-]+$")]
    isInternal: bool
    createdAt: Annotated[str, Field(min_length=20, max_length=40)]
    historySummary: HistorySummary

    @field_validator("createdAt")
    @classmethod
    def explicit_instant(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
            raise ValueError("Use an ISO timestamp with an explicit UTC offset.")
        if not value.endswith("Z") and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
            raise ValueError("Supply a valid timestamp UTC offset.")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("Supply a valid assessment timestamp.") from None
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("Assessment timestamps need a UTC offset.")
        return value
