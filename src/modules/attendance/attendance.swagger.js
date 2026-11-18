const base='/api/v1/attendance';
const param=(name,type='string')=>({name,in:'path',required:true,schema:{type}});
const json=schema=>({required:true,content:{'application/json':{schema}}});
const object=properties=>({type:'object',additionalProperties:false,properties});
const reason={type:'string',minLength:1,maxLength:1000};
const fingerprint={type:'string',pattern:'^[a-f0-9]{64}$',description:'record_fingerprint from the latest GET attendance detail.'};
const datetime={type:'string',example:'2026-11-16 08:15:00',description:'Vietnam wall time: YYYY-MM-DD HH:mm:ss.'};
function op(summary,extra={}) {return {tags:['Attendance'],security:[{bearerAuth:[]}],summary,responses:{200:{description:'Success'},400:{description:'Invalid input'},401:{description:'Authentication required'},403:{description:'Insufficient permission'},409:{description:'Stale preview, unresolved rows, or concurrent update'}},...extra};}
const filters=[['from','string'],['to','string'],['employee_id','integer'],['record_status','string'],['limit','integer'],['offset','integer']].map(([name,type])=>({name,in:'query',schema:{type}}));
function uploadRequest(confirm){return {required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file',...(confirm?['options']:[])],properties:{file:{type:'string',format:'binary'},options:{type:'string',description:'JSON object: '+(confirm?'preview_token, confirm_warnings, choices':'choices')+'. choices=[{excel_row,work_date?,exclude?}].'}}}}}};}
const attendancePaths={
  [base+'/import/preview']:{post:op('HR xem trước file, không lưu batch hoặc Attendance',{
    description:'File XLSX tối đa 10 MiB / 10000 dòng. Trả rows và preview_token có chữ ký, hạn 30 phút. Không lưu file, preview hay lịch sử import. Khi loại dòng/chọn ngày ca, gửi lại file cùng options.choices để xem trước lại.',
    requestBody:uploadRequest(false)})},
  [base+'/import/confirm']:{post:op('HR gửi lại file để xác nhận và lưu Attendance',{
    description:'Gửi cùng file và options.preview_token, choices giống lần xem trước cuối. Kiểm tra lại toàn bộ dữ liệu; thay đổi file/nhân viên/lịch/ngày lễ/nghỉ phép/attendance thì trả 409. ERROR phải xử lý hoặc loại, cảnh báo cần confirm_warnings=true. Trùng hệt bỏ qua; bản ghi khác phải hủy trước khi import lại. Không lưu batch hay metadata upload. Gửi lại confirm sau khi đã lưu có thể trả STALE_PREVIEW; xem danh sách rồi preview lại.',requestBody:uploadRequest(true)})},
  [base+'/import/errors']:{post:op('HR gửi file để tải danh sách lỗi Excel, không lưu preview',{requestBody:uploadRequest(false),responses:{200:{description:'Issue workbook',content:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{schema:{type:'string',format:'binary'}}}}}})},
  [base]:{get:op('HR lists attendance',{parameters:filters})},
  [base+'/me']:{get:op('Employee views own attendance',{parameters:filters.filter(f=>f.name!=='employee_id')})},
  [base+'/summary']:{get:op('Summary of ACTIVE attendance; employees are scoped to themselves',{parameters:filters,description:'Recorded days are actual rows, not inferred absences. Overtime is measured after assigned shift end, excluding break overlap; early arrival is not overtime.'})},
  [base+'/{id}']:{get:op('HR or owner reads attendance detail',{parameters:[param('id')]})},
  [base+'/{id}/audit-logs']:{get:op('HR reads append-only CREATE / CANCEL Audit',{parameters:[param('id'),...filters.slice(-2)]})}
};
for(const action of ['cancel'])attendancePaths[base+'/{id}/'+action]={patch:op(`HR ${action}s attendance with a reason`,{parameters:[param('id')],requestBody:json({...object({expected_fingerprint:fingerprint,reason}),required:['expected_fingerprint','reason']})})};
const scope={...object({from:{type:'string',format:'date'},to:{type:'string',format:'date'},employee_ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'integer'}}}),required:['from','to','employee_ids']};
for(const action of ['preview','confirm'])attendancePaths[base+'/reconcile/'+action]={post:op('HR '+action+'s HOLIDAY / ON_LEAVE rows for selected employees and dates',{
 description:'At most 366 days and 10000 employee-days. Completed assigned workdays only, on/after hire. HOLIDAY before ON_LEAVE. Existing work preserved with warnings. Missing punches never infer ABSENT. Preview is signed, HR-bound, expires in 30 minutes; confirm rechecks sources. No batch storage.',
 requestBody:json({...object({scope,...(action==='confirm'?{preview_token:{type:'string'},confirm_warnings:{type:'boolean'}}:{})}),required:['scope',...(action==='confirm'?['preview_token']:[])]})})};
Object.assign(attendancePaths,require('./attendance-legacy.swagger').legacyAttendancePaths);
module.exports={attendancePaths};
