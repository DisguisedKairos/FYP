"""Service security and local Ollama contracts. Controlled transport is test-only."""
from __future__ import annotations
import copy
import json
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from fraud_service.application import BODY_LIMIT, create_app
from fraud_service.model import OllamaFraudModel
from fraud_service.schemas import AssessmentRequest

TOKEN = "python-fraud-contract-test-token-123456789"
HEADERS = {"Authorization": "Bearer " + TOKEN}


def payload(**changes):
    value = {"transactionId": "txn-private", "userId": "user-private", "sourceAccountId": "source-private",
             "payloadHash": "a" * 64, "type": "transfer", "amountCents": 2500, "accountBalanceCents": 2485050,
             "payee": "1020002001", "isInternal": False, "createdAt": "2026-10-23T06:00:00.000Z",
             "historySummary": {"averageOutgoingCents": 20000.0, "outgoingCount10m": 0,
                                "outgoingAmount10m": 0, "dailyOutgoingCents": 50000, "historyCount": 10, "knownPayee": True}}
    value.update(changes)
    return value


class ControlledTransport:
    def __init__(self):
        self.calls = []
        self.output = {"modelScore": 12, "reasonCodes": ["model_context"]}
        self.digest = "a" * 64
        self.remote = False
        self.fail = False
        self.mutate_digest = False
        self.done_reason = "stop"

    def __call__(self, method, url, body, timeout):
        self.calls.append((method, url, copy.deepcopy(body), timeout))
        if self.fail:
            raise OSError("Do not expose connection diagnostics or secrets")
        if url.endswith("/api/show"):
            return {"capabilities": ["completion", "tools"], **({"remote_host": "https://remote.example"} if self.remote else {})}
        if url.endswith("/api/tags"):
            return {"models": [{"name": "controlled-local", "digest": self.digest}]}
        if url.endswith("/api/chat"):
            if self.mutate_digest:
                self.digest = "b" * 64
            return {"model": "controlled-local", "done": True, "done_reason": self.done_reason,
                    "message": {"role": "assistant", "content": self.output if isinstance(self.output, str) else json.dumps(self.output)}}
        raise AssertionError("Unexpected model endpoint")


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.transport = ControlledTransport()
        self.model = OllamaFraudModel(model_name="controlled-local", request=self.transport)
        self.client = TestClient(create_app(token=TOKEN, model=self.model))
        self.addCleanup(self.client.close)

    def post(self, value):
        return self.client.post("/internal/assess", json=value, headers=HEADERS)

    def test_authentication_precedes_input_and_all_routes_are_private(self):
        for path in ("/internal/health", "/internal/model", "/docs", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post("/internal/assess", content="not-json").status_code, 401)
        self.assertEqual(len(self.transport.calls), 0)

    def test_metadata_reports_actual_local_provenance_without_simulated_metrics(self):
        health = self.client.get("/internal/health", headers=HEADERS)
        self.assertEqual(health.json()["provider"], "ollama")
        metadata = self.client.get("/internal/model", headers=HEADERS).json()["model"]
        self.assertTrue(metadata["localOnly"])
        self.assertEqual(metadata["modelName"], "controlled-local")
        self.assertEqual(metadata["modelSha256"], "a" * 64)
        self.assertNotIn("metrics", metadata)
        self.assertNotIn("training", metadata)

    def test_bound_output_comes_from_model_and_has_no_logistic_fallback(self):
        self.transport.output["modelScore"] = 28
        source = payload()
        risk = self.post(source).json()["risk"]
        for key in ("transactionId", "userId", "sourceAccountId", "payloadHash", "type", "amountCents", "payee", "isInternal"):
            self.assertEqual(risk[key], source[key])
        self.assertEqual(risk["modelScore"], 28)
        self.assertEqual(risk["decision"], "allow")
        self.assertEqual(risk["provider"], "ollama")
        self.assertNotIn("synthetic", risk)

    def test_prompt_omits_customer_identifiers_and_uses_schema_and_bounded_generation(self):
        self.post(payload())
        _, _, request, timeout = next(c for c in self.transport.calls if c[1].endswith("/api/chat"))
        prompt = json.dumps(request["messages"])
        for private in ("txn-private", "user-private", "source-private", "1020002001", "payloadHash"):
            self.assertNotIn(private, prompt)
        self.assertEqual(request["format"]["properties"]["modelScore"]["maximum"], 94)
        self.assertEqual(request["options"]["temperature"], 0)
        self.assertFalse(request["stream"])
        self.assertFalse(request["think"])
        self.assertEqual(timeout, 45)

    def test_high_score_needs_grounded_pattern_and_requests_human_review(self):
        self.transport.output = {"modelScore": 82, "reasonCodes": ["amount_deviation", "balance_share"]}
        risk = self.post(payload(amountCents=2000000)).json()["risk"]
        self.assertEqual(risk["decision"], "review")
        self.assertEqual(risk["score"], 82)
        self.assertEqual(len(risk["reasons"]), 2)
        self.transport.output = {"modelScore": 82, "reasonCodes": ["model_context"]}
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_unsupported_reason_cannot_be_published(self):
        self.transport.output = {"modelScore": 20, "reasonCodes": ["recent_activity"]}
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_changed_digest_during_inference_is_refused(self):
        self.transport.mutate_digest = True
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_remote_backed_model_and_outage_fail_closed(self):
        for flag in ("remote", "fail"):
            setattr(self.transport, flag, True)
            response = self.post(payload())
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("diagnostics", response.text)
            setattr(self.transport, flag, False)

    def test_invalid_scores_duplicate_json_and_extra_fields_fail_closed(self):
        for output in ({"modelScore": True, "reasonCodes": ["model_context"]},
                       {"modelScore": 95, "reasonCodes": ["model_context"]},
                       {"modelScore": -1, "reasonCodes": ["model_context"]},
                       {"modelScore": 10.5, "reasonCodes": ["model_context"]},
                       {"modelScore": 10, "reasonCodes": []},
                       {"modelScore": 10, "reasonCodes": ["model_context", "model_context"]},
                       {"modelScore": 10, "reasonCodes": ["model_context"], "execute": True},
                       '{"modelScore":10,"modelScore":20,"reasonCodes":["model_context"]}',
                       '{"modelScore":NaN,"reasonCodes":["model_context"]}'):
            with self.subTest(output=output):
                self.transport.output = output
                self.assertEqual(self.post(payload()).status_code, 503)

    def test_truncated_generation_is_not_used(self):
        self.transport.done_reason = "length"
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_scoring_concurrency_is_bounded_without_inference_fallback(self):
        self.model.slot.acquire()
        self.model.slot.acquire()
        try:
            self.assertEqual(self.post(payload()).status_code, 503)
            self.assertFalse(any(c[1].endswith("/api/chat") for c in self.transport.calls))
        finally:
            self.model.slot.release()
            self.model.slot.release()

    def test_strict_inputs_reject_wrong_types_unknown_fields_and_ambiguous_dates(self):
        for changes in ({"amountCents": "2500"}, {"amountCents": True}, {"amountCents": 0},
                        {"authorizationPassword": "Never-expose-this"}, {"isInternal": 1},
                        {"createdAt": "2026-02-31T00:00:00Z"}, {"createdAt": "2026-01-01"},
                        {"transactionId": "../bad"}, {"payloadHash": "bad"}):
            response = self.post(payload(**changes))
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("Never-expose-this", response.text)

    def test_inconsistent_history_is_not_silently_coerced(self):
        for history in ({"averageOutgoingCents": 0.0, "outgoingCount10m": 1, "outgoingAmount10m": 1, "dailyOutgoingCents": 0, "historyCount": 0, "knownPayee": False},
                        {"averageOutgoingCents": 0.0, "outgoingCount10m": 0, "outgoingAmount10m": 1, "dailyOutgoingCents": 0, "historyCount": 0, "knownPayee": False}):
            self.assertEqual(self.post(payload(historySummary=history)).status_code, 422)

    def test_malformed_duplicate_nonfinite_and_oversized_http_json_are_refused(self):
        headers = {**HEADERS, "Content-Type": "application/json"}
        for body in ('{"amountCents":1,"amountCents":2}', '{"amountCents":NaN}', '[1]', 'not-json'):
            self.assertEqual(self.client.post("/internal/assess", content=body, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/internal/assess", content="x" * (BODY_LIMIT + 1), headers=headers).status_code, 413)
        self.assertEqual(self.client.post("/internal/assess", content="{}", headers=HEADERS).status_code, 415)

    def test_singapore_hour_uses_the_timestamp_instant(self):
        self.post(payload(createdAt="2026-10-24T17:00:00.000Z"))
        request = next(c[2] for c in self.transport.calls if c[1].endswith("/api/chat"))
        facts = json.loads(request["messages"][-1]["content"])
        self.assertEqual(facts["singaporeHour"], 1)
        self.assertIn("unusual_hour", facts["evidenceCodes"])


class ConfigurationTests(unittest.TestCase):
    def test_missing_or_weak_service_token_prevents_startup(self):
        for token in ("", "short", "a b" * 20):
            with self.assertRaises(ValueError):
                create_app(token=token)

    def test_external_urls_cloud_names_and_offline_mode_are_refused(self):
        for url in ("https://example.com", "http://example.com", "http://u:p@localhost", "http://localhost/path", "http://localhost?x=1"):
            with self.assertRaises(ValueError):
                OllamaFraudModel(url=url)
        with self.assertRaises(ValueError):
            OllamaFraudModel(model_name="qwen-cloud")
        with patch.dict("os.environ", {"AGENT_MODE": "workflow"}):
            with self.assertRaises(ValueError):
                OllamaFraudModel()

    def test_missing_installed_model_digest_and_malformed_metadata_are_refused(self):
        fake = ControlledTransport()
        fake.digest = "missing"
        with self.assertRaises(ValueError):
            OllamaFraudModel(model_name="controlled-local", request=fake).info()
        for endpoint, result in (("/api/show", {"capabilities": None}),
                                 ("/api/show", {"capabilities": "completion"}),
                                 ("/api/show", {"capabilities": [["completion"]]}),
                                 ("/api/tags", {"models": [{"name": [], "model": {}, "digest": "a" * 64}]})):
            with self.subTest(result=result):
                base = ControlledTransport()
                def malformed(method, url, body, timeout):
                    return result if url.endswith(endpoint) else base(method, url, body, timeout)
                with self.assertRaises(ValueError):
                    OllamaFraudModel(model_name="controlled-local", request=malformed).info()


if __name__ == "__main__":
    unittest.main()
