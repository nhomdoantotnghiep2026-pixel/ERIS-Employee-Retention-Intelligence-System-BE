const {FEATURES,valid,todayVN}=require('../helpers/ai-input.features');
const {AppError}=require('../../../common/errors/app-error');
const COLUMNS=['department','gender','age','hire_date','years_at_company','education_level','monthly_salary_usd','work_hours_per_week','overtime_hours','leave_days','promotions','employee_satisfaction_score'];
const INSERT_COLUMNS=[...COLUMNS,'monthly_salary_vnd','fx_vnd_per_usd','fx_rate_date'];
const nullableNumber=value=>value==null?null:Number(value);
function snapshotData(row,metadata=null){
 const features={},missingFeatures=[],invalidFeatures=[],outOfDomainFeatures=[];
 for(const [i,key] of FEATURES.entries()){
  const raw=row[COLUMNS[i]];
  if(raw===null||raw===undefined||raw===''){missingFeatures.push(key);continue;}
  const value=['Department','Gender','Education_Level','Hire_Date'].includes(key)?raw:Number(raw);
  features[key]=value;
  if(!valid(key,value)){
   if(key==='Employee_Satisfaction_Score'&&Number.isFinite(value)&&value>=0&&value<1)outOfDomainFeatures.push(key);
   else invalidFeatures.push(key);
  }
 }
 const capturedAt=new Date(row.snapshot_date).toISOString();
 return {snapshotId:row.id,employee:{id:row.employee_id,employeeCode:row.employeeCode,fullName:row.fullName},
  capturedAt,snapshotDate:todayVN(new Date(capturedAt)),features,missingFeatures,invalidFeatures,outOfDomainFeatures,
  ready:!missingFeatures.length&&!invalidFeatures.length,
  provenance:metadata?.provenance??Object.fromEntries(FEATURES.map((key,i)=>[key,'ai_input.'+COLUMNS[i]+'; chưa ghi nhận nguồn trước snapshot'])),
  period:metadata?.period??null,monthlySalaryVnd:nullableNumber(row.monthly_salary_vnd),
  vndPerUsd:nullableNumber(row.fx_vnd_per_usd??metadata?.vndPerUsd),
  fxRateDate:row.fx_rate_date??metadata?.exchangeRate?.rateDate??null,exchangeRate:metadata?.exchangeRate??null,
  dataSource:outOfDomainFeatures.length?'STORED_SNAPSHOT_OUT_OF_DOMAIN_DEMO':metadata?.dataSource??'STORED_SNAPSHOT',
  issues:outOfDomainFeatures.length?['Employee_Satisfaction_Score ngoài thang khảo sát 1–5; giữ nguyên giá trị snapshot để test model demo, không quy đổi.']:[]};
}
async function assertEmployee(client,employeeId,lock=false){
 const {rows}=await client.query(`SELECT e.id FROM employees e WHERE e.id=$1 AND e.employment_status='ACTIVE' ${lock?'FOR SHARE OF e':''}`,[employeeId]);
 if(!rows.length)throw new AppError(404,'Nhân viên không tồn tại hoặc hồ sơ chưa ACTIVE.');
}
module.exports={assertEmployee,snapshotData,INSERT_COLUMNS};
