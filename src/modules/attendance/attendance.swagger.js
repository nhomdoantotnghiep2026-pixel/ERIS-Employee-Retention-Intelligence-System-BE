const base='/api/v1/attendance';
const param=(name,type='string')=>({name,in:'path',required:true,schema:{type}});
const json=schema=>({required:true,content:{'application/json':{schema}}});
const object=properties=>({type:'object',additionalProperties:false,properties});
const reason={type:'string',minLength:1,maxLength:1000};
const datetime={type:'string',example:'2026-11-16 08:15:00',description:'Vietnam wall time: YYYY-MM-DD HH:mm:ss.'};
const scheduledShift = {
  ...object({
    source:{type:'string',enum:['SNAPSHOT','CATALOG']},
    shift_type:{type:'string',nullable:true},
    start_time:{type:'string',example:'08:00:00'},
    end_time:{type:'string',example:'17:00:00'},
    break_start:{type:'string',nullable:true},
    break_end:{type:'string',nullable:true}
  }),
  nullable:true,
  description:'Saved shift snapshot when available, otherwise the current catalog entry identified by the record. Null when neither is available.'
};
function op(summary,extra={}) {return {tags:['Attendance'],security:[{bearerAuth:[]}],summary,responses:{200:{description:'Success'},400:{description:'Invalid input'},401:{description:'Authentication required'},403:{description:'Insufficient permission'},409:{description:'Stale preview, unresolved rows, or concurrent update'}},...extra};}
const filters=[['from','string'],['to','string'],['employee_id','integer'],['limit','integer'],['offset','integer']].map(([name,type])=>({name,in:'query',schema:{type}}));
function uploadRequest(confirm){return {required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file',...(confirm?['options']:[])],properties:{file:{type:'string',format:'binary',description:'Columns: employee_code, employee_name, shift_type, work_date, check_in, check_out. work_date is required to classify rows without punches.'},options:{type:'string',description:'JSON object with choices and confirm_complete (boolean). '+(confirm?'Include preview_token, confirm_warnings, and optional skip_invalid (boolean). ':'')+'choices=[{excel_row,work_date?,exclude?}].'}}}}}};}
const attendancePaths={
  [base+'/import/preview']:{post:op('HR xem trước file, không lưu batch hoặc Attendance',{
    description:'File XLSX tối đa 10 MiB / 10000 dòng. Trả rows và preview_token có chữ ký, hạn 30 phút. Không lưu file, preview hay lịch sử import. Khi loại dòng/chọn ngày ca, gửi lại file cùng options.choices để xem trước lại.',
    requestBody:uploadRequest(false)})},
  [base+'/import/confirm']:{post:op('HR gửi lại file để xác nhận và lưu Attendance',{
    description:'Gửi lại file, lựa chọn và confirm_complete như lần preview cuối. Không đủ một mốc giờ thì bỏ qua. ABSENT chỉ áp dụng khi HR xác nhận đủ dữ liệu và ca đã kết thúc ít nhất 60 phút. Xác nhận cảnh báo bằng confirm_warnings. Với skip_invalid=true, chỉ lưu dòng hợp lệ/cảnh báo đã được xem trước, tự bỏ qua dòng ERROR hoặc cần xử lý; trả skipped_invalid. Không có dòng an toàn để thêm mới thì báo NO_VALID_ROWS. Mặc định vẫn chặn khi còn dòng lỗi chưa loại. Kiểm tra chữ ký preview và thay đổi dữ liệu áp dụng cho cả hai chế độ. Dòng giống hệt được bỏ qua; dữ liệu khác bản ghi ACTIVE phải hủy trước khi nhập lại. Khi nguồn thay đổi, tạo preview mới.',requestBody:uploadRequest(true)})},
  [base+'/import/errors']:{post:op('HR gửi file để tải danh sách lỗi Excel, không lưu preview',{requestBody:uploadRequest(false),responses:{200:{description:'Issue workbook',content:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{schema:{type:'string',format:'binary'}}}}}})},
  [base]:{get:op('HR lists attendance',{parameters:filters})},
  [base+'/me']:{get:op('Employee views own attendance',{parameters:filters.filter(f=>f.name!=='employee_id')})},
  [base+'/summary']:{get:op('Summary of ACTIVE attendance; employees are scoped to themselves',{parameters:filters,description:'Recorded days are actual rows, not inferred absences. Overtime is measured after assigned shift end, excluding break overlap; early arrival is not overtime.'})},
  [base+'/{id}']:{get:op('HR or owner reads attendance detail',{
    parameters:[param('id')],
    responses:{
      200:{description:'Attendance detail',content:{'application/json':{schema:object({
        data:{type:'object',required:['scheduled_shift'],properties:{scheduled_shift:scheduledShift}}
      })}}},
      400:{description:'Invalid input'},
      401:{description:'Authentication required'},
      404:{description:'Active record not found or outside caller access'}
    }
  })},
  [base+'/{id}/audit-logs']:{get:op('HR reads CREATE / CANCEL audit history',{parameters:[param('id'),...filters.slice(-2)]})}
};
attendancePaths[base+'/{id}/cancel']={patch:op('HR cancels ACTIVE attendance with a reason',{parameters:[param('id')],requestBody:json({...object({reason}),required:['reason']})})};
attendancePaths[base+'/cancellations']={get:op('HR lists cancelled attendance',{parameters:filters})};
attendancePaths[base+'/cancellations/{id}']={get:op('HR reads a cancelled record and its cancellation metadata',{parameters:[param('id')],responses:{200:{description:'Success'},403:{description:'HR required'},404:{description:'Cancelled attendance not found'}}})};
const scope={...object({from:{type:'string',format:'date'},to:{type:'string',format:'date'},employee_ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'integer'}}}),required:['from','to','employee_ids']};
for(const action of ['preview','confirm'])attendancePaths[base+'/reconcile/'+action]={post:op('HR '+action+'s HOLIDAY / ON_LEAVE / DAY_OFF for selected employees and dates',{
 description:'Completed shifts on or after hire. HOLIDAY takes priority. ON_LEAVE applies to scheduled workdays. Actual work is preserved. Existing ACTIVE records are preserved; cancel one before creating a replacement. Preview expires in 30 minutes.',
 requestBody:json({...object({scope,...(action==='confirm'?{preview_token:{type:'string'},confirm_warnings:{type:'boolean'}}:{})}),required:['scope',...(action==='confirm'?['preview_token']:[])]})})};
Object.assign(attendancePaths,require('./legacy/attendance-legacy.swagger').legacyAttendancePaths);
module.exports={attendancePaths};
