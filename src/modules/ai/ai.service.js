const { AppError } = require('../../common/errors/app-error');
const { build,options,id,todayVN } = require('./ai.features');
const WARNING='Model demo chưa đạt tiêu chí đánh giá; không dùng để kết luận nhân viên sẽ nghỉ việc. Chưa có ngưỡng rủi ro hoặc thời hạn dự báo.';
class AiService {
  constructor({repository,client,clock=()=>new Date()}){Object.assign(this,{repository,client,clock});}
  async info(actorId){await this.repository.assertHr(actorId);return {...await this.client.info(),warning:WARNING};}
  async preview(actorId,employeeId,body={},allowSave=false) {
    await this.repository.assertHr(actorId);
    const now=this.clock(),today=todayVN(now),opts=options(body,allowSave,today);
    const row=await this.repository.read(id(employeeId),opts,today,now.toISOString());
    const preview={employee:{id:row.id,employeeCode:row.employeeCode,fullName:row.fullName},capturedAt:now.toISOString(),snapshotDate:today,...build(row,opts,today),warning:WARNING};
    if(preview.missingFeatures.length)return {...preview,snapshotCreated:false,snapshotId:null,ready:false};
    const snapshotId=await this.repository.createSnapshot(actorId,preview);
    return {...await this.repository.readSnapshot(actorId,preview.employee.id,snapshotId),snapshotCreated:true,warning:WARNING};
  }
  async predict(actorId,employeeId,body={}) {
    await this.repository.assertHr(actorId);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['snapshotId','save'].includes(key))||body.save!==undefined&&typeof body.save!=='boolean')throw new AppError(400,'Chạy model chỉ nhận snapshotId và save (boolean).');
    if(body.snapshotId===undefined)throw new AppError(400,'Chọn snapshotId từ ai_input trước khi chạy model.');
    const preview={...await this.repository.readSnapshot(actorId,id(employeeId),id(body.snapshotId)),warning:WARNING};
    if(!preview.ready){const error=new AppError(422,'Snapshot thiếu hoặc có feature không hợp lệ.');error.details=preview;throw error;}
    const model=await this.client.explain(preview.employee.id,preview.features,{allowOutOfRangeDemo:preview.outOfDomainFeatures.length>0});
    // Recheck authorization after a potentially slow network call, even for non-persistent requests.
    await this.repository.assertHr(actorId);
    const stored=body.save===true?await this.repository.save(actorId,preview,model):null;
    return {saved:!!stored,...stored,preview,model,warning:WARNING};
  }
  async batch(actorId,body) {
    await this.repository.assertHr(actorId);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='employees')||!Array.isArray(body.employees)||body.employees.length<1||body.employees.length>25) throw new AppError(400,'Gửi employees gồm 1–25 nhân viên.');
    const inputs=body.employees.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)) throw new AppError(400,'Mỗi nhân viên phải là object.');
      const {employeeId,...opts}=item;
      if(Object.keys(opts).some(key=>!['snapshotId','save'].includes(key))||opts.save!==undefined&&typeof opts.save!=='boolean')throw new AppError(400,'Mỗi nhân viên cần snapshotId và save tùy chọn.');
      return {employeeId:id(employeeId),opts:{snapshotId:id(opts.snapshotId),save:opts.save??false}};
    });
    if(new Set(inputs.map(x=>x.employeeId)).size!==inputs.length) throw new AppError(400,'employeeId trong cùng đợt không được trùng.');
    const results=new Array(inputs.length);let next=0;
    const worker=async()=>{while(next<inputs.length){const i=next++,input=inputs[i];try{results[i]={employeeId:input.employeeId,success:true,data:await this.predict(actorId,input.employeeId,input.opts)};}catch(error){results[i]={employeeId:input.employeeId,success:false,status:error instanceof AppError?error.statusCode:500,message:error instanceof AppError?error.message:'Không xử lý được nhân viên này.',...(error.details?{details:error.details}:{})};}}};
    await Promise.all([worker(),worker()]);
    return {total:results.length,succeeded:results.filter(r=>r.success).length,failed:results.filter(r=>!r.success).length,results,warning:WARNING};
  }
}
module.exports={AiService,WARNING};
