const {ExchangeRateService}=require('./providers/ai-input.exchange-rate');
const {build,options,id,todayVN}=require('./helpers/ai-input.features');

class AiInputService {
  constructor({repository,clock=()=>new Date(),exchangeRates=new ExchangeRateService(),warning}){
    Object.assign(this,{repository,clock,exchangeRates,warning});
  }
  async exchangeRate(actorId){await this.repository.assertHr(actorId);return this.exchangeRates.latest();}
  async preview(actorId,employeeId,body={},allowSave=false) {
    await this.repository.assertHr(actorId);
    const now=this.clock(),today=todayVN(now),opts=options(body,allowSave,today);
    const row=await this.repository.read(id(employeeId),opts,today,now.toISOString());
    if(row.satisfaction!=null && opts.vndPerUsd===undefined && !Object.hasOwn(opts.supplementalFeatures,'Monthly_Salary') && row.current_salary!=null){
      opts.exchangeRate=await this.exchangeRates.latest();opts.vndPerUsd=opts.exchangeRate.vndPerUsd;
    }
    const preview={employee:{id:row.id,employeeCode:row.employeeCode,fullName:row.fullName},capturedAt:now.toISOString(),snapshotDate:today,...build(row,opts,today),warning:this.warning};
    if(preview.missingFeatures.length)return {...preview,snapshotCreated:false,snapshotId:null,ready:false};
    const snapshotId=await this.repository.createSnapshot(actorId,preview);
    return {...await this.repository.readSnapshot(actorId,preview.employee.id,snapshotId),snapshotCreated:true,warning:this.warning};
  }
}
module.exports={AiInputService};
