// Separate features kept compatible while Attendance itself becomes import-only.
const base='/api/v1/attendance';
const op=(summary,body,withId=false)=>({tags:['Leave and calendar'],summary,security:[{bearerAuth:[]}],
  ...(withId?{parameters:[{name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}}]}:{}),
  ...(body?{requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:body}}}}}:{}),
  responses:{200:{description:'Success'},400:{description:'Invalid input'},403:{description:'Insufficient permission'},409:{description:'Conflict'}}});
const str={type:'string'},day={type:'string',format:'date'};
const holiday={name:str,start_date:day,end_date:day};
const decision={decision:{type:'string',enum:['APPROVED','REJECTED']},reviewNote:str};
const legacyAttendancePaths={
  [base+'/company-location']:{get:op('HR reads company location'),put:op('HR updates company location',{address:str,latitude:{type:'number'},longitude:{type:'number'}})},
  [base+'/holidays']:{get:op('HR lists holidays'),post:op('HR creates a holiday; does not create import Attendance',holiday)},
  [base+'/holidays/{id}']:{put:op('HR updates a holiday',holiday,true),delete:op('HR deactivates a holiday',null,true)},
  [base+'/leave-requests']:{get:op('HR lists leave requests'),post:op('Employee submits leave request',{fromDate:day,toDate:day,reason:str})},
  [base+'/leave-requests/me']:{get:op('Employee lists own leave requests')},
  [base+'/leave-requests/{id}']:{patch:op('HR reviews leave request; Attendance is not materialized',decision,true)},
  [base+'/leave-requests/{id}/history']:{get:op('HR or owner reads leave history',null,true)},
  [base+'/leave-requests/{id}/cancellation']:{post:op('Employee requests leave cancellation',{reason:str},true),patch:op('HR reviews leave cancellation',decision,true)}
};
module.exports={legacyAttendancePaths};
