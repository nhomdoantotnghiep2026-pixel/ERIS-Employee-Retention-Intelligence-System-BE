const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E5Provider } = require('../src/modules/ai/ai-e5.provider');
const { UnifiedAnalysis } = require('../src/modules/ai/ai-unified.service');

test('Qwen receives only E5 candidates and cannot cite another policy match', async () => {
  const candidate = id => ({
    policy: { id, name: 'Policy ' + id }, policyId: id, policyName: 'Policy ' + id,
    evidence: [{ id: 'SURVEY:' + id, source: 'SURVEY', comment: 'Original record' }],
    evidenceText: 'Matched signal ' + id, similarity: 0.8
  });
  let evidenceId = 'SURVEY:39';
  const analysis = new UnifiedAnalysis({}, { pool: {} }, {
    writer: { generate: async context => {
      assert.deepEqual(context.policies.map(policy => policy.id), ['39', '55']);
      assert.deepEqual(context.evidence[0], { id: 'SURVEY:39', source: 'SURVEY', text: 'Matched signal 39' });
      assert.equal(context.model.features, undefined);
      return { recommendations: [{ policyId: '39', reason: 'Lý do từ bằng chứng', evidenceIds: [evidenceId],
        hrVerification: 'Kiểm tra bằng chứng' }], noRecommendationReason: null };
    }}
  });
  const model = { riskLevel: 'HIGH', score: 0.8, features: { salary: 123 } };
  const candidates = [candidate('39'), candidate('55')];
  const { recommendations } = await analysis.writeRecommendations(candidates, model);
  assert.equal(recommendations[0].policyName, 'Policy 39');
  assert.equal(recommendations[0].reason, 'Lý do từ bằng chứng');
  assert.equal(recommendations[0].evidenceText, 'Matched signal 39');
  evidenceId = 'SURVEY:55';
  await assert.rejects(analysis.writeRecommendations(candidates, model), { statusCode: 502 });
});

test('E5 sends employee evidence and skips risk-only inputs', async () => {
  let calls = 0;
  const provider = new E5Provider({
    url: 'https://e5.example.test', clientId: 'test-id', clientSecret: 'test-secret',
    fetchImpl: async (url, request) => {
      calls++;
      assert.equal(String(url), 'https://e5.example.test/recommend');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['CF-Access-Client-Id'], 'test-id');
      assert.equal(request.headers['CF-Access-Client-Secret'], 'test-secret');
      const payload = JSON.parse(request.body);
      assert.deepEqual(payload.eligiblePolicyIds, ['39']);
      assert.equal(payload.signals.length, 1);
      const [{ evidenceId, text }] = payload.signals;
      assert.equal(evidenceId, 'SURVEY:15:8');
      assert.match(text, /tăng ca cuối tuần/);
      return { ok: true, json: async () => ({ candidates: [{
        policyId: '39', policyName: 'Rà soát tăng ca', evidenceId, evidenceText: text, similarity: 0.89
      }] }) };
    }
  });
  const context = { policies: [{ id: '39', name: 'Rà soát tăng ca' }], evidence: [{ source: 'MODEL', id: 'MODEL:Risk' }] };
  assert.deepEqual((await provider.rank(context)).recommendations, []);
  assert.equal(calls, 0);
  context.evidence.push({ id: 'SURVEY:15:8', source: 'SURVEY', question_text: 'Khối lượng công việc?', comment: 'Thường xuyên tăng ca cuối tuần' });
  const result = await provider.rank(context);
  assert.equal(result.recommendations[0].policyName, 'Rà soát tăng ca');
  assert.match(result.recommendations[0].evidenceText, /tăng ca cuối tuần/);
  assert.equal(calls, 1);
});

test('individual analysis preserves and saves prediction when E5 is unreachable', async () => {
  const preview = { snapshotId: 3, period: { start: '2026-11-01', end: '2026-11-19' } };
  const model = { score: 0.8 };
  let calls = 0;
  const repository = {
    assertHr: async () => {},
    pool: { query: async (_sql, params) => {
      assert.equal(params[0], 7);
      return { rows: [] };
    } },
    save: async (_actor, savedPreview, savedModel, analysis) => {
      assert.equal(savedPreview, preview);
      assert.equal(savedModel, model);
      assert.deepEqual(analysis.recommendations, []);
      return { predictionId: 9 };
    }
  };
  const analysis = new UnifiedAnalysis({ predict: async () => ({ preview, model }) }, repository, {
    agent: { context: async (_actor, selection) => {
      assert.equal(selection.employeeId, 7);
      return { context: {}, fingerprint: 'test' };
    }},
    provider: { name: 'E5', rank: async () => { calls++; throw new Error('offline'); } }
  });
  const result = await analysis.run(1, 7, { snapshotId: 3, save: true, confirmExternalData: true });
  assert.equal(calls, 1);
  assert.equal(result.predictionId, 9);
  assert.equal(result.model.score, 0.8);
  assert.deepEqual(result.policyAnalysis.recommendations, []);
});
