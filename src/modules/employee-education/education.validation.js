const { AppError } = require('../../common/errors/app-error');
const levels = Object.freeze({1:'Cao đẳng',2:'Cử nhân',3:'Thạc sĩ',4:'Tiến sĩ'});
function validateId(value,name='id') {
  if(typeof value!=='string'||!/^[1-9]\d{0,9}$/.test(value)||Number(value)>2147483647)throw new AppError(400,name+' must be a positive integer.');
  return Number(value);
}
const currentYear=()=>Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric'}).format(new Date()));
function validateEducation(body,{partial=false}={}) {
  const fields=['educationLevel','fieldOfStudy','institution','graduationYear','institutionRefId'];
  if(!body||typeof body!=='object'||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(k=>!fields.includes(k)))throw new AppError(400,'Provide supported education fields only.');
  if(!partial&&!Object.hasOwn(body,'educationLevel'))throw new AppError(400,'educationLevel is required.');
  if(!partial || Object.hasOwn(body,'institution') || Object.hasOwn(body,'institutionRefId')){
    if(typeof body.institution!=='string'||!body.institution.trim())throw new AppError(400,'Select an institution from ROR or Vietmap suggestions.');
    if(typeof body.institutionRefId!=='string'||!(/^(?:https:\/\/ror\.org\/[a-z0-9]{9}|vietmap:(?:auto|geocode):[A-Za-z0-9_-]{1,512})$/.test(body.institutionRefId)))throw new AppError(400,'institutionRefId from ROR or Vietmap suggestions is required with institution.');
  }
  const result={};
  for(const field of fields){
    if(!Object.hasOwn(body,field)){if(!partial)result[field]=null;continue;}
    const value=body[field];
    if(field==='educationLevel'){
      if(!Number.isInteger(value)||!Object.hasOwn(levels,value))throw new AppError(400,'educationLevel must be 1 (Cao đẳng), 2 (Cử nhân), 3 (Thạc sĩ) or 4 (Tiến sĩ).');
      result[field]=value;
    }else if(value===null){result[field]=null;}
    else if(field==='graduationYear'){
      if(!Number.isInteger(value)||value<1900||value>currentYear())throw new AppError(400,'graduationYear must be an integer from 1900 to the current year.');
      result[field]=value;
    }else{
      if(typeof value!=='string'||!value.trim()||[...value.trim()].length>(field==='institutionRefId'?528:150)||/[\u0000-\u001f\u007f]/.test(value))throw new AppError(400,field+' must contain 1 to 150 characters without control characters.');
      result[field]=value.trim();
    }
  }
  return result;
}
function validateGraduationYear(data,dateOfBirth){
  if(data.graduationYear==null)return;
  if(!Number.isInteger(data.graduationYear)||data.graduationYear<1900||data.graduationYear>currentYear())throw new AppError(400,'Invalid graduationYear.');
  if(typeof dateOfBirth!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth))throw new AppError(409,'Employee must have a valid date of birth before recording graduationYear.');
  const parsed=new Date(dateOfBirth+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==dateOfBirth)throw new AppError(409,'Employee date of birth is invalid.');
  const earliestYear=Number(dateOfBirth.slice(0,4))+21;
  if(data.graduationYear<earliestYear)throw new AppError(400,'graduationYear must be at least '+earliestYear+' (minimum graduation age: 21 by year).');
}
function validateInstitutionQuery(query){
  if(Object.keys(query).some(k=>!['name','educationLevel'].includes(k)))throw new AppError(400,'Only name and educationLevel are allowed; institution search is global.');
  if(typeof query.name!=='string'||query.name.trim().length<2||query.name.trim().length>100||/[\u0000-\u001f\u007f]/.test(query.name))throw new AppError(400,'name must contain 2 to 100 characters.');
  if(!/[\p{L}\p{N}]/u.test(query.name))throw new AppError(400,'name must contain letters or digits.');
  if(query.educationLevel!==undefined&&(typeof query.educationLevel!=='string'||!(/^[1-4]$/.test(query.educationLevel))))throw new AppError(400,'educationLevel must be 1, 2, 3 or 4.');
  return{name:query.name.trim(),...(query.educationLevel===undefined?{}:{educationLevel:Number(query.educationLevel)})};
}
module.exports={validateId,validateEducation,validateGraduationYear,validateInstitutionQuery,levels};
