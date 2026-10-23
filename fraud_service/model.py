"""Validated logistic model artifact and deterministic, rule-free inference."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .schemas import AssessmentRequest

FEATURE_NAMES = ("amountLog", "amountDeviation", "velocity", "newPayee", "balanceUtilization", "unusualHour", "recentValue")
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = ROOT / "services" / "fraud" / "model.json"
DEFAULT_CHECKSUM = Path(__file__).with_name("model.sha256")
SINGAPORE = timezone(timedelta(hours=8), "Asia/Singapore")
REVIEW_THRESHOLD = 65


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("The model artifact contains duplicate JSON keys.")
        value[key] = item
    return value


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _round(value: float, digits: int = 0) -> float | int:
    # JavaScript's Math.round uses floor(x + 0.5), unlike Python's ties-to-even.
    if digits == 0:
        return math.floor(value + 0.5)
    return float(f"{value:.{digits}f}")


@dataclass(frozen=True)
class FraudModel:
    version: str
    intercept: float
    weights: tuple[float, ...]
    sha256: str
    metadata: dict[str, Any]

    @classmethod
    def load(cls, model_path: Path = DEFAULT_MODEL, expected_sha256: str | None = None) -> "FraudModel":
        source = Path(model_path).read_bytes()
        if not source or len(source) > 128 * 1024:
            raise ValueError("The model artifact must be a bounded JSON file.")
        # Git checkouts may use LF or CRLF; approval hashes normalize only CRLF.
        source = source.replace(b"\r\n", b"\n")
        digest = hashlib.sha256(source).hexdigest()
        expected = expected_sha256 if expected_sha256 is not None else DEFAULT_CHECKSUM.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{64}", expected) or not hmac.compare_digest(digest, expected):
            raise ValueError("The fraud model checksum does not match the approved artifact.")
        def reject_constant(_: str) -> None:
            raise ValueError("Model numbers must be finite.")
        artifact = json.loads(source.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=reject_constant)
        if not isinstance(artifact, dict) or artifact.get("features") != list(FEATURE_NAMES):
            raise ValueError("The model feature order does not match the inference implementation.")
        weights, intercept = artifact.get("weights"), artifact.get("intercept")
        if not isinstance(weights, list) or len(weights) != len(FEATURE_NAMES) or not all(_finite_number(w) for w in weights) or not _finite_number(intercept):
            raise ValueError("The model needs one finite weight per feature and a finite intercept.")
        version = artifact.get("version")
        if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", version):
            raise ValueError("The model must declare a valid version.")
        if artifact.get("algorithm") != "Regularized logistic regression":
            raise ValueError("Unsupported fraud model algorithm.")
        training = artifact.get("training")
        if not isinstance(training, dict) or not isinstance(training.get("synthetic"), bool) or not re.fullmatch(r"[a-f0-9]{64}", str(training.get("datasetSha256", ""))):
            raise ValueError("The model needs explicit training provenance.")
        for name in ("rows", "trainRows", "testRows"):
            if type(training.get(name)) is not int or training[name] <= 0:
                raise ValueError("The model needs positive training and test row counts.")
        if training["trainRows"] + training["testRows"] != training["rows"]:
            raise ValueError("Training and test row counts do not reconcile.")
        metrics = artifact.get("metrics")
        if not isinstance(metrics, dict) or not all(_finite_number(metrics.get(key)) and 0 <= metrics[key] <= 1 for key in ("accuracy", "precision", "recall")):
            raise ValueError("The model needs finite held-out evaluation metrics.")
        return cls(version, float(intercept), tuple(float(w) for w in weights), digest, copy.deepcopy(artifact))

    def info(self) -> dict[str, Any]:
        public = {key: copy.deepcopy(self.metadata[key]) for key in ("version", "algorithm", "features", "training", "metrics", "policy", "evaluation", "diagnostics") if key in self.metadata}
        public.update({
            "modelSha256": self.sha256,
            "evaluationThreshold": self.metadata.get("metrics", {}).get("threshold", 65),
            "evaluationThresholdType": "rounded_model_score",
            "reviewThreshold": REVIEW_THRESHOLD,
            "historyWindow": "Authoritative completed external outgoing aggregates supplied by banking; Singapore local hour.",
            "scoreMeaning": "0-94 model risk indicator. It is not a calibrated probability of proven fraud.",
            "limitations": "The included baseline uses synthetic labelled observations. Published metrics measure the live rounded-score review threshold of 65; probability-0.50 results are separately labelled diagnostics. These metrics do not establish real fraud performance. Representative time-separated evaluation, calibration and monitoring are required before real financial use.",
            "explanationMethod": "Selected input signals with their weight-times-feature logit contributions; these are not causal explanations or SHAP values.",
        })
        return public

    def assess(self, request: AssessmentRequest) -> dict[str, Any]:
        summary = request.historySummary
        instant = datetime.fromisoformat(request.createdAt.replace("Z", "+00:00"))
        hour = instant.astimezone(SINGAPORE).hour
        average = summary.averageOutgoingCents or 20000
        known = request.isInternal or summary.knownPayee
        clamp = lambda value, maximum=2.0: min(maximum, max(0.0, value))
        values = (
            clamp(math.log1p(request.amountCents / 100) / math.log(10001)),
            clamp(math.log2(max(1, request.amountCents) / max(1000, average)) / 6),
            clamp(summary.outgoingCount10m / 5),
            0.0 if known else 1.0,
            clamp(request.amountCents / max(1, request.accountBalanceCents), 1.5),
            1.0 if hour < 6 else 0.0,
            clamp(summary.outgoingAmount10m / max(10000, average) / 8),
        )
        contributions = [value * weight for value, weight in zip(values, self.weights)]
        logit = self.intercept + sum(contributions)
        if not all(math.isfinite(value) for value in (*values, *contributions, logit)):
            raise ValueError("The model returned a non-finite assessment.")
        probability = 1 / (1 + math.exp(-max(-40.0, min(40.0, logit))))
        score = min(94, _round(probability * 100))
        reasons: list[dict[str, Any]] = []
        def reason(code: str, message: str, contribution: float = 0) -> None:
            reasons.append({"code": code, "message": message, "contribution": _round(contribution, 3)})
        if summary.historyCount and request.amountCents > summary.averageOutgoingCents * 3:
            # A non-empty zero average is legal only for corrupt caller data; never divide by zero.
            if summary.averageOutgoingCents > 0:
                reason("amount_deviation", f"Amount is {request.amountCents / summary.averageOutgoingCents:.1f} times the historical average outgoing payment.", contributions[1])
        if not known:
            reason("new_recipient", "No completed outgoing payment to this recipient appears in the available history.", contributions[3])
        if summary.outgoingCount10m >= 3:
            reason("recent_activity", f"{summary.outgoingCount10m} outgoing payments were completed in the last ten minutes.", contributions[2])
        if request.amountCents / max(1, request.accountBalanceCents) >= 0.75:
            reason("balance_share", "This payment uses a large share of the available account balance.", contributions[4])
        if hour < 6:
            reason("unusual_hour", "The payment was initiated between midnight and 6am Singapore time.", contributions[5])
        if not summary.historyCount:
            reason("limited_history", "Limited historical activity is available; the baseline model is used.")
        if not reasons:
            reason("model_pattern" if score >= REVIEW_THRESHOLD else "usual_pattern", "The combined payment pattern differs from the baseline." if score >= REVIEW_THRESHOLD else "No strong behavioural anomaly was detected by the model.")
        return {
            "transactionId": request.transactionId, "userId": request.userId, "sourceAccountId": request.sourceAccountId,
            "payloadHash": request.payloadHash, "type": request.type, "amountCents": request.amountCents,
            "payee": request.payee, "isInternal": request.isInternal,
            "modelScore": score, "score": score, "decision": "review" if score >= REVIEW_THRESHOLD else "allow",
            "features": {name: _round(value, 4) for name, value in zip(FEATURE_NAMES, values)},
            "modelVersion": self.version, "modelSha256": self.sha256,
            "assessedAt": instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "reasons": reasons, "synthetic": self.metadata["training"]["synthetic"],
            "context": {"historicalTransactions": summary.historyCount, "averageOutgoingCents": _round(summary.averageOutgoingCents), "outgoingCount10m": summary.outgoingCount10m, "dailyOutgoingCents": summary.dailyOutgoingCents, "knownPayee": known},
        }
