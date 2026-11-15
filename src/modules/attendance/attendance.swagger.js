const base='/api/v1/attendance';
const param=(name,type='string')=>({name,in:'path',required:true,schema:{type}});
const json=schema=>({required:true,content:{'application/json':{schema}}});
const object=properties=>({type:'object',additionalProperties:false,properties});
const reason={type:'string',minLength:1,maxLength:1000};
const version={type:'string',pattern:'^[1-9][0-9]*$',description:'Version returned by the latest Attendance response.'};
const datetime={type:'string',example:'2026-11-16 08:15:00',description:'Vietnam wall time: YYYY-MM-DD HH:mm:ss.'};
function op(summary,extra={}) {return {tags:['Attendance'],security:[{bearerAuth:[]}],summary,responses:{200:{description:'Success'},400:{description:'Invalid input'},401:{description:'Authentication required'},403:{description:'Insufficient permission'},409:{description:'Stale preview, unresolved rows, or concurrent update'}},...extra};}
const filters=[['from','string'],['to','string'],['employee_id','integer'],['record_status','string'],['limit','integer'],['offset','integer']].map(([name,type])=>({name,in:'query',schema:{type}}));
const attendancePaths={
  [base+'/import/preview']:{post:op('HR uploads .xlsx and previews calculated attendance without writing Attendance',{
    description:'Columns: employee_code, employee_name (optional), shift_type, check_in, check_out. Max 10 MiB / 10,000 rows. Excel dates and strict local datetime text are accepted. Missing data never creates ABSENT. Preview expires after 24 hours.',
    requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary'}}}}}}})},
  [base+'/import/history']:{get:op('HR views import history',{parameters:filters.slice(-2)})},
  [base+'/import/{batchId}']:{get:op('HR retrieves persisted Preview',{parameters:[param('batchId')]})},
  [base+'/import/{batchId}/rows/{excelRow}']:{patch:op('HR resolves shift ambiguity or excludes a row; recalculates Preview',{
    parameters:[param('batchId'),param('excelRow','integer')],requestBody:json(object({work_date:{type:'string',format:'date'},exclude:{type:'boolean'}}))})},
  [base+'/import/{batchId}/confirm']:{post:op('HR confirms import atomically with Attendance Audit',{
    description:'ERROR or unresolved rows must be resolved/excluded. NO_DATA and INCOMPLETE are excluded automatically. Identical duplicates skip. Changed duplicates skip unless selected in updates with a reason. CANCEL cannot be restored by import. Revalidates schedule/profile/attendance; stale Preview returns 409. Identical repeated Confirm returns its original result.',
    parameters:[param('batchId')],requestBody:json(object({duplicate_strategy:{type:'string',enum:['SKIP']},confirm_warnings:{type:'boolean'},updates:{type:'array',items:{...object({excel_row:{type:'integer'},action:{type:'string',enum:['UPDATE']},reason}),required:['excel_row','action','reason']}}}))})},
  [base+'/import/{batchId}/errors']:{get:op('HR downloads Preview issues as Excel',{parameters:[param('batchId')],responses:{200:{description:'Issue workbook',content:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{schema:{type:'string',format:'binary'}}}}}})},
  [base]:{get:op('HR lists attendance',{parameters:filters})},
  [base+'/me']:{get:op('Employee views own attendance',{parameters:filters.filter(f=>f.name!=='employee_id')})},
  [base+'/summary']:{get:op('Summary of ACTIVE attendance; employees are scoped to themselves',{parameters:filters,description:'Recorded days are actual rows, not inferred absences. Outside-shift time is separate from approved overtime, which defaults to zero.'})},
  [base+'/{id}']:{get:op('HR or owner reads attendance detail',{parameters:[param('id')]}),patch:op('HR edits timestamps using the saved schedule snapshot',{
    parameters:[param('id')],requestBody:json({...object({check_in:datetime,check_out:datetime,expected_version:version,reason}),required:['expected_version','reason']})})},
  [base+'/{id}/audit-logs']:{get:op('HR reads append-only CREATE / UPDATE / CANCEL / RESTORE Audit',{parameters:[param('id'),...filters.slice(-2)]})}
};
for(const action of ['cancel','restore'])attendancePaths[base+'/{id}/'+action]={patch:op(`HR ${action}s attendance with a reason`,{parameters:[param('id')],requestBody:json({...object({expected_version:version,reason}),required:['expected_version','reason']})})};
Object.assign(attendancePaths,require('./attendance-legacy.swagger').legacyAttendancePaths);
module.exports={attendancePaths};
