const record={type:'object',additionalProperties:false,required:['employee_id','leave_type_id','start_date','end_date'],properties:{employee_id:{type:'integer',minimum:1},leave_type_id:{type:'integer',minimum:1},start_date:{type:'string',format:'date'},end_date:{type:'string',format:'date'},reason:{type:'string',nullable:true}}};
const cancel={type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:1}}};
const operation=(summary,body,status='200')=>({tags:['Leave Records'],summary,security:[{bearerAuth:[]}],...(body?{requestBody:{required:true,content:{'application/json':{schema:body}}}}:{}),responses:{[status]:{description:'Success'},400:{description:'Invalid input'},401:{description:'Authentication required'},403:{description:'HR required or no linked employee'},409:{description:'Active leave or attendance conflict; response includes code and conflicts'},503:{description:'Configured leave_types schema is missing code'}}});
const id={name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}};
const withNotFound=op=>({...op,responses:{...op.responses,404:{description:'Leave Record not found'}}});
const filters=['employee_id','from','to','record_status','limit','offset'].map(name=>({name,in:'query',schema:{type:['employee_id','limit','offset'].includes(name)?'integer':'string'}}));
const historyFilters=[...filters.filter(f=>['employee_id','from','to','limit'].includes(f.name)),
 ...['cancelled_by','page'].map(name=>({name,in:'query',schema:{type:'integer',minimum:1}}))];
const upload=confirm=>({...operation(confirm?'Revalidate original file and save valid rows':'Preview Excel/CSV; leave_type is the catalogue code (LT001, LT002, ...), not its name'),requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:confirm?['file','fingerprint']:['file'],properties:{file:{type:'string',format:'binary'},...(confirm?{fingerprint:{type:'string',description:'SHA-256 returned by preview'}}:{})}}}}}});
const leaveRecordsPaths={
 '/api/leave-types':{get:operation('List leave types (HR and Employee)')},
 '/api/leave-records':{get:{...operation('List Leave Records (HR)'),parameters:filters},post:operation('Create whole-day Leave Record (HR)',record,'201')},
 '/api/leave-records/me':{get:{...operation('View only the authenticated employee’s leave history'),parameters:filters.filter(f=>f.name!=='employee_id')}},
 '/api/leave-records/summary':{get:{...operation('ACTIVE records only; clipped inclusive days, hours null without reliable schedule'),parameters:filters.slice(0,3)}},
 '/api/leave-records/{id}':{parameters:[id],get:operation('Get Leave Record (HR)')},
 '/api/leave-records/{id}/cancel':{parameters:[id],patch:withNotFound(operation('Soft cancel ACTIVE Leave Record with a reason (HR)',cancel))},
 '/api/leave-records/cancellations':{get:{...operation('List cancelled Leave Records (HR)'),parameters:historyFilters,
  description:'Date filters match overlapping leave dates. cancelled_at is derived from updated_at.'}},
 '/api/leave-records/cancellations/{id}':{parameters:[id],get:withNotFound(operation('Get cancelled Leave Record (HR)'))},
 '/api/leave-records/import/preview':{post:upload(false)},
 '/api/leave-records/import/confirm':{post:upload(true)}
};
module.exports={leaveRecordsPaths};
