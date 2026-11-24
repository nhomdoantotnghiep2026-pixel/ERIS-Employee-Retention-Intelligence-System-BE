const { Agent, request } = require('undici');

// Dedicated to Ollama: inference can take longer than the default 300s HTTP wait.
// Keep connection establishment bounded so an unreachable host fails promptly.
const dispatcher = new Agent({ connectTimeout: 10000 });

async function ollamaFetch(url, options) {
  const response = await request(url, {
    dispatcher,
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    headersTimeout: 0,
    bodyTimeout: 0,
    maxRedirections: 0
  });
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    text: () => response.body.text(),
    discard: () => response.body.dump()
  };
}

module.exports = { ollamaFetch };
