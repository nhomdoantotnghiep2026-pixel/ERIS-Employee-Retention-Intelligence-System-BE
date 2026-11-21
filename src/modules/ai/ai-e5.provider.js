const { AppError } = require('../../common/errors/app-error');

function evidenceText(item) {
  if (item.source === 'SURVEY') {
    const { min, max, positiveDirection } = item.answer_config || {};
    const answer = item.answer_value;
    const unfavorable = typeof answer === 'number' && Number.isFinite(min) && Number.isFinite(max) &&
      (positiveDirection === 'HIGH' && answer < (min + max) / 2 ||
       positiveDirection === 'LOW' && answer > (min + max) / 2);
    const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
    const freeText = item.question_type === 'TEXT' && typeof answer === 'string' ? answer.trim() : '';
    if (!unfavorable && !comment && !freeText) return '';
    return [`Khảo sát: ${item.question_text}`, unfavorable && `Điểm: ${answer}/${max} (thang ${min}–${max})`, comment || freeText].filter(Boolean).join('. ');
  }
  if (item.source === 'ATTENDANCE') {
    const metrics = [[item.overtimeMinutes, 'tăng ca'], [item.lateMinutes, 'đi trễ'], [item.earlyMinutes, 'về sớm']]
      .filter(([minutes]) => Number.isFinite(minutes) && minutes > 0);
    if (metrics.length) return `Chấm công tháng ${item.month}: ${metrics.map(([minutes, name]) => `${name} ${minutes} phút`).join(', ')} trong ${item.recordedDays} ngày có ghi nhận.`;
  }
  return '';
}

class E5Provider {
  name = 'E5';
  model = 'multilingual-e5-small';

  constructor({ url = process.env.E5_BASE_URL, clientId = process.env.CF_ACCESS_CLIENT_ID,
    clientSecret = process.env.CF_ACCESS_CLIENT_SECRET, fetchImpl = fetch } = {}) {
    Object.assign(this, { clientId, clientSecret, fetchImpl });
    try {
      const base = new URL(url);
      if (base.protocol === 'https:' && !base.username && !base.password) this.endpoint = new URL('/recommend', base);
    } catch { /* Missing or invalid environment configuration. */ }
  }

  configured() {
    return Boolean(this.endpoint && this.clientId?.trim() && this.clientSecret?.trim());
  }

  async rank(context) {
    const policies = new Map(context.policies.map(policy => [String(policy.id), policy]));
    const sources = new Map(context.evidence.map(item => [item.id, item]));
    const evidence = context.evidence.flatMap(item => {
      const text = evidenceText(item).slice(0, 1000);
      return text ? [{ evidenceId: item.id, text }] : [];
    });
    if (!evidence.length || !policies.size) {
      return { recommendations: [], noRecommendationReason: 'Chưa có tín hiệu khảo sát hoặc chấm công phù hợp để gợi ý chính sách.' };
    }
    if (!this.configured()) throw new AppError(503, 'E5 is not configured.');
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': this.clientId,
        'CF-Access-Client-Secret': this.clientSecret
      },
      body: JSON.stringify({ signals: evidence, eligiblePolicyIds: [...policies.keys()], topK: 3 })
    });
    if (!response.ok) throw new AppError(502, 'E5 rejected the recommendation request.');
    const body = await response.json();
    const rows = body?.candidates;
    if (!Array.isArray(rows) || rows.length > 3) throw new AppError(502, 'Invalid E5 response.');
    const byId = new Map(evidence.map(item => [item.evidenceId, item.text]));
    const seen = new Set();
    const recommendations = rows.map(row => {
      const policyId = String(row?.policyId);
      const text = byId.get(row?.evidenceId);
      const policy = policies.get(policyId);
      if (!policy || !text || seen.has(policyId) || row.evidenceText !== text || row.policyName !== policy.name ||
          !Number.isFinite(row.similarity) || Math.abs(row.similarity) > 1) {
        throw new AppError(502, 'E5 returned invalid policy or evidence.');
      }
      seen.add(policyId);
      return { policy, policyId, policyName: row.policyName, reason: text, evidenceText: row.evidenceText,
        evidence: [sources.get(row.evidenceId)], similarity: row.similarity };
    });
    return { recommendations, noRecommendationReason: recommendations.length ? null : 'E5 không trả về chính sách phù hợp.' };
  }
}

module.exports = { E5Provider };
