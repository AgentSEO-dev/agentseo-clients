import re
import io
from contextlib import redirect_stdout
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from agentseo_sdk import AgentSEOClient

ROOT = Path(__file__).resolve().parents[3]
README = ROOT / "packages/python-sdk/README.md"

class DocumentationExamples(unittest.TestCase):
    def test_install_uses_official_source_and_import_check(self):
        paths = [README]
        if (ROOT / "README.md").exists() and "AgentSEO Clients" in (ROOT / "README.md").read_text():
            paths.append(ROOT / "README.md")
        for path in paths:
            text = path.read_text()
            self.assertNotRegex(text, r"(?:python -m )?pip install agentseo-sdk")
            self.assertIn("git clone https://github.com/AgentSEO-dev/agentseo-clients.git\ncd agentseo-clients\npython -m pip install ./packages/python-sdk", text)
            command = re.search(r'python -c "([^"\n]+)"', text).group(1)
            with patch("agentseo_sdk.client.requests.request", side_effect=AssertionError("No API calls")):
                exec(command, {})

    def run_quickstart(self, code, endpoint, payload):
        job_id = "docs-offline-job"
        responses = [
            (202, {"jobId": job_id, "status": "queued"}),
            (200, {"jobId": job_id, "status": "processing"}),
            (200, {"jobId": job_id, "status": "completed", "result": {"summary": "Ready"}}),
        ]
        for terminal in ("completed", "failed"):
            with self.subTest(endpoint=endpoint, terminal=terminal):
                terminal_body = responses[-1][1] if terminal == "completed" else {
                    "jobId": job_id, "status": "failed", "error": {"message": "Fixture failure"}
                }
                output = io.StringIO()

                def reply(method, url, **kwargs):
                    status, body = next(sequence)
                    if method == "GET":
                        self.assertIn(job_id, output.getvalue(), "print the ID before polling")
                    response = Mock(ok=True, status_code=status)
                    response.json.return_value = body
                    return response

                sequence = iter([*responses[:2], (200, terminal_body)])
                with patch("agentseo_sdk.client.requests.request", side_effect=reply) as request, \
                     patch("agentseo_sdk.client.time.sleep"), redirect_stdout(output):
                    if terminal == "failed":
                        with self.assertRaisesRegex(RuntimeError, "Fixture failure"):
                            exec(code, {})
                    else:
                        exec(code, {})
                        self.assertIn("Ready", output.getvalue())

                calls = [call.kwargs for call in request.call_args_list]
                base = "https://www.agentseo.dev/api/v1"
                self.assertEqual([(c["method"], c["url"]) for c in calls], [
                    ("POST", base + endpoint),
                    ("GET", base + "/jobs/" + job_id),
                    ("GET", base + "/jobs/" + job_id),
                ])
                self.assertEqual(calls[0]["json"], payload)

    def test_local_audit_quickstart_waits_on_the_original_job(self):
        code = re.search(r"```python\n(.*?)```", README.read_text().split("## Quick Start", 1)[1], re.S).group(1)
        self.run_quickstart(code, "/audit/local", {"domain": "Example Dental", "location": "New York, NY"})

    def test_root_search_quickstart_waits_on_the_original_job(self):
        code = re.search(r"```python\n(.*?)```", (ROOT / "README.md").read_text(), re.S).group(1)
        self.run_quickstart(code, "/search", {"query": "seo api", "limit": 10, "location": "United States"})

    def run_async_example(self, terminal):
        text = README.read_text().split("## Async Jobs", 1)[1]
        code = re.search(r"```python\n(.*?)```", text, re.S).group(1)
        client = AgentSEOClient(api_key="docs-fixture")
        states = iter([{"jobId": "same-job", "status": "queued"},
                       {"jobId": "same-job", "status": "processing"}, terminal])
        def transport(request):
            raise AssertionError("Network must be mocked")
        with patch.object(client, "content_gap", return_value={"jobId": "same-job"}) as submit, \
             patch.object(client, "get_job", side_effect=lambda job_id, **kwargs: (self.assertEqual(job_id, "same-job"), next(states))[1]) as poll, \
             patch("time.sleep"), patch("agentseo_sdk.client.requests.request", side_effect=transport):
            scope = {"client": client}
            if terminal["status"] == "failed":
                with self.assertRaises(RuntimeError):
                    exec(code, scope)
            else:
                exec(code, scope)
                self.assertEqual(scope["completed"]["result"], {"summary": "Ready"})
            submit.assert_called_once()
            self.assertEqual(poll.call_count, 3)

    def test_async_example_waits_on_the_same_job(self):
        self.run_async_example({"jobId": "same-job", "status": "completed", "result": {"summary": "Ready"}})

    def test_async_example_reports_failure(self):
        self.run_async_example({"jobId": "same-job", "status": "failed", "error": "Failed"})
