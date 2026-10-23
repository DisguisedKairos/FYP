"""HTTP contract, fail-closed validation, artifact integrity and JS parity tests."""
from __future__ import annotations

import copy
import csv
import hashlib
import json
import math
import random
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from fraud_service.application import BODY_LIMIT, create_app
from fraud_service.model import DEFAULT_MODEL, FEATURE_NAMES, FraudModel
from fraud_service.schemas import AssessmentRequest

ROOT = Path(__file__).resolve().parent.parent
TOKEN = "python-fraud-contract-test-token-123456789"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def payload(**changes):
    value = {
        "transactionId": "txn-001", "userId": "customer-001", "sourceAccountId": "savings-001",
        "payloadHash": "a" * 64, "type": "transfer", "amountCents": 2500,
        "accountBalanceCents": 2485050, "payee": "1020002001", "isInternal": False,
        "createdAt": "2026-10-23T06:00:00.000Z",
        "historySummary": {"averageOutgoingCents": 20000, "outgoingCount10m": 0,
            "outgoingAmount10m": 0, "dailyOutgoingCents": 50000, "historyCount": 10, "knownPayee": True},
    }
    value.update(changes)
    return value


class ServiceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(create_app(token=TOKEN))

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def post(self, body):
        return self.client.post("/internal/assess", json=body, headers=HEADERS)

    def test_all_routes_require_service_authentication_before_body_validation(self):
        for path in ("/internal/health", "/internal/model", "/docs", "/openapi.json"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.client.post("/internal/assess", content=b"x" * (BODY_LIMIT + 1)).status_code, 401)
        self.assertEqual(self.client.get("/internal/health", headers={"Authorization": "Bearer wrong"}).status_code, 401)
        self.assertEqual(self.client.get("/internal/health", headers=[("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)]).status_code, 401)

    def test_health_and_model_are_private_and_truthful(self):
        health = self.client.get("/internal/health", headers=HEADERS)
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["service"], "fraud")
        metadata = self.client.get("/internal/model", headers=HEADERS).json()["model"]
        self.assertTrue(metadata["training"]["synthetic"])
        self.assertEqual(metadata["reviewThreshold"], 65)
        self.assertEqual(metadata["evaluationThreshold"], 65)
        self.assertEqual(metadata["evaluationThresholdType"], "rounded_model_score")
        self.assertEqual(metadata["diagnostics"]["probabilityThreshold0_5"]["threshold"], 0.5)
        self.assertEqual(metadata["modelSha256"], health.json()["modelSha256"])
        self.assertNotIn("weights", metadata)
        self.assertEqual(self.client.get("/docs", headers=HEADERS).status_code, 404)

    def test_assessment_is_bound_to_all_canonical_payment_identifiers(self):
        request = payload()
        response = self.post(request)
        self.assertEqual(response.status_code, 200, response.text)
        risk = response.json()["risk"]
        for field in ("transactionId", "userId", "sourceAccountId", "payloadHash", "type", "amountCents", "payee", "isInternal"):
            self.assertEqual(risk[field], request[field])
        self.assertEqual(risk["modelScore"], risk["score"])
        self.assertTrue(0 <= risk["score"] <= 94)
        self.assertEqual(risk["decision"], "review" if risk["score"] >= 65 else "allow")
        self.assertTrue(risk["synthetic"])
        self.assertEqual(set(risk["features"]), set(FEATURE_NAMES))
        self.assertTrue(risk["reasons"])
        self.assertNotIn("controls", risk)
        self.assertNotIn("ruleVersion", risk)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_no_cached_assessment_can_cross_a_source_or_payload_change(self):
        original = payload(amountCents=80000, accountBalanceCents=1000000)
        first = self.post(original).json()["risk"]
        changed = payload(amountCents=80000, accountBalanceCents=80000, sourceAccountId="savings-002", payloadHash="b" * 64)
        second = self.post(changed).json()["risk"]
        self.assertEqual(second["transactionId"], first["transactionId"])
        self.assertEqual(second["sourceAccountId"], "savings-002")
        self.assertEqual(second["payloadHash"], "b" * 64)
        self.assertGreater(second["features"]["balanceUtilization"], first["features"]["balanceUtilization"])
        self.assertGreater(second["score"], first["score"])
        self.assertEqual(self.post(original).json()["risk"], first)

    def test_strict_types_ranges_identifiers_and_dates_fail_closed(self):
        invalid = [
            {"amountCents": True}, {"amountCents": "2500"}, {"amountCents": 1.5},
            {"amountCents": 0}, {"amountCents": -1}, {"amountCents": 9000000000001},
            {"accountBalanceCents": -1}, {"isInternal": "false"}, {"type": "deposit"},
            {"sourceAccountId": 123}, {"payloadHash": "x" * 64}, {"payee": "../accounts"},
            {"createdAt": "2026-10-23T06:00:00"}, {"createdAt": "2026-10-23T06:00:00+08:99"}, {"createdAt": "2026-02-30T06:00:00Z"},
            {"authorizationPassword": "A-Private-Password-987!"}, {"history": []},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                response = self.post(payload(**changes))
                self.assertEqual(response.status_code, 422, response.text)
                self.assertNotIn("A-Private-Password-987!", response.text)
        missing = payload()
        del missing["payloadHash"]
        self.assertEqual(self.post(missing).status_code, 422)

    def test_nonfinite_duplicate_malformed_oversized_and_wrong_media_json_are_rejected(self):
        headers = {**HEADERS, "Content-Type": "application/json"}
        for raw in (b'{"amountCents":NaN}', b'{"amountCents":Infinity}', b'{"a":1,"a":2}', b'[]', b'{', b'\xff'):
            with self.subTest(raw=raw):
                self.assertEqual(self.client.post("/internal/assess", content=raw, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/internal/assess", content=b"x" * (BODY_LIMIT + 1), headers=headers).status_code, 413)
        self.assertEqual(self.client.post("/internal/assess", content=iter([b"x" * BODY_LIMIT, b"x"]), headers=headers).status_code, 413)
        self.assertEqual(self.client.post("/internal/assess", content="{}", headers=HEADERS).status_code, 415)

    def test_invalid_historical_aggregates_are_not_silently_coerced(self):
        for update in ({"knownPayee": 1}, {"outgoingCount10m": 1.5}, {"outgoingCount10m": 11}, {"outgoingAmount10m": 100}, {"averageOutgoingCents": "20000"}, {"historyCount": 0}, {"dailyOutgoingCents": -1}, {"balanceCents": 999}):
            with self.subTest(update=update):
                body = payload()
                body["historySummary"].update(update)
                self.assertEqual(self.post(body).status_code, 422)
        empty = {"averageOutgoingCents": 0, "outgoingCount10m": 0, "outgoingAmount10m": 0, "dailyOutgoingCents": 0, "historyCount": 0, "knownPayee": False}
        self.assertEqual(self.post(payload(historySummary=empty)).status_code, 200)

    def test_singapore_hour_uses_the_instant_not_server_timezone(self):
        midnight = self.post(payload(createdAt="2026-10-22T17:00:00.000Z")).json()["risk"]
        equivalent = self.post(payload(createdAt="2026-10-23T01:00:00+08:00")).json()["risk"]
        daytime = self.post(payload(createdAt="2026-10-23T06:00:00.000Z")).json()["risk"]
        self.assertEqual(midnight, equivalent)
        self.assertEqual(midnight["features"]["unusualHour"], 1)
        self.assertEqual(daytime["features"]["unusualHour"], 0)

    def test_high_model_probability_requires_review_and_never_auto_blocks(self):
        summary = {"averageOutgoingCents": 1000, "outgoingCount10m": 50, "outgoingAmount10m": 9000000, "dailyOutgoingCents": 9000000, "historyCount": 50, "knownPayee": False}
        risk = self.post(payload(amountCents=900000, accountBalanceCents=900000, historySummary=summary, createdAt="2026-10-22T17:00:00Z")).json()["risk"]
        self.assertEqual(risk["score"], 94)
        self.assertEqual(risk["decision"], "review")
        self.assertTrue(all(math.isfinite(reason["contribution"]) for reason in risk["reasons"]))

    def test_inference_failure_is_unavailable_without_echoing_inputs(self):
        with patch.object(FraudModel, "assess", side_effect=ValueError("do not expose customer data")):
            response = self.post(payload())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("customer data", response.text)


class ModelIntegrityTests(unittest.TestCase):
    def test_missing_or_weak_service_token_prevents_application_creation(self):
        for token in ("", "short", " " * 32, "x" * 513):
            with self.subTest(token=token):
                with self.assertRaises(ValueError):
                    create_app(token=token)

    def test_checksum_and_model_shape_are_verified_before_startup(self):
        source = DEFAULT_MODEL.read_bytes().replace(b"\r\n", b"\n")
        with tempfile.TemporaryDirectory(prefix="greenlink-model-") as temporary:
            location = Path(temporary) / "model.json"
            location.write_bytes(source + b" ")
            with self.assertRaisesRegex(ValueError, "checksum"):
                FraudModel.load(location)
            artifact = json.loads(source)
            artifact["weights"].pop()
            changed = json.dumps(artifact).encode()
            location.write_bytes(changed)
            with self.assertRaisesRegex(ValueError, "weight"):
                FraudModel.load(location, hashlib.sha256(changed).hexdigest())
            artifact = json.loads(source)
            artifact["features"].reverse()
            changed = json.dumps(artifact).encode()
            location.write_bytes(changed)
            with self.assertRaisesRegex(ValueError, "feature order"):
                FraudModel.load(location, hashlib.sha256(changed).hexdigest())
            changed = source.replace(b'"intercept": -3.905', b'"intercept": NaN')
            location.write_bytes(changed)
            with self.assertRaises(ValueError):
                FraudModel.load(location, hashlib.sha256(changed).hexdigest())

    def test_windows_and_linux_checkout_newlines_have_the_same_approved_model(self):
        source = DEFAULT_MODEL.read_bytes().replace(b"\r\n", b"\n")
        with tempfile.TemporaryDirectory(prefix="greenlink-model-") as temporary:
            location = Path(temporary) / "model.json"
            location.write_bytes(source.replace(b"\n", b"\r\n"))
            self.assertEqual(FraudModel.load(location).sha256, FraudModel.load().sha256)

    def test_published_metrics_measure_the_exact_live_review_policy(self):
        with (ROOT / "datasets" / "fraud-history.csv").open(encoding="utf-8", newline="") as source:
            rows = [{key: int(value) for key, value in row.items()} for row in csv.DictReader(source)]
        state = 98245
        for index in range(len(rows) - 1, 0, -1):
            state = (1664525 * state + 1013904223) & 0xFFFFFFFF
            selected = math.floor(state / 4294967296 * (index + 1))
            rows[index], rows[selected] = rows[selected], rows[index]
        heldout = rows[math.floor(len(rows) * 0.8):]
        confusion = {"truePositive": 0, "falsePositive": 0, "trueNegative": 0, "falseNegative": 0}
        model = FraudModel.load()
        for index, row in enumerate(heldout):
            summary = {"averageOutgoingCents": row["averageOutgoingCents"], "outgoingCount10m": row["outgoingCount10m"], "outgoingAmount10m": row["outgoingAmount10m"], "dailyOutgoingCents": 0, "historyCount": max(1, row["outgoingCount10m"]), "knownPayee": bool(row["knownPayee"])}
            request = payload(transactionId=f"evaluation-{index}", amountCents=row["amountCents"], accountBalanceCents=row["balanceCents"], historySummary=summary, createdAt=f"2026-10-23T{row['hour']:02d}:00:00+08:00")
            predicted = model.assess(AssessmentRequest.model_validate(request))["score"] >= 65
            name = ("truePositive" if row["label"] else "falsePositive") if predicted else ("falseNegative" if row["label"] else "trueNegative")
            confusion[name] += 1
        metrics = model.info()["metrics"]
        for name, value in confusion.items():
            self.assertEqual(metrics[name], value)
        self.assertEqual(sum(confusion.values()), model.metadata["training"]["testRows"])
        self.assertEqual(metrics["threshold"], 65)
        self.assertEqual(metrics["precision"], round(confusion["truePositive"] / max(1, confusion["truePositive"] + confusion["falsePositive"]), 4))
        self.assertEqual(metrics["recall"], round(confusion["truePositive"] / max(1, confusion["truePositive"] + confusion["falseNegative"]), 4))
        self.assertEqual(metrics["falsePositiveRate"], round(confusion["falsePositive"] / max(1, confusion["falsePositive"] + confusion["trueNegative"]), 4))

    def test_inference_matches_existing_javascript_features_and_score(self):
        randomizer = random.Random(73121)
        cases = [payload(), payload(isInternal=True), payload(createdAt="2026-10-23T00:00:00+08:00")]
        for index in range(60):
            count = randomizer.randrange(0, 30)
            cases.append(payload(transactionId=f"parity-{index}", amountCents=randomizer.randrange(1, 9000000), accountBalanceCents=randomizer.randrange(1, 9000000), createdAt=f"2026-10-23T{index % 24:02d}:00:00.000Z", historySummary={"averageOutgoingCents": randomizer.randrange(1, 900000), "outgoingCount10m": count, "outgoingAmount10m": randomizer.randrange(1, 9000000) if count else 0, "dailyOutgoingCents": randomizer.randrange(1, 20000000), "historyCount": max(1, count), "knownPayee": bool(index % 2)}))
        script = "const fs=require('node:fs');const {historicalFeatures,sigmoid,FEATURE_NAMES}=require('./services/fraud/features');const model=require('./services/fraud/model.json');const cases=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(cases.map(input=>{const {values}=historicalFeatures(input);return {score:Math.min(94,Math.round(sigmoid(model.intercept+values.reduce((s,x,i)=>s+x*model.weights[i],0))*100)),features:Object.fromEntries(FEATURE_NAMES.map((k,i)=>[k,Number(values[i].toFixed(4))]))}})));"
        completed = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps(cases), text=True, capture_output=True, check=True, timeout=20)
        expected = json.loads(completed.stdout)
        model = FraudModel.load()
        for request, javascript in zip(cases, expected):
            with self.subTest(transactionId=request["transactionId"]):
                actual = model.assess(AssessmentRequest.model_validate(request))
                self.assertEqual(actual["score"], javascript["score"])
                self.assertEqual(actual["features"], javascript["features"])


if __name__ == "__main__":
    unittest.main()
