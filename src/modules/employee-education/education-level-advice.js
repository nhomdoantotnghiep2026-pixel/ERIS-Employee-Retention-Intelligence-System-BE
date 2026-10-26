function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function assessEducationLevel(educationLevel, institution) {
  if (![1, 2, 3, 4].includes(educationLevel) || !institution) return { levelFit: 'UNKNOWN', levelWarning: null };
  const name = normalize(institution);
  const college = /\b(cao dang|college|polytechnic)\b/.test(name);
  const university = /\b(dai hoc|university|hoc vien|academy)\b/.test(name);
  if (college === university) return { levelFit: 'UNKNOWN', levelWarning: null };
  const matches = educationLevel === 1 ? college : university;
  return matches
    ? { levelFit: 'MATCH', levelWarning: null }
    : {
        levelFit: 'MISMATCH',
        levelWarning: 'Tên trường có thể không phù hợp với trình độ đã chọn. Vui lòng kiểm tra lại văn bằng trước khi lưu.'
      };
}

function prioritizeInstitutions(data, educationLevel) {
  if (!educationLevel) return data;
  const rank = { MATCH: 0, UNKNOWN: 1, MISMATCH: 2 };
  return data.map(school => ({ ...school, ...assessEducationLevel(educationLevel, school.institution) }))
    .sort((a, b) => rank[a.levelFit] - rank[b.levelFit]);
}

module.exports = { assessEducationLevel, prioritizeInstitutions };
