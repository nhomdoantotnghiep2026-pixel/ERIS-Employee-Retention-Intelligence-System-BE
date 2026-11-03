const {randomUUID}=require('node:crypto');
const {AppError}=require('../../common/errors/app-error');
const {build}=require('./ai-review.features');
const {MODEL_IDS}=require('./ai-review.client');
const SAMPLE=Object.freeze({Age:35,Department:'Research & Development',DistanceFromHome:5,Education:3,
  EnvironmentSatisfaction:3,JobLevel:2,JobSatisfaction:3,MonthlyIncome:5000,OverTime:'No',TotalWorkingYears:10,
  TrainingTimesLastYear:null,YearsAtCompany:5,YearsInCurrentRole:3,YearsSinceLastPromotion:1,YearsWithCurrManager:null});
// Fixed synthetic scenarios, not labelled evaluation cases or real employee records.
const SAMPLES=Object.freeze([
  SAMPLE,
  {...SAMPLE,Age:26,Department:'Sales',DistanceFromHome:22,Education:3,JobLevel:1,MonthlyIncome:1800,OverTime:'Yes',JobSatisfaction:1,EnvironmentSatisfaction:2,TotalWorkingYears:4,YearsAtCompany:2,YearsInCurrentRole:2,YearsSinceLastPromotion:2},
  {...SAMPLE,Age:45,Department:'Human Resources',DistanceFromHome:3,Education:4,JobLevel:4,MonthlyIncome:8500,JobSatisfaction:4,EnvironmentSatisfaction:4,TotalWorkingYears:22,YearsAtCompany:12,YearsInCurrentRole:4,YearsSinceLastPromotion:4},
  {...SAMPLE,Age:29,DistanceFromHome:28,JobLevel:2,MonthlyIncome:2800,OverTime:'Yes',JobSatisfaction:2,EnvironmentSatisfaction:1,TotalWorkingYears:7,YearsAtCompany:3,YearsInCurrentRole:2,YearsSinceLastPromotion:2},
  {...SAMPLE,Age:38,Department:'Sales',DistanceFromHome:10,Education:4,JobLevel:3,MonthlyIncome:6200,OverTime:'Yes',JobSatisfaction:3,EnvironmentSatisfaction:3,TotalWorkingYears:15,YearsAtCompany:8,YearsInCurrentRole:3,YearsSinceLastPromotion:3},
  {...SAMPLE,Age:24,Department:'Human Resources',DistanceFromHome:15,Education:2,JobLevel:1,MonthlyIncome:1600,TotalWorkingYears:2,YearsAtCompany:1,YearsInCurrentRole:1,YearsSinceLastPromotion:1},
  {...SAMPLE,Age:50,DistanceFromHome:8,Education:5,JobLevel:5,MonthlyIncome:15000,OverTime:'Yes',JobSatisfaction:4,EnvironmentSatisfaction:4,TotalWorkingYears:27,YearsAtCompany:18,YearsInCurrentRole:5,YearsSinceLastPromotion:5},
  {...SAMPLE,Age:32,Department:'Sales',DistanceFromHome:25,JobLevel:2,MonthlyIncome:3200,OverTime:'Yes',JobSatisfaction:1,EnvironmentSatisfaction:1,TotalWorkingYears:9,YearsAtCompany:6,YearsInCurrentRole:6,YearsSinceLastPromotion:6},
  {...SAMPLE,Age:41,Department:'Human Resources',DistanceFromHome:5,Education:4,JobLevel:3,MonthlyIncome:7000,JobSatisfaction:4,EnvironmentSatisfaction:3,TotalWorkingYears:18,YearsAtCompany:9,YearsInCurrentRole:2,YearsSinceLastPromotion:2},
  {...SAMPLE,Age:28,DistanceFromHome:12,JobLevel:2,MonthlyIncome:3400,OverTime:'Yes',JobSatisfaction:2,EnvironmentSatisfaction:2,TotalWorkingYears:6,YearsAtCompany:4,YearsInCurrentRole:1,YearsSinceLastPromotion:1}
].map(x=>Object.freeze(x)));
function localDay(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function period(today){const d=new Date(today+'T00:00:00Z');d.setUTCDate(1);const end=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()-1);return {startInclusive:d.toISOString().slice(0,10),endExclusive:end};}
class AiReviewService{
  constructor({repository,modelClient,exchangeRates,now=()=>new Date()}){Object.assign(this,{repository,modelClient,exchangeRates,now});}
  async authorize(userId){const actor=await this.repository.actor(userId);if(actor?.status!=='ACTIVE'||actor.role!=='HR')throw new AppError(403,'Chỉ HR ACTIVE được xem và chạy demo AI.');return actor;}
  async models(userId){await this.authorize(userId);return {data:await this.modelClient.models()};}
  async inputs(userId){
    const actor=await this.authorize(userId),instant=this.now(),today=localDay(instant);
    const rows=await this.repository.snapshots(today,instant.toISOString());
    let rate=null,fxError=null;try{rate=await this.exchangeRates.get();}catch{fxError='Không lấy được tỷ giá. Hãy thử tải lại.';}
    const employees=rows.map(row=>{
      const employee={id:row.id,employeeCode:row.employee_code,fullName:row.full_name,department:row.department};
      try{
        if(Number(actor.employeeId)===row.id)throw new Error('SELF_PREDICTION_FORBIDDEN');
        // Check non-FX eligibility first; never expose features based on an invented rate.
        const features=build(row,today,rate||{vndPerUsd:1});
        if(!rate)throw new Error('EXCHANGE_RATE_UNAVAILABLE');
        return {...employee,eligible:true,features,warnings:row.history?.length?[]:['NO_JOB_HISTORY_USING_HIRE_DATE']};
      }catch(error){return {...employee,eligible:false,reason:error.message};}
    });
    return {data:{snapshotAt:instant.toISOString(),snapshotDate:today,overtimePeriod:period(today),exchangeRate:rate,exchangeRateError:fxError,
      total:employees.length,eligibleCount:employees.filter(x=>x.eligible).length,employees}};
  }
  async infer(userId,{employeeId,modelId=MODEL_IDS[0],includeExplanation=true,sampleIndex=0},sample=false){
    await this.authorize(userId);if(!MODEL_IDS.includes(modelId))throw new AppError(400,'Model không được hỗ trợ.');
    let features,employee=null,snapshot;
    if(sample){if(!Number.isInteger(sampleIndex)||!SAMPLES[sampleIndex])throw new AppError(400,'sampleIndex phải từ 0 đến 9.');features={...SAMPLES[sampleIndex]};snapshot={snapshotAt:this.now().toISOString(),exchangeRate:null,overtimePeriod:null};}
    else{
      const {data}=await this.inputs(userId);employee=data.employees.find(x=>x.id===employeeId);
      if(!employee)throw new AppError(404,'Không tìm thấy nhân viên.');
      if(!employee.eligible)throw new AppError(422,'Nhân viên chưa đủ điều kiện: '+employee.reason);
      features=employee.features;snapshot=data;
    }
    const body={model_id:modelId,request_id:randomUUID(),reference_id:randomUUID(),features};
    const prediction=await this.modelClient.predict(body);
    let explanation=null,explanationError=null;
    if(includeExplanation){try{explanation=await this.modelClient.explain(body,prediction.estimatedProbability);}catch{explanationError='Dự đoán đã thành công; chưa lấy được giải thích. Có thể thử lại sau.';}}
    await this.authorize(userId);
    return {data:{synthetic:sample,sampleIndex:sample?sampleIndex:null,persisted:false,employee:employee?{id:employee.id,employeeCode:employee.employeeCode,fullName:employee.fullName}:null,
      snapshotAt:snapshot.snapshotAt,predictedAt:this.now().toISOString(),exchangeRate:snapshot.exchangeRate,overtimePeriod:snapshot.overtimePeriod,
      features,...prediction,explanation,explanationError,warning:'Kết quả nghiên cứu/demo; không phải kết luận nhân viên sẽ nghỉ việc. Chưa phân loại mức rủi ro hoặc xác nhận thời hạn dự báo.'}};
  }
  async batch(userId,{employeeIds,modelId=MODEL_IDS[0]},sample=false){
    await this.authorize(userId);if(!MODEL_IDS.includes(modelId))throw new AppError(400,'Model không được hỗ trợ.');
    let records,skipped=[],snapshotAt=this.now().toISOString(),exchangeRate=null,overtimePeriod=null;
    if(sample)records=SAMPLES.map((features,sampleIndex)=>({sampleIndex,features:{...features},employee:null}));
    else{
      const {data}=await this.inputs(userId);({snapshotAt,exchangeRate,overtimePeriod}=data);
      records=[];
      for(const id of employeeIds){const e=data.employees.find(x=>x.id===id);
        if(!e||!e.eligible){skipped.push({employeeId:id,reason:e?.reason||'EMPLOYEE_NOT_FOUND'});continue;}
        records.push({employee:{id:e.id,employeeCode:e.employeeCode,fullName:e.fullName},features:e.features});
      }
    }
    let results=[];
    if(records.length){
      const body={model_id:modelId,request_id:randomUUID(),items:records.map(r=>({reference_id:randomUUID(),features:r.features}))};
      const predictions=await this.modelClient.batch(body);
      results=records.map((record,i)=>({...record,synthetic:sample,persisted:false,snapshotAt,exchangeRate,overtimePeriod,predictedAt:this.now().toISOString(),
        ...predictions[i],explanation:null,explanationError:null,warning:'Kết quả demo. Chọn hồ sơ để chạy lại và lấy SHAP; nhân viên thật được đọc lại dữ liệu hiện tại.'}));
    }
    await this.authorize(userId);
    return {data:{synthetic:sample,persisted:false,modelId,snapshotAt,exchangeRate,overtimePeriod,
      requestedCount:sample?10:employeeIds.length,successCount:results.length,skippedCount:skipped.length,results,skipped}};
  }
}
module.exports={AiReviewService,SAMPLE,SAMPLES,localDay,period};
