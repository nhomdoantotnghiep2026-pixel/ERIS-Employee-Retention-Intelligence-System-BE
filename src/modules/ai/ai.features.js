const { AppError } = require('../../common/errors/app-error');
const FEATURES = ['Department','Gender','Age','Hire_Date','Years_At_Company','Education_Level','Monthly_Salary','Work_Hours_Per_Week','Overtime_Hours','Sick_Days','Promotions','Employee_Satisfaction_Score'];
const DEPARTMENTS = ['Customer Support','Engineering','Finance','HR','IT','Legal','Marketing','Operations','Sales'];
const EDUCATIONS = ['High School','Bachelor','Master','PhD'];
const numeric = (v,min,max=Number.MAX_SAFE_INTEGER,integer=false) => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max && (!integer||Number.isInteger(v));
function iso(v) { return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v; }
const todayVN = (now=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function valid(k,v,today=todayVN()) {
  if(k==='Department') return DEPARTMENTS.includes(v);
  if(k==='Gender') return ['Male','Female','Other'].includes(v);
  if(k==='Education_Level') return EDUCATIONS.includes(v);
  if(k==='Hire_Date') return iso(v) && v<=today;
  if(k==='Age') return numeric(v,18,120,true);
  if(k==='Employee_Satisfaction_Score') return numeric(v,1,5);
  if(k==='Work_Hours_Per_Week') return numeric(v,0,168);
  if(k==='Years_At_Company') return numeric(v,0,102,true);
  return numeric(v,0,Number.MAX_SAFE_INTEGER,k==='Promotions');
}
function object(value) { return value!==null && typeof value==='object' && !Array.isArray(value); }
function options(body={},allowSave=false,today=todayVN()) {
  if(!object(body)) throw new AppError(400,'Body phải là JSON object.');
  const allowed=['periodStart','periodEnd','vndPerUsd','supplementalFeatures',...(allowSave?['save']:[])];
  if(Object.keys(body).some(k=>!allowed.includes(k))) throw new AppError(400,'Có trường không được hỗ trợ.');
  if((body.periodStart!==undefined)!==(body.periodEnd!==undefined)) throw new AppError(400,'Gửi đủ periodStart và periodEnd.');
  if(body.periodStart!==undefined && (!iso(body.periodStart)||!iso(body.periodEnd)||body.periodEnd<body.periodStart||body.periodEnd>today||(Date.parse(body.periodEnd)-Date.parse(body.periodStart))/86400000>365)) throw new AppError(400,'Kỳ attendance phải hợp lệ, tối đa 366 ngày và không ở tương lai.');
  if(body.vndPerUsd!==undefined && !numeric(body.vndPerUsd,1,1000000)) throw new AppError(400,'vndPerUsd phải là số VND cho 1 USD, từ 1 đến 1000000.');
  if(body.save!==undefined && typeof body.save!=='boolean') throw new AppError(400,'save phải là boolean.');
  const supplemental=body.supplementalFeatures??{};
  if(!object(supplemental)) throw new AppError(400,'supplementalFeatures phải là JSON object.');
  for(const [key,value] of Object.entries(supplemental)) {
    if(!FEATURES.includes(key)) throw new AppError(400,'Tên feature không hợp lệ: '+JSON.stringify(key)+'. Dùng dấu gạch dưới, ví dụ Monthly_Salary, Work_Hours_Per_Week.');
    if(!valid(key,value,today)) throw new AppError(400,'Giá trị không hợp lệ ở feature '+key+'. Kiểm tra kiểu số, khoảng giá trị và định dạng ngày.');
  }
  return {...body,supplementalFeatures:supplemental};
}
function id(value) { if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>2147483647) throw new AppError(400,'ID phải là số nguyên dương.'); return Number(value); }
function finite(value) { if(value===null||value===undefined||value==='') return null; const n=Number(value); return Number.isFinite(n)?n:null; }
function build(row,opts,today=todayVN()) {
  const features={},provenance={},issues=[];
  const add=(key,value,source)=>{if(valid(key,value,today)){features[key]=value;provenance[key]=source;}};
  add('Department',row.department,'departments.name');
  add('Gender',{MALE:'Male',FEMALE:'Female',OTHER:'Other',Male:'Male',Female:'Female',Other:'Other'}[row.gender],'employees.gender');
  const dob=row.date_of_birth;
  if(iso(dob)&&dob<=today) add('Age',Number(today.slice(0,4))-Number(dob.slice(0,4))-(today.slice(5)<dob.slice(5)?1:0),'employees.date_of_birth; tuổi tròn tại snapshot');
  add('Hire_Date',row.hire_date,'employees.hire_date');
  if(iso(row.hire_date)&&row.hire_date<=today) add('Years_At_Company',Number(today.slice(0,4))-Number(row.hire_date.slice(0,4))-(today.slice(5)<row.hire_date.slice(5)?1:0),'employees.hire_date; completed years at snapshot');
  add('Education_Level',row.education_level,'employee_educations ACTIVE; bằng cao nhất');
  const salary=finite(row.current_salary);
  if(salary!==null&&opts.vndPerUsd) add('Monthly_Salary',Number((salary/opts.vndPerUsd).toFixed(4)),'employees.current_salary VND / vndPerUsd do HR nhập');
  add('Promotions',finite(row.promotions),'employee_job_histories PROMOTION đến snapshot');
  add('Employee_Satisfaction_Score',finite(row.satisfaction)===null?null:Number(Number(row.satisfaction).toFixed(2)),'Latest submitted survey; mean rounded to 2 decimals');
  add('Work_Hours_Per_Week',finite(row.scheduled_weekly_hours),'Current ACTIVE schedule: weekly hours excluding breaks and overtime');
  if(Number(row.ytd_incomplete_days)===0) {
    const overtime=finite(row.ytd_overtime_minutes);
    if(overtime!==null) add('Overtime_Hours',Number((overtime/60).toFixed(2)),'Completed attendance overtime; January 1 through snapshot');
  } else if(row.ytd_incomplete_days!==undefined) issues.push('Year-to-date attendance has unfinished checkouts; overtime is not ready.');
  add('Sick_Days',finite(row.absence_days),'Year-to-date scheduled ON_LEAVE + ABSENT dates; excludes holidays and business travel; broader than dataset sick days');
  for(const [key,value] of Object.entries(opts.supplementalFeatures)) {
    if(Object.hasOwn(features,key)) throw new AppError(400,`Không ghi đè ${key} đã lấy từ database.`);
    features[key]=value;provenance[key]='MANUAL_DEMO: HR bổ sung, không cập nhật hồ sơ gốc';
  }
  if(features.Hire_Date&&iso(dob)&&features.Hire_Date<dob) throw new AppError(422,'Ngày vào làm không thể trước ngày sinh.');
  if(features.Age!==undefined&&features.Years_At_Company!==undefined&&features.Years_At_Company>features.Age) throw new AppError(422,'Thâm niên không thể lớn hơn tuổi.');
  return {features,provenance,missingFeatures:FEATURES.filter(k=>!Object.hasOwn(features,k)),issues,
    period:opts.periodStart?{start:opts.periodStart,end:opts.periodEnd}:null,
    vndPerUsd:opts.vndPerUsd??null,dataSource:Object.values(provenance).some(v=>v.startsWith('MANUAL_DEMO'))?'MIXED_DEMO':'DATABASE'};
}
module.exports={FEATURES,DEPARTMENTS,EDUCATIONS,valid,iso,todayVN,options,id,build};
