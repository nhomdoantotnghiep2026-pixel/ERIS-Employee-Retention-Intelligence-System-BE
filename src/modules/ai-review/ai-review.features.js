const departments = new Set(['Human Resources','Research & Development','Sales']);
const dayMs = 86400000;
function date(s) {
  if (typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('INVALID_DATE');
  const d=new Date(s+'T00:00:00Z');
  if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s) throw new Error('INVALID_DATE');
  return d;
}
function anniversary(start,year) {
  return new Date(Date.UTC(year,start.getUTCMonth(),Math.min(start.getUTCDate(),new Date(Date.UTC(year,start.getUTCMonth()+1,0)).getUTCDate())));
}
function years(start,end) {
  const a=date(start),b=date(end); if(b<a) throw new Error('FUTURE_DATE');
  let y=b.getUTCFullYear()-a.getUTCFullYear();
  if(b<anniversary(a,a.getUTCFullYear()+y)) y--;
  return y;
}
function numeric(v,name) {
  if(v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0) throw new Error('MISSING_OR_INVALID_'+name);
  return Number(v);
}
function totalYears(intervals,today) {
  const cap=+date(today);
  const spans=intervals.map(([a,b])=>[+date(a),b?+date(b)+dayMs:cap]).map(([a,b])=>[a,Math.min(b,cap)]);
  if(spans.some(([a,b])=>a>b)) throw new Error('INVALID_EXPERIENCE_INTERVAL');
  spans.sort((a,b)=>a[0]-b[0]); const merged=[];
  for(const [a,b] of spans) {
    const last=merged.at(-1);
    if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);
  }
  let sum=0;
  for(const [a,b] of merged) {
    const start=new Date(a),end=new Date(b);
    const y=years(start.toISOString().slice(0,10),end.toISOString().slice(0,10));
    const marker=+anniversary(start,start.getUTCFullYear()+y);
    const next=+anniversary(start,start.getUTCFullYear()+y+1);
    sum+=y+(b-marker)/(next-marker);
  }
  return Math.floor(sum+1e-10);
}
function surveyScores(answers) {
  const score=(prefix)=>{
    const values=[1,2,3,4].map(n=>answers.filter(a=>a.dimension_code===prefix+'0'+n));
    if(values.some(v=>v.length!==1||!Number.isInteger(v[0].score)||v[0].score<1||v[0].score>4))throw new Error('MISSING_OR_INVALID_SURVEY_'+prefix);
    return Math.round(values.reduce((s,v)=>s+v[0].score,0)/4);
  };
  return {JobSatisfaction:score('JS'),EnvironmentSatisfaction:score('ES')};
}
function build(row,today,fx) {
  if(!Number.isFinite(fx?.vndPerUsd)||fx.vndPerUsd<=0)throw new Error('INVALID_EXCHANGE_RATE');
  if(!departments.has(row.department)) throw new Error('UNSUPPORTED_DEPARTMENT');
  if(row.employment_status!=='ACTIVE'||!row.active_account)throw new Error('INACTIVE_PROFILE_OR_ACCOUNT');
  if(row.catalog_status!=='ACTIVE'||row.position_status!=='ACTIVE')throw new Error('INACTIVE_DEPARTMENT_OR_POSITION');
  const history=row.history||[];
  const latest=history.at(-1);
  if(latest&&(Number(latest.position_id)!==row.position_id||Number(latest.department_id)!==row.department_id))throw new Error('HISTORY_PROFILE_MISMATCH');
  let roleStart=row.hire_date;
  for(let i=0;i<history.length;i++) {
    if(i===0||history[i].position_id!==history[i-1].position_id)roleStart=history[i].start_date;
  }
  const promotion=history.filter(h=>h.change_type==='PROMOTION').at(-1)?.start_date||row.hire_date;
  const levels=(row.educations||[]).map(x=>Number(x.education_level));
  if(!levels.length||levels.some(n=>!Number.isInteger(n)||n<1||n>4))throw new Error('MISSING_OR_INVALID_EDUCATION');
  if(!row.attendance.length)throw new Error('MISSING_PREVIOUS_MONTH_ATTENDANCE');
  if(row.attendance.some(a=>!a.check_out&&a.check_in))throw new Error('INCOMPLETE_PREVIOUS_MONTH_ATTENDANCE');
  let minutes=0;
  for(const a of row.attendance) minutes+=numeric(a.overtime_minutes,'OVERTIME');
  const income=numeric(row.current_salary,'SALARY'); if(income<=0)throw new Error('INVALID_SALARY');
  const job=numeric(row.job_level,'JOB_LEVEL');if(!Number.isInteger(job)||job<1||job>5)throw new Error('INVALID_JOB_LEVEL');
  const features={Age:years(row.date_of_birth,today),Department:row.department,
    DistanceFromHome:Math.round(numeric(row.distance_from_home_km,'DISTANCE')),Education:Math.max(...levels)+1,
    ...surveyScores(row.answers||[]),JobLevel:job,MonthlyIncome:Math.round(income/fx.vndPerUsd),
    OverTime:minutes>0?'Yes':'No',TotalWorkingYears:totalYears([[row.hire_date,null],...(row.experiences||[]).map(x=>[x.start_date,x.end_date])],today),
    TrainingTimesLastYear:null,YearsAtCompany:years(row.hire_date,today),YearsInCurrentRole:years(roleStart,today),
    YearsSinceLastPromotion:years(promotion,today),YearsWithCurrManager:null};
  for(const [k,v] of Object.entries(features))if(typeof v==='number'&&(!Number.isInteger(v)||v<0||v>2147483647))throw new Error('INVALID_'+k);
  return features;
}

module.exports={years,totalYears,surveyScores,build};
