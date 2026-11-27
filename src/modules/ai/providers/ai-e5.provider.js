const { AppError } = require('../../../common/errors/app-error');

function evidenceText(item) {
  if (item.origin === 'SNAPSHOT') {
    const period = typeof item.period === 'string' ? item.period : `${item.period.start}–${item.period.end}`;
    return `${item.label}: ${item.value}${item.unit && (item.unit.startsWith('/') ? item.unit : ' ' + item.unit)} (${period}).`;
  }
  if (item.source === 'SURVEY') {
    const { min, max } = item.answer_config || {};
    const answer = item.answer_value;
    const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
    const freeText = item.question_type === 'TEXT' && typeof answer === 'string' ? answer.trim() : '';
    const score = Number.isFinite(answer) && Number.isFinite(min) && Number.isFinite(max) && answer >= min && answer <= max
      ? `Điểm: ${answer}/${max} (thang ${min}–${max})` : '';
    if (!score && !comment && !freeText) return '';
    return [item.question_text ? `Khảo sát: ${item.question_text}` : 'Khảo sát', score, freeText && `Trả lời: ${freeText}`,
      comment && comment !== freeText && `Nhận xét: ${comment}`].filter(Boolean).join('. ');
  }
  if (item.source === 'ATTENDANCE') {
    const metrics = [[item.overtimeMinutes, 'tăng ca'], [item.lateMinutes, 'đi trễ'], [item.earlyMinutes, 'về sớm'], [item.workingMinutes, 'làm việc']]
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
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname.toLowerCase());
      if (!base.username && !base.password && (base.protocol === 'https:' || loopback && base.protocol === 'http:')) {
        this.endpoint = new URL('/recommend', base);
        this.loopback = loopback;
      }
    } catch { /* Missing or invalid environment configuration. */ }
  }

  configured() {
    return Boolean(this.endpoint && (this.loopback || this.clientId?.trim() && this.clientSecret?.trim()));
  }

  async rank(context, { supplementary = false } = {}) {
    const ranked = await this.rankSignals(context);
    if (!supplementary || !ranked.recommendations.length) return ranked;
    const used = new Set(ranked.recommendations.map(item => item.evidence[0].id));
    const alternatives = context.evidence.filter(item => !used.has(item.id));
    if (!alternatives.some(evidenceText)) return ranked;
    try {
      const extra = await this.rankSignals({
        ...context, policies: ranked.recommendations.map(item => item.policy), evidence: alternatives
      }, 2500);
      const byPolicy = new Map(extra.recommendations.map(item => [item.policyId, item]));
      for (const item of ranked.recommendations) {
        const match = byPolicy.get(item.policyId);
        if (match && match.similarity > 0 && match.similarity >= item.similarity - 0.10) {
          item.evidence.push(...match.evidence);
        }
      }
    } catch (error) {
      console.warn('E5 supplemental evidence unavailable', { status: error.statusCode });
    }
    return ranked;
  }

  async rankSignals(context, timeoutMs = 8000) {
    const policies = new Map(context.policies.map(policy => [String(policy.id), policy]));
    const sources = new Map(context.evidence.map(item => [item.id, item]));
    const evidence = context.evidence.flatMap(item => {
      const observation = evidenceText(item);
      const impact = context.model?.contributions?.[item.feature];
      const score = context.model?.score;
      const background = [
        Number.isFinite(score) && `điểm dự đoán ${Number(score.toPrecision(3))}`,
        Number.isFinite(impact) && impact !== 0 && `SHAP ${Number(impact.toPrecision(3))}`
      ].filter(Boolean);
      const modelContext = item.origin === 'SNAPSHOT' && background.length ? ` [Bối cảnh: ${background.join(', ')}.]` : '';
      const text = observation ? (observation + modelContext).slice(0, 1000) : '';
      return text ? [{ evidenceId: item.id, text }] : [];
    });
    if (!evidence.length || !policies.size) {
      return { recommendations: [], noRecommendationReason: 'Chưa có dẫn chứng phù hợp để gợi ý chính sách.' };
    }
    if (!this.configured()) throw new AppError(503, 'E5 is not configured.');
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          ...(this.clientId?.trim() && this.clientSecret?.trim() ? {
            'CF-Access-Client-Id': this.clientId,
            'CF-Access-Client-Secret': this.clientSecret
          } : {})
        },
        body: JSON.stringify({ signals: evidence, eligiblePolicyIds: [...policies.keys()], topK: 3 })
      });
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      throw new AppError(timeout ? 504 : 502, timeout ? 'E5 timed out.' : 'E5 is unavailable. Check the SSH tunnel or VPS service.');
    }
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

module.exports = { E5Provider, evidenceText };
