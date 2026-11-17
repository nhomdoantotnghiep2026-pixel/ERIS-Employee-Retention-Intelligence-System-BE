const {AppError}=require('../../common/errors/app-error');
function positiveId(value,field='id') {
  if(typeof value!=='string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>2147483647) throw new AppError(400,`${field} must be a positive integer.`);
  return Number(value);
}
function validateBody(body,action) {
  const fields={create:{careerAspiration:150,goalDescription:4000},edit:{goalDescription:4000},replace:{newCareerAspiration:150,newGoalDescription:4000,goalChangeReason:2000},cancel:{goalChangeReason:2000},complete:{}}[action];
  if(body===undefined && ['cancel','complete'].includes(action)) body={};
  if(!fields || !body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!Object.hasOwn(fields,k))) throw new AppError(400,'Provide only fields allowed for this action.');
  const data={};
  for(const [key,max] of Object.entries(fields)) {
    const value=body[key];
    if(action==='cancel' && value==null) {data[key]=null;continue;}
    if(typeof value!=='string' || value.trim().length>max || (action!=='cancel' && !value.trim())) throw new AppError(400,`${key} must be a non-empty string of at most ${max} characters.`);
    data[key]=value.trim() || null;
  }
  return data;
}
module.exports={positiveId,validateBody};
