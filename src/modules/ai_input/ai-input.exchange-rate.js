const {AppError}=require('../../common/errors/app-error');
const {iso,todayVN}=require('./ai-input.features');
const URL='https://api.frankfurter.dev/v2/rate/USD/VND';
class ExchangeRateService {
 constructor({fetchImpl=fetch,clock=()=>new Date(),cacheMs=60000,timeoutMs=5000}={}) {
  Object.assign(this,{fetchImpl,clock,cacheMs,timeoutMs});this.cache=null;this.pending=null;
 }
 fresh(value,now){return iso(value?.rateDate)&&value.rateDate<=todayVN(now)&&(Date.parse(todayVN(now))-Date.parse(value.rateDate))/86400000<=7;}
 async latest(){
  const now=this.clock();
  if(this.cache&&now.getTime()-this.cache.time>=0&&now.getTime()-this.cache.time<this.cacheMs&&this.fresh(this.cache.value,now))return {...this.cache.value,cached:true};
  if(this.pending)return this.pending;
  this.pending=this.fetchLatest();
  try{return await this.pending;}finally{this.pending=null;}
 }
 async fetchLatest(){
  const fail=()=>new AppError(503,'Không lấy được tỷ giá USD/VND mới nhất. Thử lại sau hoặc nhập vndPerUsd đã xác minh; hệ thống không tự dùng tỷ giá cũ.');
  let response,data;
  try{response=await this.fetchImpl(URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs)});if(!response.ok)throw fail();data=await response.json();}catch{throw fail();}
  const now=this.clock();
  if(data?.base!=='USD'||data.quote!=='VND'||typeof data.rate!=='number'||!Number.isFinite(data.rate)||data.rate<1||data.rate>1000000||!this.fresh({rateDate:data.date},now))throw fail();
  const value={base:'USD',quote:'VND',rate:data.rate,vndPerUsd:data.rate,rateDate:data.date,fetchedAt:now.toISOString(),source:'Frankfurter',sourceUrl:URL,rateType:'REFERENCE',cached:false};
  this.cache={time:now.getTime(),value};return {...value};
 }
}
module.exports={ExchangeRateService};
