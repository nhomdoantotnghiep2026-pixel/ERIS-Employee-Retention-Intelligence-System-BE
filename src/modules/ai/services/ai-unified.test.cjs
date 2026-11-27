const assert = require('node:assert/strict');
const { test } = require('node:test');
const { UnifiedAnalysis, OllamaProvider } = require('./ai-unified.service');
const { E5Provider } = require('../providers/ai-e5.provider');
const { snapshotEvidence } = require('../helpers/snapshot-evidence');

test('normal analysis preserves original evidence and checks the fingerprint before saving', async () => {
  const period = { start: '2025-01-01', end: '2025-01-31' };
  const preview = { ready: true, period, snapshotDate: '2025-01-31',
    features: { Work_Hours_Per_Week: 46, Monthly_Salary: 1200, Age: 35 },
    monthlySalaryVnd: 30000000 };
  const policy = { id: '1', code: 'P1', name: 'Rà soát tăng ca' };
  const evidence = { id: 'ATTENDANCE_MONTH:2025-01', source: 'ATTENDANCE', month: '2025-01',
    overtimeMinutes: 300, recordedDays: 10 };
  const calls = [];
  const repository = {
    pool: { query: async () => ({ rows: [] }) },
    assertHr: async () => {},
    readSnapshot: async () => preview,
    save: async (_actor, _preview, _model, analysis) => {
      assert.deepEqual(analysis.recommendations[0].evidence,
        [evidence, snapshotEvidence(preview).find(item => item.feature === 'Work_Hours_Per_Week')]);
      calls.push('save');
      return { predictionId: 8 };
    }
  };
  const service = { predict: async () => ({ preview,
    model: { riskLevel: 'HIGH', score: 0.3, contributions: { Age: 0.5, Work_Hours_Per_Week: 0.01 } } }) };
  const agent = { context: async () => {
    calls.push('context');
    return { fingerprint: 'current', context: { policies: [policy], evidence: [evidence] } };
  } };
  const retriever = new E5Provider({ url: 'http://127.0.0.1:18092', fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls.push('e5');
    assert.deepEqual(payload.eligiblePolicyIds, ['1']);
    assert.ok(payload.signals.some(signal => signal.text.includes('30000000 VND')));
    assert.ok(payload.signals.every(signal => !signal.evidenceId.endsWith('Age')));
    const main = payload.signals.find(signal => signal.evidenceId === evidence.id);
    const signal = main ?? payload.signals.find(item => item.evidenceId === 'SNAPSHOT:Work_Hours_Per_Week');
    if (!main) assert.match(signal.text, /46 giờ\/tuần.*0\.3.*0\.01/);
    return { ok: true, json: async () => ({ candidates: [{ policyId: '1', policyName: policy.name,
      evidenceId: signal.evidenceId, evidenceText: signal.text, similarity: main ? 0.8 : 0.76 }] }) };
  } });
  const provider = { name: 'OLLAMA', configured: () => true, generate: async context => {
    calls.push('qwen');
    assert.deepEqual(context.evidencePeriod, period);
    assert.match(context.evidence[0].fact, /300 phút/);
    assert.match(context.evidence[1].fact, /46 giờ\/tuần/);
    assert.deepEqual(context.model.shap.map(item => item.feature), ['Work_Hours_Per_Week']);
    return { recommendations: [{ policyId: '1', evidenceIds: [evidence.id, 'SNAPSHOT:Work_Hours_Per_Week'],
      reason: 'Chấm công ghi nhận 300 phút tăng ca. HR có thể rà soát lịch giao việc.',
      hrVerification: 'Đối chiếu lịch ca với bảng chấm công.' }], noRecommendationReason: null };
  } };
  const analysis = new UnifiedAnalysis(service, repository, { agent, retriever, provider });
  const result = await analysis.run(1, 7, { snapshotId: 3, save: true, confirmExternalData: true });
  assert.deepEqual(calls, ['context', 'e5', 'e5', 'qwen', 'context', 'save']);
  assert.equal(result.predictionId, 8);
  assert.equal(result.policyAnalysis.recommendations[0].policy.code, 'P1');
});

test('one Qwen call can select the third E5 policy and resolve its original evidence', async t => {
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
      assert.deepEqual(payload.format.properties.recommendations.items.anyOf.map(({ properties }) => [
        properties.policyId.enum[0], properties.evidenceIds.items.enum[0]
      ]), [['1', 'SURVEY:1:1'], ['2', 'SURVEY:2:1'], ['3', 'SURVEY:3:1']]);
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

  output = { recommendations: [{ ...proposal, evidenceIds: [proposal.evidenceIds[0], proposal.evidenceIds[0]] }],
    noRecommendationReason: null };
  assert.deepEqual((await run()).recommendations[0].evidence, candidates[2].evidence);

  output = { recommendations: [], noRecommendationReason: 'Chưa đủ căn cứ.' };
  assert.deepEqual(await run(), output);
  output = { recommendations: [{ ...proposal, policyId: '2' }, proposal], noRecommendationReason: null };
  assert.deepEqual((await run()).recommendations.map(item => item.policyId), ['3']);
  output = { recommendations: [{ ...proposal, policyId: '99' }], noRecommendationReason: null };
  assert.deepEqual(await run(), {
    recommendations: [],
    noRecommendationReason: 'Chưa có đề xuất nào khớp với dẫn chứng của hồ sơ để HR xem xét.'
  });

  const warnings = t.mock.method(console, 'warn', () => {});
  output = { recommendations: [{ ...proposal, policyId: '99' },
    { ...proposal, reason: ' ', hrVerification: null }], noRecommendationReason: null };
  await assert.rejects(run(), { statusCode: 502 });
  assert.deepEqual(warnings.mock.calls[0].arguments[1], { recommendation: 1, issue: 'unknown_policy_id' });
  assert.deepEqual(warnings.mock.calls[1].arguments[1], {
    recommendation: 2, issues: ['reason_empty', 'hrVerification_not_string']
  });
});
