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

    def test_local_audit_quickstart_uses_a_business_name_and_keeps_queued_id(self):
        code = re.search(r"```python\n(.*?)```", README.read_text().split("## Quick Start", 1)[1], re.S).group(1)
        response = Mock(ok=True, status_code=202)
        response.json.return_value = {"jobId": "owned-offline-job", "status": "queued"}
        output = io.StringIO()
        with patch("agentseo_sdk.client.requests.request", return_value=response) as request, redirect_stdout(output):
            exec(code, {})
        request.assert_called_once()
        kwargs = request.call_args.kwargs
        self.assertEqual(kwargs["method"], "POST")
        self.assertEqual(kwargs["url"], "https://www.agentseo.dev/api/v1/audit/local?sync=true")
        self.assertEqual(kwargs["json"], {"domain": "Example Dental", "location": "New York, NY"})
        self.assertNotRegex(kwargs["json"]["domain"], r"(?:https?://|^[^\s]+\.[a-z]{2,}$)")
        self.assertIn("owned-offline-job", output.getvalue())

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
