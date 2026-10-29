"""Service security and OpenAI contracts. Controlled transport is test-only."""
from __future__ import annotations
import copy
import hashlib
import json
import unittest
from fastapi.testclient import TestClient
from fraud_service.application import BODY_LIMIT, create_app
from fraud_service.model import OpenAIFraudModel
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
        self.fail = False
        self.refusal = False
        self.response_model = "controlled-openai"
        self.status = "completed"

    def __call__(self, method, url, body, timeout):
        self.calls.append((method, url, copy.deepcopy(body), timeout))
        if self.fail:
            raise OSError("Do not expose connection diagnostics or secrets")
        if url.endswith("/models/controlled-openai"):
            return {"id": "controlled-openai"}
        if url.endswith("/responses"):
            content = {"type": "refusal", "refusal": "declined"} if self.refusal else {"type": "output_text", "text": self.output if isinstance(self.output, str) else json.dumps(self.output)}
            return {"id": "resp_controlled", "model": self.response_model, "status": self.status,
                    "output": [{"type": "message", "role": "assistant", "content": [content]}]}
        raise AssertionError("Unexpected model endpoint")

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.transport = ControlledTransport()
        self.model = OpenAIFraudModel(model_name="controlled-openai", request=self.transport)
        self.client = TestClient(create_app(token=TOKEN, model=self.model))
        self.addCleanup(self.client.close)

    def post(self, value):
        return self.client.post("/internal/assess", json=value, headers=HEADERS)

    def test_authentication_precedes_input_and_all_routes_are_private(self):
        for path in ("/internal/health", "/internal/model", "/docs", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post("/internal/assess", content="not-json").status_code, 401)
        self.assertEqual(len(self.transport.calls), 0)

    def test_metadata_reports_actual_api_provenance_without_simulated_metrics(self):
        health = self.client.get("/internal/health", headers=HEADERS)
        self.assertEqual(health.json()["provider"], "openai")
        metadata = self.client.get("/internal/model", headers=HEADERS).json()["model"]
        self.assertFalse(metadata["localOnly"])
        self.assertEqual(metadata["modelName"], "controlled-openai")
        self.assertEqual(metadata["modelIdentitySha256"], hashlib.sha256(b"openai:controlled-openai").hexdigest())
        self.assertNotIn("modelSha256", metadata)
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
        self.assertEqual(risk["provider"], "openai")
        self.assertEqual(risk["responseId"], "resp_controlled")
        self.assertNotIn("synthetic", risk)

    def test_prompt_omits_customer_identifiers_and_uses_schema_and_bounded_generation(self):
        self.post(payload())
        _, _, request, timeout = next(c for c in self.transport.calls if c[1].endswith("/responses"))
        prompt = json.dumps(request["input"])
        for private in ("txn-private", "user-private", "source-private", "1020002001", "payloadHash"):
            self.assertNotIn(private, prompt)
        self.assertEqual(request["text"]["format"]["schema"]["properties"]["modelScore"]["maximum"], 94)
        self.assertFalse(request["store"])
        self.assertTrue(request["text"]["format"]["strict"])
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

    def test_mismatched_api_response_model_is_refused(self):
        self.transport.response_model = "unrequested-model"
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_provider_refusal_and_outage_fail_closed(self):
        for flag in ("refusal", "fail"):
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
        self.transport.status = "incomplete"
        self.assertEqual(self.post(payload()).status_code, 503)

    def test_scoring_concurrency_is_bounded_without_inference_fallback(self):
        self.model.slot.acquire()
        self.model.slot.acquire()
        try:
            self.assertEqual(self.post(payload()).status_code, 503)
            self.assertFalse(any(c[1].endswith("/responses") for c in self.transport.calls))
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
        request = next(c[2] for c in self.transport.calls if c[1].endswith("/responses"))
        facts = json.loads(request["input"][-1]["content"])
        self.assertEqual(facts["singaporeHour"], 1)
        self.assertIn("unusual_hour", facts["evidenceCodes"])


class ConfigurationTests(unittest.TestCase):
    def test_missing_or_weak_service_token_prevents_startup(self):
        for token in ("", "short", "a b" * 20):
            with self.assertRaises(ValueError):
                create_app(token=token)

    def test_invalid_model_identifiers_and_missing_key_are_refused(self):
        for name in ("https://example.com/model", "invalid model", "", "gpt/example"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                OpenAIFraudModel(model_name=name)
        with self.assertRaises(ValueError):
            OpenAIFraudModel(api_key="").info()

    def test_unavailable_or_mismatched_model_metadata_is_refused(self):
        for identifier in (None, [], "different-model"):
            def request(method, url, body, timeout):
                return {"id": identifier}
            with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                OpenAIFraudModel(model_name="controlled-openai", request=request).info()


if __name__ == "__main__":
    unittest.main()
