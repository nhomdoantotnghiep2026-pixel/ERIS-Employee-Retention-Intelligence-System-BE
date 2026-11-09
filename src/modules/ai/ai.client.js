const { AppError } = require('../../common/errors/app-error');
const { FEATURES, valid } = require('./ai.features');
const MODEL_ID='mexwell-rf12-demo-v1-20e0a090ced2';
const SCHEMA='mexwell-12-v1';
const STATUS='NO_QUALIFIED_MEXWELL_MODEL';
class AiClient {
  constructor({baseUrl='http://127.0.0.1:8000',serviceKey='',timeoutMs=15000,fetchImpl=fetch}={}) { Object.assign(this,{baseUrl,serviceKey,timeoutMs,fetchImpl}); }
  async request(path,body) {
    if(this.serviceKey.length<24) throw new AppError(503,'Chưa cấu hình AI_SERVICE_KEY (ít nhất 24 ký tự).');
    let response;
    try {
      response=await this.fetchImpl(new URL(path,this.baseUrl),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-ERIS-Service-Key':this.serviceKey},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(this.timeoutMs)});
    } catch(error) { throw new AppError(['TimeoutError','AbortError'].includes(error.name)?504:502,'Không kết nối được AI service hoặc đã quá thời gian chờ.'); }
    if(!response.ok) throw new AppError(response.status===503?503:502,response.status===503?'AI service chưa nạp model hoặc chưa sẵn sàng.':'AI service từ chối yêu cầu; kiểm tra key và hợp đồng dữ liệu.');
    try {return await response.json();} catch {throw new AppError(502,'AI service trả JSON không hợp lệ.');}
  }
  async info() {
    const result=await this.request('/v1/model-info');
    if(result.model_id!==MODEL_ID||result.schema_version!==SCHEMA||result.validation_status!==STATUS||result.demo_mode!==true) throw new AppError(502,'Model đang chạy không khớp phiên bản được tích hợp.');
    return result;
  }
  async explain(employeeId,features,{allowOutOfRangeDemo=false}={}) {
    if(FEATURES.some(k=>!valid(k,features[k])&&!(allowOutOfRangeDemo&&k==='Employee_Satisfaction_Score'&&typeof features[k]==='number'&&Number.isFinite(features[k])&&features[k]>=0&&features[k]<1))||Object.keys(features).length!==FEATURES.length) throw new AppError(422,'Đầu vào model chưa đủ hoặc không hợp lệ.');
    const r=await this.request('/v1/explain',{schema_version:SCHEMA,employee:{employee_id:String(employeeId),features}});
    const bad=()=>new AppError(502,'Kết quả AI không khớp nhân viên, model hoặc kiểm tra tổng SHAP.');
    if(!r||r.employee_id!==String(employeeId)||r.model_id!==MODEL_ID||r.schema_version!==SCHEMA||r.validation_status!==STATUS||r.demo_mode!==true||r.target!=='Resigned'||r.positive_class!==1||typeof r.score!=='number'||!Number.isFinite(r.score)||r.score<0||r.score>1||typeof r.base_value!=='number'||!Number.isFinite(r.base_value)||!r.contributions||Object.keys(r.contributions).length!==FEATURES.length||FEATURES.some(k=>typeof r.contributions[k]!=='number'||!Number.isFinite(r.contributions[k]))) throw bad();
    const reconstructed=r.base_value+FEATURES.reduce((sum,k)=>sum+r.contributions[k],0);
    if(Math.abs(reconstructed-r.score)>1e-8) throw bad();
    return {employee_id:r.employee_id,model_id:r.model_id,schema_version:SCHEMA,validation_status:STATUS,demo_mode:true,score:r.score,target:'Resigned',positive_class:1,base_value:r.base_value,contributions:r.contributions,additivity_error:Math.abs(reconstructed-r.score),shap_units:'probability (0-1); 0.01 = 1 percentage point',explainer:'TreeSHAP',forecastHorizon:null,riskLevel:null,predictionLabel:null};
  }
}
function aiConfig(env=process.env) {
  const baseUrl=env.AI_SERVICE_URL||'http://127.0.0.1:8000';
  const url=new URL(baseUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('AI_SERVICE_URL không hợp lệ.');
  const timeoutMs=Number(env.AI_SERVICE_TIMEOUT_MS||15000);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000) throw new Error('AI_SERVICE_TIMEOUT_MS phải từ 100 đến 120000.');
  return {baseUrl,timeoutMs,serviceKey:env.AI_SERVICE_KEY||''};
}
module.exports={AiClient,aiConfig,MODEL_ID,SCHEMA,STATUS};
