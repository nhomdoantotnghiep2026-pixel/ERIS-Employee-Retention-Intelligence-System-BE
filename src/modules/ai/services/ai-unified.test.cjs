const assert = require('node:assert/strict');
const { test } = require('node:test');
const { UnifiedAnalysis, OllamaProvider } = require('./ai-unified.service');

test('normal analysis preserves original evidence and checks the fingerprint before saving', async () => {
  const period = { start: '2025-01-01', end: '2025-01-31' };
  const preview = { ready: true, period };
  const policy = { id: '1', code: 'P1', name: 'Rà soát tăng ca' };
  const evidence = { id: 'ATTENDANCE_MONTH:2025-01', source: 'ATTENDANCE', month: '2025-01',
    overtimeMinutes: 300, recordedDays: 10 };
  const calls = [];
  const repository = {
    pool: { query: async () => ({ rows: [] }) },
    assertHr: async () => {},
    readSnapshot: async () => preview,
    save: async (_actor, _preview, _model, analysis) => {
      assert.deepEqual(analysis.recommendations[0].evidence, [evidence]);
      calls.push('save');
      return { predictionId: 8 };
    }
  };
  const service = { predict: async () => ({ preview, model: { riskLevel: 'HIGH' } }) };
  const agent = { context: async () => {
    calls.push('context');
    return { fingerprint: 'current', context: { policies: [policy], evidence: [evidence] } };
  } };
  const retriever = { name: 'E5', configured: () => true, rank: async () => ({
    recommendations: [{ policyId: '1', similarity: 0.8, evidence: [evidence] }],
    noRecommendationReason: null
  }) };
  const provider = { name: 'OLLAMA', configured: () => true, generate: async context => {
    calls.push('qwen');
    assert.deepEqual(context.evidencePeriod, period);
    assert.match(context.evidence[0].fact, /300 phút/);
    return { recommendations: [{ policyId: '1', evidenceIds: [evidence.id],
      reason: 'Chấm công ghi nhận 300 phút tăng ca. HR có thể rà soát lịch giao việc.',
      hrVerification: 'Đối chiếu lịch ca với bảng chấm công.' }], noRecommendationReason: null };
  } };
  const analysis = new UnifiedAnalysis(service, repository, { agent, retriever, provider });
  const result = await analysis.run(1, 7, { snapshotId: 3, save: true, confirmExternalData: true });
  assert.deepEqual(calls, ['context', 'qwen', 'context', 'save']);
  assert.equal(result.predictionId, 8);
  assert.equal(result.policyAnalysis.recommendations[0].policy.code, 'P1');
});

test('one Qwen call can select the third E5 policy and resolve its original evidence', async () => {
  const candidates = [1, 2, 3].map(id => ({
    policyId: String(id),
    policy: { id: String(id), code: `P${id}`, name: `Policy ${id}` },
    evidence: [{
      id: `SURVEY:${id}:1`, source: 'SURVEY', question_text: 'Khối lượng công việc',
      answer_value: 2, answer_config: { min: 1, max: 5, positiveDirection: 'HIGH' },
      comment: 'Công việc thường dồn cuối tuần. '.repeat(12)
    }]
  }));
  const proposal = {
    policyId: '3', evidenceIds: ['SURVEY:3:1'], reason: 'Nhân viên đánh giá ở mức 2/5. Có thể rà soát lịch giao việc.',
    hrVerification: 'Đối chiếu lịch giao việc với bảng chấm công.'
  };
  let calls = 0;
  let output = { recommendations: [proposal], noRecommendationReason: 'Không có chính sách phù hợp.' };
  const writer = new OllamaProvider({
    url: 'http://localhost:11434',
    model: 'qwen2.5:3b',
    fetchImpl: async (_url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      const context = JSON.parse(payload.messages[1].content);
      assert.deepEqual(context.policies.map(policy => policy.id), ['1', '2', '3']);
      assert.match(context.evidence[2].fact, /2\/5 \(thang 1–5\)/);
      assert.ok(context.evidence[2].fact.length < candidates[2].evidence[0].comment.length);
      assert.equal(payload.options.num_predict, 384);
      assert.equal(payload.format.properties.recommendations.maxItems, 2);
      return { ok: true, text: async () => JSON.stringify({
        done: true, done_reason: 'stop', message: { content: JSON.stringify(output) }
      }) };
    }
  });
  const analysis = new UnifiedAnalysis({}, {}, { agent: {}, writer });
  const run = () => analysis.writeRecommendations(candidates, {}, {});
  const result = await run();
  assert.equal(calls, 1);
  assert.equal(result.noRecommendationReason, null);
  assert.equal(result.recommendations[0].policy.code, 'P3');
  assert.deepEqual(result.recommendations[0].evidence, candidates[2].evidence);

  output = { recommendations: [], noRecommendationReason: 'Chưa đủ căn cứ.' };
  assert.deepEqual(await run(), output);
  output = { recommendations: [{ ...proposal, evidenceIds: ['SURVEY:1:1'] }], noRecommendationReason: null };
  await assert.rejects(run(), /linked evidence/);
  output = { recommendations: [{ ...proposal, policyId: '99' }], noRecommendationReason: null };
  await assert.rejects(run(), /shortlisted policies/);
});
