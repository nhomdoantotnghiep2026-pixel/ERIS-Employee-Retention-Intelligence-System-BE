const text=max=>({type:'string',minLength:1,maxLength:max});
const goal={type:'object',properties:{id:{type:'integer'},employeeId:{type:'integer'},careerAspiration:text(150),goalDescription:text(4000),goalChangeReason:{type:'string',nullable:true,maxLength:2000},status:{type:'string',enum:['ACTIVE','ACHIEVED','REPLACED','CANCELLED']},createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'}}};
const goals={type:'object',properties:{currentGoal:{...goal,nullable:true},history:{type:'array',items:goal}}};
function operation(summary,schema,status=200,properties,required=[]) {
  return {tags:['Career Profile'],summary,security:[{bearerAuth:[]}],responses:{[status]:{description:'Success',content:{'application/json':{schema}}},400:{description:'Invalid input'},401:{description:'Access token required'},403:{description:'Role or account status not allowed'},404:{description:'Employee or owned goal not found'},409:{description:'Goal not ACTIVE or another ACTIVE goal exists'}},...(properties?{requestBody:{required:required.length>0,content:{'application/json':{schema:{type:'object',additionalProperties:false,properties,required}}}}}:{})};
}
const id={in:'path',name:'id',required:true,schema:{type:'integer',minimum:1,maximum:2147483647}};
const careerProfilePaths={
  '/api/me/career-goals':{
    get:operation('EMPLOYEE: current goal and history; empty returns null and []',goals),
    post:operation('EMPLOYEE: create ACTIVE goal when none exists',goal,201,{careerAspiration:text(150),goalDescription:text(4000)},['careerAspiration','goalDescription'])
  },
  '/api/me/career-goals/{id}':{patch:{...operation('EMPLOYEE: edit ACTIVE goal description only',goal,200,{goalDescription:text(4000)},['goalDescription']),parameters:[id]}},
  '/api/me/career-goals/{id}/complete':{post:{...operation('EMPLOYEE: self-report achievement; no job title update',{type:'object',properties:{id:{type:'integer'},status:{type:'string',enum:['ACHIEVED']},message:{type:'string'}}},200,{}),parameters:[id]}},
  '/api/me/career-goals/{id}/replace':{post:{...operation('EMPLOYEE: atomically replace ACTIVE goal',{type:'object',properties:{previousGoal:goal,currentGoal:goal}},200,{newCareerAspiration:text(150),newGoalDescription:text(4000),goalChangeReason:text(2000)},['newCareerAspiration','newGoalDescription','goalChangeReason']),parameters:[id]}},
  '/api/me/career-goals/{id}/cancel':{post:{...operation('EMPLOYEE: cancel ACTIVE goal; optional reason',goal,200,{goalChangeReason:{type:'string',nullable:true,maxLength:2000}}),parameters:[id]}},
  '/api/employees/{employeeId}/career-goals':{get:{...operation('HR: employee current goal and history',{...goals,properties:{employee:{type:'object',properties:{id:{type:'integer'},employeeCode:{type:'string'},fullName:{type:'string'}}},...goals.properties}}),parameters:[{...id,name:'employeeId'}]}},
  '/api/hr/career-goals/alerts':{get:operation('HR: at least 3 replacements in rolling 7 days',{type:'object',properties:{items:{type:'array',items:{type:'object',properties:{employeeId:{type:'integer'},employeeCode:{type:'string'},replacementCount:{type:'integer',minimum:3},windowDays:{type:'integer',enum:[7]},latestReplacementAt:{type:'string',format:'date-time'}}}}}})}
};
module.exports={careerProfilePaths};
