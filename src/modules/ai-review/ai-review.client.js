const {AppError}=require('../../common/errors/app-error');
const MODEL_IDS=Object.freeze(['rf-v3-final15-unweighted-b2','adaboost-v3-final15-baseline-sigmoid-s1']);
const HASHES=['0c72841a8505a910d31c2a687fbcbf5259e3afb60f9eddcb7586801519b5628f','af7dab8f6044c9a902789fd8b69aac16c4e187157508780c54cd1b39b1a491ca'];
const fail=()=>new AppError(502,'Service model trả dữ liệu không đúng contract.');
function metadata(m,id){
  if(!m||!MODEL_IDS.includes(m.model_id)||(id&&m.model_id!==id)||m.feature_schema_version!=='v3_final_15'
    ||m.model_sha256!==HASHES[MODEL_IDS.indexOf(m.model_id)])throw fail();
  return {modelId:m.model_id,modelSha256:m.model_sha256,featureSchemaVersion:m.feature_schema_version,decisionSupportOnly:true};
}
class AiReviewClient{
  constructor({baseUrl=process.env.AI_MODEL_BASE_URL||'http://127.0.0.1:8000',key=process.env.AI_MODEL_SERVICE_KEY||'',fetchImpl=fetch}={}){
    this.baseUrl=baseUrl.replace(/\/$/,'');this.key=key;this.fetch=fetchImpl;
  }
  async request(route,body){
    if(!this.key)throw new AppError(503,'Chưa cấu hình AI_MODEL_SERVICE_KEY cho backend.');
    let r;
    try{r=await this.fetch(this.baseUrl+route,{method:body?'POST':'GET',headers:{'X-ERIS-Service-Key':this.key,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(route==='/v1/explain'?65000:15000)});}
    catch{throw new AppError(503,'Không kết nối được service model hoặc đã quá thời gian chờ.');}
    if(!r.ok){
      if(r.status===429)throw new AppError(503,'Hàng đợi giải thích đang đầy. Hãy thử lại sau.');
      if(r.status===504)throw new AppError(504,'Model chưa giải thích xong trong thời gian cho phép.');
      if(r.status===422)throw new AppError(422,'Model từ chối bộ dữ liệu đầu vào hoặc model được chọn.');
      throw new AppError(503,'Service model chưa sẵn sàng hoặc cấu hình xác thực không khớp.');
    }
    try{return await r.json();}catch{throw fail();}
  }
  async models(){
    const r=await this.request('/v1/models');
    if(!Array.isArray(r.models))throw fail();
    const models=r.models.map(x=>({...metadata(x.metadata),ready:x.ready===true,supportsExplain:x.supports_explain===true}));
    if(models.length!==2||new Set(models.map(x=>x.modelId)).size!==2)throw fail();
    return {defaultModelId:MODEL_IDS[0],models};
  }
  async predict(body){
    const r=await this.request('/v1/predict',body),p=r.result;
    if(r.request_id!==body.request_id||p?.reference_id!==body.reference_id||!Number.isFinite(p.estimated_probability)
      ||p.estimated_probability<0||p.estimated_probability>1||!Array.isArray(p.imputed_features)
      ||p.imputed_features.some(k=>!['TrainingTimesLastYear','YearsWithCurrManager'].includes(k)))throw fail();
    return {requestId:r.request_id,estimatedProbability:p.estimated_probability,imputedFeatures:p.imputed_features,metadata:metadata(p.metadata,body.model_id)};
  }
  async batch(body){
    const r=await this.request('/v1/predict/batch',body);
    if(r.request_id!==body.request_id||!Array.isArray(r.results)||r.results.length!==body.items.length)throw fail();
    return r.results.map((p,i)=>{
      if(p.reference_id!==body.items[i].reference_id||!Number.isFinite(p.estimated_probability)||p.estimated_probability<0||p.estimated_probability>1
        ||!Array.isArray(p.imputed_features)||p.imputed_features.some(k=>!['TrainingTimesLastYear','YearsWithCurrManager'].includes(k)))throw fail();
      return {requestId:r.request_id,estimatedProbability:p.estimated_probability,imputedFeatures:p.imputed_features,metadata:metadata(p.metadata,body.model_id)};
    });
  }
  async explain(body,probability){
    const r=await this.request('/v1/explain',body); metadata(r.metadata,body.model_id);
    const names=Object.keys(body.features),contributions=r.contributions;
    if(r.request_id!==body.request_id||r.reference_id!==body.reference_id||r.explanation_space!=='probability'
      ||!Number.isFinite(r.estimated_probability)||Math.abs(r.estimated_probability-probability)>1e-8
      ||!Number.isFinite(r.base_value)||!Array.isArray(contributions)||contributions.length!==15
      ||new Set(contributions.map(x=>x.feature)).size!==15
      ||contributions.some(x=>!names.includes(x.feature)||!Number.isFinite(x.shap_value)
        ||x.direction!==(x.shap_value>0?'increase':x.shap_value<0?'decrease':'neutral'))
      ||Math.abs(r.base_value+contributions.reduce((sum,x)=>sum+x.shap_value,0)-probability)>1e-6)throw fail();
    const factors=contributions.map(x=>({feature:x.feature,value:body.features[x.feature],shapValue:x.shap_value,direction:x.direction}));
    return {baseValue:r.base_value,explanationSpace:'probability',contributions:factors,
      topFactors:[...factors].sort((a,b)=>Math.abs(b.shapValue)-Math.abs(a.shapValue)).slice(0,5),
      warning:'SHAP giải thích hành vi model, không chứng minh nguyên nhân nghỉ việc.'};
  }
}
class ExchangeRateClient{
  constructor({fetchImpl=fetch,now=()=>Date.now()}={}){this.fetch=fetchImpl;this.now=now;this.cached=null;this.pending=null;}
  async get(){
    if(this.cached&&this.now()<this.cached.expiresAt)return {...this.cached.rate};
    if(this.pending)return this.pending;
    this.pending=this.load();try{return await this.pending;}finally{this.pending=null;}
  }
  async load(){
    try{
      const r=await this.fetch('https://open.er-api.com/v6/latest/USD',{signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error();const data=await r.json();
      const age=this.now()/1000-data.time_last_update_unix;
      if(data.result!=='success'||data.base_code!=='USD'||!Number.isFinite(data.rates?.VND)||data.rates.VND<=0
        ||!Number.isFinite(age)||age>72*3600||age< -300)throw new Error();
      const rate={vndPerUsd:data.rates.VND,source:'https://www.exchangerate-api.com',
        updatedAt:new Date(data.time_last_update_unix*1000).toISOString(),retrievedAt:new Date(this.now()).toISOString()};
      this.cached={rate,expiresAt:Math.min(this.now()+3600000,(data.time_last_update_unix+72*3600)*1000)};
      return {...rate};
    }catch{throw new AppError(503,'Không lấy được tỷ giá VND/USD hợp lệ. Không dùng tỷ giá giả định.');}
  }
}
module.exports={AiReviewClient,ExchangeRateClient,MODEL_IDS};
