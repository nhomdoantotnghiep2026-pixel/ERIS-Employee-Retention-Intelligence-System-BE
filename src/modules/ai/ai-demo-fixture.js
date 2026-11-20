const {AppError}=require('../../common/errors/app-error');
const {todayVN,id}=require('../ai_input/ai-input.features');
const {assess}=require('./ai.assessment');
const {validateOutput}=require('../policy-agent/policy-agent');
function buildFixture(employee,now=new Date()){
 const end=new Date(todayVN(now)+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-364);
 const iso=d=>d.toISOString().slice(0,10),months=new Map();let ytdOvertime=0,ytdLeave=0,totalWorking=0;
 for(let i=0;i<365;i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);if([0,6].includes(d.getUTCDay()))continue;const day=iso(d),month=day.slice(0,7);if(!months.has(month))months.set(month,{id:'DEMO:ATTENDANCE:'+month,source:'ATTENDANCE',synthetic:true,month,recordedDays:0,statusCounts:{},workingMinutes:0,overtimeMinutes:0,lateMinutes:0,earlyMinutes:0});const m=months.get(month);m.recordedDays++;const leave=i%29===0,status=leave?'ON_LEAVE':i%17===0?'LATE':'PRESENT',ot=leave?0:i%4===0?(i>240?120:60):0,late=status==='LATE'?15:0;const working=leave?0:480-late+ot;m.statusCounts[status]=(m.statusCounts[status]??0)+1;m.workingMinutes+=working;m.overtimeMinutes+=ot;m.lateMinutes+=late;totalWorking+=working;if(d.getUTCFullYear()===end.getUTCFullYear()){ytdOvertime+=ot;if(leave)ytdLeave++;}}
 const questions=[['WORKING_TIME','Nhìn chung, bạn hài lòng với khối lượng và thời gian làm việc ở mức độ nào?'],['MANAGEMENT','Bạn hài lòng với sự hỗ trợ từ quản lý ở mức độ nào?'],['EMPLOYEE_ENGAGEMENT','Nhìn chung, bạn hài lòng với trải nghiệm làm việc tại công ty ở mức độ nào?']];
 const answers=[];for(let quarter=0;quarter<4;quarter++){const submitted=new Date(start);submitted.setUTCDate(submitted.getUTCDate()+Math.min(364,(quarter+1)*90));for(let q=0;q<3;q++)answers.push({id:'DEMO:SURVEY:'+quarter+':'+q,source:'SURVEY',synthetic:true,category:questions[q][0],question_text:questions[q][1],question_type:'RATING',answer_config:{min:1,max:5,positiveDirection:'HIGH'},answer_value:quarter<2?3:q===1?3:2,submitted_at:iso(submitted),comment:quarter>=2&&q===0?'Tôi mong được hỗ trợ phân bổ công việc vào giai đoạn cao điểm.':null});}
 const period={start:iso(start),end:iso(end)},features={Department:'IT',Gender:'Male',Age:30,Hire_Date:'2024-06-02',Years_At_Company:end.getUTCFullYear()-2024-(iso(end).slice(5)<'06-02'?1:0),Education_Level:'Master',Monthly_Salary:1200,Work_Hours_Per_Week:Number((totalWorking*7/60/365).toFixed(2)),Overtime_Hours:Number((ytdOvertime/60).toFixed(2)),Sick_Days:ytdLeave,Promotions:3,Employee_Satisfaction_Score:Number((answers.reduce((n,a)=>n+a.answer_value,0)/answers.length).toFixed(2))};
 return {synthetic:true,saved:false,snapshotId:null,employee,ready:true,capturedAt:now.toISOString(),period,features,missingFeatures:[],invalidFeatures:[],issues:[],dataSource:'SYNTHETIC_EMP013_ONE_YEAR',provenance:{Monthly_Salary:'Synthetic VND 30,000,000 / fixed demo exchange rate 25,000',Overtime_Hours:'Synthetic attendance YTD',Sick_Days:'Synthetic ON_LEAVE YTD; leave days, not a medical diagnosis'},evidence:[...months.values(),...answers],warning:'DỮ LIỆU GIẢ LẬP MỘT NĂM, không phản ánh hồ sơ thực tế EMP013. Chỉ test; không lưu database. Các feature hồ sơ/lương/thăng chức được giả lập; giờ làm và nghỉ phép tính từ bộ chấm công mẫu.'};
}
async function demoData(unified,actor,employeeId){
 await unified.repository.assertHr(actor);employeeId=id(employeeId);
 const employee=(await unified.repository.pool.query("SELECT id,employee_code AS \"employeeCode\",full_name AS \"fullName\" FROM employees WHERE id=$1 AND employee_code='EMP013' AND employment_status='ACTIVE'",[employeeId])).rows[0];
 if(!employee)throw new AppError(404,'Synthetic demo is available only for ACTIVE EMP013.');return buildFixture(employee);
}
async function runDemo(unified,actor,employeeId,body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='confirmExternalData')||body.confirmExternalData!==true)throw new AppError(400,'Demo requires confirmExternalData=true. Saving and custom features are not supported.');
 const preview=await demoData(unified,actor,employeeId);if(!unified.provider.configured())throw new AppError(503,'Configure Ollama first.');if(unified.busy.has(actor))throw new AppError(429,'An analysis is already running.');unified.busy.add(actor);
 try{const policies=(await unified.repository.pool.query("SELECT id::text,code,name,description FROM retention_policies WHERE status='ACTIVE' ORDER BY id LIMIT 101")).rows;if(!policies.length||policies.length>100)throw new AppError(409,'Demo requires 1–100 ACTIVE policies.');
 const {evidence,...snapshot}=preview;const model=assess(await unified.service.client.explain(preview.employee.id,preview.features));
 const context={synthetic:true,policies,evidence:[...evidence,...Object.entries(model.contributions).map(([feature,impact])=>({id:'DEMO:MODEL:'+feature,source:'MODEL',feature,value:preview.features[feature],impact,synthetic:true}))],selection:{employeeId:preview.employee.id,from:preview.period.start,to:preview.period.end},model:{enabled:true,syntheticInput:true,features:preview.features,period:preview.period,...model},quality:{note:preview.warning}};
 const result=validateOutput(await unified.provider.generate(context,{numCtx:8192,numPredict:1536}),context);await unified.repository.assertHr(actor);
 const current=(await unified.repository.pool.query("SELECT id::text,code,name,description FROM retention_policies WHERE status='ACTIVE' ORDER BY id LIMIT 101")).rows;if(JSON.stringify(current)!==JSON.stringify(policies))throw new AppError(409,'Policies changed; run demo again.');
 return {saved:false,synthetic:true,preview:snapshot,model,warning:preview.warning,policyAnalysis:{...result,provider:'OLLAMA',model:unified.provider.model,selection:context.selection,synthetic:true,requiresHrReview:true,autoApplied:false}};
 }finally{unified.busy.delete(actor);}
}
module.exports={buildFixture,demoData,runDemo};
