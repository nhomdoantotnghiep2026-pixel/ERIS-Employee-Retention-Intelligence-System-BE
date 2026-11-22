function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

function assessEducationLevel(educationLevel, institution) {
  if (educationLevel === 'Legacy College') return { levelFit: 'MISMATCH', levelWarning: 'Bản ghi Cao đẳng cũ cần HR xác nhận lại theo bốn trình độ mới.' };
  if (!['High School', 'Bachelor', 'Master', 'PhD'].includes(educationLevel) || !institution) return { levelFit: 'UNKNOWN', levelWarning: null };
  const name = normalize(institution);
  const school = /\b(trung hoc|thpt|high school|secondary school)\b/.test(name);
  const college = /\b(cao dang|college|polytechnic)\b/.test(name);
  const university = /\b(dai hoc|university|hoc vien|academy)\b/.test(name);
  if (Number(school)+Number(college)+Number(university)!==1) return { levelFit: 'UNKNOWN', levelWarning: null };
  const matches = educationLevel === 'High School' ? school : university;
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
