const { AppError } = require('../../common/errors/app-error');
function fail(code,message,status=400,conflicts) {const e=new AppError(status,message);Object.assign(e,{code,conflicts});throw e;}
function id(v) {if(!/^[1-9]\d*$/.test(String(v))||Number(v)>2147483647)fail('VALIDATION_ERROR','Invalid identifier.');return Number(v);}
function date(v) {if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01')fail('VALIDATION_ERROR','Expected YYYY-MM-DD (1900 or later).');const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)fail('VALIDATION_ERROR','Invalid calendar date.');return v;}
function input(body,partial=false) {
 const allowed=['leave_type_id','start_date','end_date','reason',...(!partial?['employee_id']:[])];
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(k=>!allowed.includes(k)))fail('VALIDATION_ERROR','Unsupported fields. Only whole work dates are supported.');
 const out={};for(const k of allowed){if(body[k]===undefined){if(!partial&&k!=='reason')fail('VALIDATION_ERROR',k+' is required.');continue;}
 if(k==='reason'){if(body[k]!==null&&typeof body[k]!=='string')fail('VALIDATION_ERROR','reason must be text or null.');out[k]=body[k]===null?null:body[k].trim()||null;}else out[k]=k.endsWith('_id')?id(body[k]):date(body[k]);}
 if(out.start_date&&out.end_date&&out.end_date<out.start_date)fail('VALIDATION_ERROR','end_date must be on or after start_date.');return out;
}
module.exports={fail,id,date,input};
