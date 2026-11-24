const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compactOllamaContext}=require('../src/modules/ai/helpers/ollama-context');

test('compaction preserves full evidence, scales, periods, policies and meaningful model output',()=>{
 const context={
  model:{enabled:true,snapshotId:18,employee_id:'31',model_id:'test-model',schema_version:'v1',positive_class:1,additivity_error:0,explainer:'TreeSHAP',startedAt:'start',completedAt:'end',
   capturedAt:'2026-11-21T15:06:11Z',period:{start:'2025-11-22',end:'2026-11-21'},score:0.11,base_value:0.10,
   assessment:{label:'Cần HR xem xét',explanation:'Không phải tỷ lệ chắc chắn nghỉ việc'},demo_mode:true,validation_status:'DEMO',
   forecastHorizon:null,features:{Overtime_Hours:47.5},contributions:{Overtime_Hours:0.006}},
  evidencePeriod:{start:'2026-01-01',end:'2026-11-21'},
  policies:[{id:'49',code:'P14',name:'Làm rõ mục tiêu',description:'Trao đổi về thứ tự ưu tiên.'}],
  retrieval:{provider:'E5',model:'embedding-model',candidatePolicyIds:['49'],noRecommendationReason:null,candidates:[{policyId:'49',similarity:0.89,evidenceIds:['SURVEY:69:270']}]},
  evidence:[
   {id:'SURVEY:69:270',source:'SURVEY',response_id:69,question_id:270,survey_id:21,submitted_at:'2026-04-04T08:00:00Z',category:'MANAGEMENT',question_text:'Bạn cần hỗ trợ gì?',question_type:'RATING',answer_config:{min:1,max:5,positiveDirection:'HIGH'},answer_value:2,comment:'Tôi cần làm rõ việc ưu tiên.'},
   {id:'ATTENDANCE_MONTH:2026-04',source:'ATTENDANCE',month:'2026-04',recordedDays:20,workingMinutes:9600,overtimeMinutes:600,lateMinutes:30,earlyMinutes:0,statusCounts:{PRESENT:19,ON_LEAVE:1},missingMetricCounts:{working_minutes:1}},
   {id:'MODEL:Overtime_Hours',source:'MODEL',feature:'Overtime_Hours',value:47.5,impact:0.006}
  ]
 };
 const original=structuredClone(context),result=compactOllamaContext(context);
 assert.deepEqual(context,original);
 for(const key of ['snapshotId','employee_id','model_id','schema_version','positive_class','additivity_error','explainer','startedAt','completedAt'])assert(!Object.hasOwn(result.model,key));
 for(const [key,value]of Object.entries(original.model))if(!['snapshotId','employee_id','model_id','schema_version','positive_class','additivity_error','explainer','startedAt','completedAt'].includes(key))assert.deepEqual(result.model[key],value);
 assert.deepEqual(result.policies,original.policies);assert.deepEqual(result.evidencePeriod,original.evidencePeriod);
 assert.deepEqual(result.retrieval.candidates,original.retrieval.candidates);
 assert.equal(result.evidence.length,original.evidence.length);
 const survey={...original.evidence[0]};delete survey.response_id;delete survey.question_id;
 assert.deepEqual(result.evidence[0],survey);
 assert.deepEqual(result.evidence.slice(1),original.evidence.slice(1));
 assert(Buffer.byteLength(JSON.stringify(result))<Buffer.byteLength(JSON.stringify(original)));
});
