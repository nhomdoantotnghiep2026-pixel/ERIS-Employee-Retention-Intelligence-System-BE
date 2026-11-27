const fields = {
  Department: ['Phòng ban', ''],
  Hire_Date: ['Ngày vào làm', ''],
  Years_At_Company: ['Thâm niên', 'năm'],
  Education_Level: ['Bậc học trong hồ sơ', ''],
  Monthly_Salary: ['Lương tháng ghi trong hồ sơ', 'USD'],
  Work_Hours_Per_Week: ['Giờ làm bình quân', 'giờ/tuần'],
  Overtime_Hours: ['Tăng ca từ đầu năm', 'giờ'],
  Sick_Days: ['Ngày ghi nhận có nghỉ từ đầu năm', 'ngày'],
  Promotions: ['Số lần thăng chức', 'lần'],
  Employee_Satisfaction_Score: ['Điểm hài lòng bình quân', '/5']
};

function snapshotEvidence(snapshot) {
  const date = snapshot.snapshotDate;
  return Object.entries(fields).flatMap(([feature, [label, unit]]) => {
    if (snapshot.invalidFeatures?.includes(feature) || snapshot.outOfDomainFeatures?.includes(feature)) return [];
    const value = snapshot.features?.[feature];
    const textField = ['Department', 'Education_Level', 'Hire_Date'].includes(feature);
    if (textField ? typeof value !== 'string' || !value.trim() : !Number.isFinite(value) || value < 0) return [];
    if (feature === 'Employee_Satisfaction_Score' && (value < 1 || value > 5)) return [];
    const period = ['Work_Hours_Per_Week', 'Employee_Satisfaction_Score'].includes(feature)
      ? snapshot.period
      : ['Overtime_Hours', 'Sick_Days'].includes(feature) && date ? { start: date.slice(0, 4) + '-01-01', end: date } : date;
    // Legacy snapshots can lack a measurement period. Avoid assigning a different period.
    if (!period) return [];
    const hasVnd = feature === 'Monthly_Salary' && Number.isFinite(snapshot.monthlySalaryVnd);
    return [{
      id: 'SNAPSHOT:' + feature, source: 'MODEL', origin: 'SNAPSHOT', feature,
      value: hasVnd ? snapshot.monthlySalaryVnd : value, unit: hasVnd ? 'VND' : unit,
      label, period, provenance: hasVnd ? 'ai_input.monthly_salary_vnd' : snapshot.provenance?.[feature]
    }];
  });
}

module.exports = { snapshotEvidence };
