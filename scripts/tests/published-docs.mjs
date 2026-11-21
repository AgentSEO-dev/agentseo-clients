import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const root = process.cwd();
const fixture = path.join(root, 'tests/fixtures/published-clients/node_modules');
const sdkRoot = path.join(fixture, '@agentseo/sdk');
assert.equal(JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'))).version, '0.1.1');
const { AgentSEO } = await import(pathToFileURL(path.join(sdkRoot, 'dist/index.js')));
assert.equal(typeof new AgentSEO({ apiKey: 'offline-fixture' }).getJob, 'function');
// The docs must work even though this published version lacks the new source helper.
assert.equal(typeof new AgentSEO({ apiKey: 'offline-fixture' }).waitForJob, 'undefined');
const blocks = text => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1].trim());
const snippets = [];
for (const file of ['README.md', 'packages/js-sdk/README.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(text, /npm (?:install|i) @agentseo\/sdk@0\.1\.1/);
  const quick = blocks(text).find(code => /import \{ AgentSEO \} from ["']@agentseo\/sdk["']/.test(code));
  assert.ok(quick, file + ' executable quickstart missing');
  snippets.push({ name: file + ' quickstart', code: quick });
  if (file.includes('js-sdk')) {
    const fragment = blocks(text.split('## Async Jobs (queue + poll)')[1])[0];
    const setup = quick.slice(0, quick.indexOf('// Submit once.'));
    assert.ok(setup.includes('async function pollExistingJob'));
    snippets.push({ name: file + ' async example', code: setup + fragment });
  }
}
const resourceFile = path.join(root, 'lib/docs/resources.json');
if (fs.existsSync(resourceFile)) {
  const markdown = JSON.parse(fs.readFileSync(resourceFile))['/docs/sdks'].markdown;
  const code = blocks(markdown).find(code => code.startsWith('import { AgentSEO }'));
  assert.ok(code, 'Generated SDK Markdown example missing');
  snippets.push({ name: 'SDK generated Markdown', code });
  const docs = await import(pathToFileURL(path.join(root, 'lib/docs/javascript-sdk-example.mjs')));
  snippets.push({ name: 'Homepage JavaScript', code: docs.SDK_HOME_EXAMPLE });
}

const originalFetch = globalThis.fetch;
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () { throw new Error('Network forbidden in published-docs tests'); };
let checks = 0;
try {
  for (const { name, code } of snippets) {
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: code, encoding: 'utf8' });
    assert.equal(syntax.status, 0, name + ': ' + syntax.stderr);
    const executable = code.replace(/import \{ AgentSEO \} from ["']@agentseo\/sdk["'];?/, '');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const scenario of ['completed', 'failed', 'timeout', 'unexpected', 'empty-result', 'poll-network', 'post-network', 401, 402, 429, 500, 'missing-key']) {
      let clock = 0;
      const calls = [], printed = [], errors = [];
      const jobId = '11111111-1111-4111-8111-111111111111';
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options.method });
        if (scenario === 'post-network' || (scenario === 'poll-network' && options.method === 'GET')) throw new TypeError('fetch failed');
        if (typeof scenario === 'number') return new Response(JSON.stringify({ error: { message: 'HTTP ' + scenario } }), { status: scenario });
        if (options.method === 'POST') return new Response(JSON.stringify({ jobId, status: 'queued' }), { status: 202 });
        const waiting = ['queued', 'pending', 'processing', 'retrying'];
        const polls = calls.filter(c => c.method === 'GET').length;
        const status = scenario === 'timeout' ? 'processing' : polls <= 4 ? waiting[polls - 1] : scenario === 'failed' ? 'failed' : scenario === 'unexpected' ? 'unknown' : 'completed';
        return new Response(JSON.stringify({ jobId, status, result: status === 'completed' && scenario !== 'empty-result' ? { summary: 'Ready' } : null, error: { message: 'Expected job failure' } }), { status: 200 });
      };
      class Clock extends Date { static now() { return clock; } }
      const run = new AsyncFunction('AgentSEO', 'process', 'console', 'setTimeout', 'Date', executable);
      let failure;
      try {
        await run(AgentSEO, { env: scenario === 'missing-key' ? {} : { AGENTSEO_API_KEY: 'offline-fixture' } }, {
          log: (...args) => printed.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')),
        }, (callback, ms) => { clock += ms; callback(); }, Clock);
      } catch (error) { failure = error; }
      assert.equal(calls.filter(c => c.method === 'POST').length, scenario === 'missing-key' ? 0 : 1, name + ': no replacement submissions');
      for (const c of calls.filter(c => c.method === 'GET')) assert.equal(c.url, 'https://www.agentseo.dev/api/v1/jobs/' + jobId);
      if (scenario === 'completed') {
        assert.equal(failure, undefined, name); assert.equal(JSON.parse(printed[0]).summary, 'Ready');
        assert.equal(calls.filter(c => c.method === 'GET').length, 5);
      } else {
        assert.ok(failure, name + ': ' + scenario + ' must not appear successful'); assert.equal(printed.length, 0);
      }
      if (calls.some(c => c.method === 'GET')) assert.ok(errors.join('\n').includes(jobId), name + ': preserve original ID before polling');
      if (scenario === 'timeout') { assert.match(failure.message, /do not resubmit/); assert.ok(failure.message.includes(jobId)); assert.ok(calls.length <= 46); }
      checks++;
    }
  }

  const acpReadme = path.join(root, 'packages/acp-adapter/README.md');
  if (fs.existsSync(acpReadme)) {
    const text = fs.readFileSync(acpReadme, 'utf8');
    const url = text.match(/export AGENTSEO_API_URL="([^"]+)"/)?.[1];
    assert.equal(url, 'https://www.agentseo.dev/api/v1');
    const oldUrl = process.env.AGENTSEO_API_URL, oldKey = process.env.AGENTSEO_API_KEY;
    process.env.AGENTSEO_API_URL = url; process.env.AGENTSEO_API_KEY = 'offline-fixture';
    try {
      const acpRoot = path.join(fixture, '@agentseo/acp-adapter');
      assert.equal(JSON.parse(fs.readFileSync(path.join(acpRoot, 'package.json'))).version, '0.1.2');
      const { default: axios } = await import(pathToFileURL(path.join(fixture, 'axios/index.js')));
      const originalRequest = axios.request, calls = [];
      axios.request = async options => { calls.push(options); return { data: { jobId: 'offline-job', status: 'queued' } }; };
      try {
        const { AgentSeoTools } = await import(pathToFileURL(path.join(acpRoot, 'dist/index.js')));
        await AgentSeoTools.find(tool => tool.name === 'agentseo_search').execute({ query: 'offline fixture', limit: 3 });
        assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://www.agentseo.dev/api/v1/search'); checks++;
      } finally { axios.request = originalRequest; }
    } finally {
      if (oldUrl === undefined) delete process.env.AGENTSEO_API_URL; else process.env.AGENTSEO_API_URL = oldUrl;
      if (oldKey === undefined) delete process.env.AGENTSEO_API_KEY; else process.env.AGENTSEO_API_KEY = oldKey;
    }
  }
} finally { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
console.log(JSON.stringify({ status: 'PASS', snippets: snippets.length, cases: checks, artifact: '@agentseo/sdk@0.1.1', realHttpRequests: 0, creditsUsed: 0, packagePublishing: false }));
