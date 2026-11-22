const {AppError}=require('../../../common/errors/app-error');
const POLICY_LIMITS=Object.freeze({code:100,name:150,description:10000});
function text(value,field,max,multiline=false){
 if(typeof value!=='string')throw new AppError(400,`${field} phải là chuỗi ký tự.`);
 const result=value.normalize('NFC').trim();
 if(!result||Array.from(result).length>max|| (multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(result))
  throw new AppError(400,`${field} phải có 1–${max} ký tự, không chứa ký tự điều khiển không hợp lệ.`);
 return result;
}
function validatePolicyCreate(body){
 const keys=['code','name','description','status'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))
  throw new AppError(400,'Chỉ nhận code, name, description và status.');
 const code=text(body.code,'code',POLICY_LIMITS.code).toUpperCase();
 if(code.length>POLICY_LIMITS.code||!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))throw new AppError(400,'code chỉ gồm chữ Latin, số, gạch ngang hoặc gạch dưới; bắt đầu bằng chữ hoặc số.');
 const name=text(body.name,'name',POLICY_LIMITS.name),description=text(body.description,'description',POLICY_LIMITS.description,true);
 const status=body.status===undefined?'ACTIVE':body.status;
 if(!['ACTIVE','INACTIVE'].includes(status))throw new AppError(400,'status chỉ nhận ACTIVE hoặc INACTIVE.');
 return {code,name,description,status};
}
module.exports={validatePolicyCreate,POLICY_LIMITS};
