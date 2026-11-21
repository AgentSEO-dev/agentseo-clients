import json
import socket
import unittest
from copy import deepcopy
from unittest.mock import patch
from uuid import UUID

from requests import Response
from requests.exceptions import ConnectionError, Timeout

from agentseo_sdk import AgentSEOClient, AgentSEOError


def response(status=202, body=None):
    result = Response()
    result.status_code = status
    result._content = json.dumps(body or {"jobId": "offline-job", "status": "queued"}).encode()
    return result


class RetrySafetyTests(unittest.TestCase):
    def setUp(self):
        # Fail closed: a missed mock must never reach a network or paid API.
        self.network_guard = patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden in SDK tests"))
        self.network_guard.start()
        self.addCleanup(self.network_guard.stop)
        self.sleep = patch("agentseo_sdk.client.time.sleep").start()
        self.addCleanup(patch.stopall)
        self.calls = []

    def transport(self, outcomes):
        sequence = iter(outcomes)

        def send(**kwargs):
            self.calls.append(deepcopy(kwargs))
            outcome = next(sequence)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        return patch("agentseo_sdk.client.requests.request", side_effect=send)

    def assert_one_identity(self):
        identities = [call["headers"].get("idempotency-key") for call in self.calls]
        self.assertGreater(len(identities), 1)
        self.assertIsInstance(identities[0], str)
        self.assertEqual(UUID(identities[0]).version, 4)
        self.assertEqual(len(set(identities)), 1)
        self.assertTrue(all(call["method"] == "POST" for call in self.calls))
        self.assertTrue(all(call["json"] == self.calls[0]["json"] for call in self.calls))
        return identities[0]

    def test_transient_http_errors_reuse_one_generated_key(self):
        for status in [429, 502, 503, 504]:
            with self.subTest(status=status):
                self.calls = []
                with self.transport([response(status), response()]):
                    result = AgentSEOClient("sk_live_offline_fixture").search("retry fixture", sync=True)
                self.assertEqual(result["jobId"], "offline-job")
                self.assert_one_identity()
                self.assertEqual(self.calls[0]["url"], "https://www.agentseo.dev/api/v1/search?sync=true")

    def test_lost_responses_reuse_one_generated_key(self):
        for error in [Timeout("Response lost after acceptance"), ConnectionError("Connection lost")]:
            with self.subTest(error=type(error).__name__):
                self.calls = []
                with self.transport([error, response()]):
                    AgentSEOClient("sk_live_offline_fixture").search("retry fixture")
                self.assert_one_identity()

    def test_exhausted_retries_do_not_mint_replacement_keys(self):
        with self.transport([Timeout(), Timeout(), Timeout()]):
            with self.assertRaises(AgentSEOError) as caught:
                AgentSEOClient("sk_live_offline_fixture", max_retries=2).search("retry fixture")
        self.assertEqual(caught.exception.code, "REQUEST_TIMEOUT")
        self.assertEqual(len(self.calls), 3)
        self.assert_one_identity()

    def test_explicit_key_is_preserved_exactly_across_retries(self):
        with self.transport([Timeout(), response()]):
            AgentSEOClient("sk_live_offline_fixture")._post("/api/v1/search", {"query": "fixture"}, idempotency_key="Exact-Caller-Key")
        self.assertEqual([call["headers"]["idempotency-key"] for call in self.calls], ["Exact-Caller-Key"] * 2)

    def test_explicit_empty_key_is_not_replaced_by_a_new_identity(self):
        with self.transport([response(400, {"error": {"message": "Invalid key"}})]):
            with self.assertRaises(AgentSEOError):
                AgentSEOClient("sk_live_offline_fixture")._post("/api/v1/search", {}, idempotency_key="")
        self.assertEqual(self.calls[0]["headers"]["idempotency-key"], "")
        self.assertEqual(len(self.calls), 1)

    def test_independent_calls_have_distinct_keys_even_for_identical_inputs(self):
        with self.transport([response(), response()]):
            client = AgentSEOClient("sk_live_offline_fixture")
            client.search("same query")
            client.search("same query")
        identities = [call["headers"]["idempotency-key"] for call in self.calls]
        self.assertNotEqual(identities[0], identities[1])
        self.assertTrue(all(UUID(identity).version == 4 for identity in identities))

    def test_job_reads_retry_without_mutation_identity(self):
        with patch("agentseo_sdk.client.uuid4") as generated:
            with self.transport([response(503), response(200)]):
                AgentSEOClient("sk_live_offline_fixture").get_job("offline-job")
        generated.assert_not_called()
        self.assertEqual([call["method"] for call in self.calls], ["GET", "GET"])
        self.assertTrue(all("idempotency-key" not in call["headers"] for call in self.calls))

    def test_nonretryable_errors_stop_after_one_post(self):
        for status in [400, 401, 402, 403, 409]:
            with self.subTest(status=status):
                self.calls = []
                with self.transport([response(status, {"error": {"message": "Rejected"}})]):
                    with self.assertRaises(AgentSEOError):
                        AgentSEOClient("sk_live_offline_fixture").search("fixture")
                self.assertEqual(len(self.calls), 1)

    def test_zero_retries_sends_one_post(self):
        with self.transport([Timeout()]):
            with self.assertRaises(AgentSEOError):
                AgentSEOClient("sk_live_offline_fixture", max_retries=0).search("fixture")
        self.assertEqual(len(self.calls), 1)

    def test_all_public_post_methods_use_the_common_identity_boundary(self):
        calls = [
            lambda client: client.local_audit("example.com", "United States"),
            lambda client: client.content_gap("https://example.com", "fixture"),
            lambda client: client.search("fixture"),
            lambda client: client.analyze_serp("fixture"),
            lambda client: client.ai_overview_extract("fixture"),
            lambda client: client.local_visibility_track("example.com", ["fixture"], ["United States"]),
            lambda client: client.llm_mentions_track("fixture", ["fixture"]),
            lambda client: client.content_decay_detect("https://example.com", "fixture"),
            lambda client: client.keyword_cluster_build(["fixture"]),
        ]
        for invoke in calls:
            with self.subTest(invoke=invoke):
                self.calls = []
                with self.transport([Timeout(), response()]):
                    invoke(AgentSEOClient("sk_live_offline_fixture"))
                self.assert_one_identity()


if __name__ == "__main__":
    unittest.main()
