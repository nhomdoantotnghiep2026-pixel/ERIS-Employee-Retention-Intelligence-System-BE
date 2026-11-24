const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ollamaFetch } = require('../src/modules/ai/providers/ollama-http');

test('Ollama transport waits for delayed headers/body and honors an explicit abort', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    const timer = setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
      const bodyTimer = setTimeout(() => res.end('"ok":true}'), 30);
      res.on('close', () => clearTimeout(bodyTimer));
    }, 50);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = new URL(`http://127.0.0.1:${server.address().port}/api/chat`);
    const response = await ollamaFetch(url, { method: 'POST', body: '{}' });
    assert.equal(response.ok, true);
    assert.deepEqual(JSON.parse(await response.text()), { ok: true });
    await assert.rejects(ollamaFetch(url, {
      method: 'POST', body: '{}', signal: AbortSignal.timeout(10)
    }));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
