const record={type:'object',additionalProperties:false,required:['employee_id','leave_type_id','start_date','end_date'],properties:{employee_id:{type:'integer',minimum:1},leave_type_id:{type:'integer',minimum:1},start_date:{type:'string',format:'date'},end_date:{type:'string',format:'date'},reason:{type:'string',nullable:true}}};
const patch={...record,required:[],properties:{...record.properties}};delete patch.properties.employee_id;
const operation=(summary,body,status='200')=>({tags:['Leave Records'],summary,security:[{bearerAuth:[]}],...(body?{requestBody:{required:true,content:{'application/json':{schema:body}}}}:{}),responses:{[status]:{description:'Success'},400:{description:'Invalid input'},401:{description:'Authentication required'},403:{description:'HR required or no linked employee'},409:{description:'Active leave or attendance conflict; response includes code and conflicts'},503:{description:'Configured leave_types schema is missing code'}}});
const id={name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}};
const filters=['employee_id','from','to','record_status','limit','offset'].map(name=>({name,in:'query',schema:{type:['employee_id','limit','offset'].includes(name)?'integer':'string'}}));
const upload=confirm=>({...operation(confirm?'Revalidate original file and save valid rows':'Preview Excel/CSV; leave_type is the catalogue code (LT001, LT002, ...), not its name'),requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:confirm?['file','fingerprint']:['file'],properties:{file:{type:'string',format:'binary'},...(confirm?{fingerprint:{type:'string',description:'SHA-256 returned by preview'}}:{})}}}}}});
const leaveRecordsPaths={
 '/api/leave-types':{get:operation('List leave types (HR and Employee)')},
 '/api/leave-records':{get:{...operation('List Leave Records (HR)'),parameters:filters},post:operation('Create whole-day Leave Record (HR)',record,'201')},
 '/api/leave-records/me':{get:{...operation('View only the authenticated employee’s leave history'),parameters:filters.filter(f=>f.name!=='employee_id')}},
 '/api/leave-records/summary':{get:{...operation('ACTIVE records only; clipped inclusive days, hours null without reliable schedule'),parameters:filters.slice(0,3)}},
 '/api/leave-records/{id}':{parameters:[id],get:operation('Get Leave Record (HR)'),patch:operation('Edit ACTIVE Leave Record (HR)',patch)},
 '/api/leave-records/{id}/cancel':{parameters:[id],patch:operation('Soft cancel Leave Record (HR)')},
 '/api/leave-records/{id}/restore':{parameters:[id],patch:operation('Restore after checking active leave and attendance (HR)')},
 '/api/leave-records/import/preview':{post:upload(false)},
 '/api/leave-records/import/confirm':{post:upload(true)}
};
module.exports={leaveRecordsPaths};
