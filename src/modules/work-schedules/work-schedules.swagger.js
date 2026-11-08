const time = { type: 'string', example: '08:00', description: 'HH:mm or HH:mm:ss with up to 6 fractional second digits.' };
const properties = {
  name: { type: 'string', minLength: 1, maxLength: 150 },
  start_time: time, end_time: { ...time, example: '17:00' },
  break_start: { ...time, example: '12:00' }, break_end: { ...time, example: '13:00' },
  working_days: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1, maximum: 7 }, default: [1, 2, 3, 4, 5] },
  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
};
const workSchedulesPaths = {
  '/api/work-schedules': { post: {
    tags: ['Work schedules'], summary: 'HR creates a work schedule', security: [{ bearerAuth: [] }],
    description: 'Active HR only. start_time < break_start < break_end < end_time. Created with is_default=false. Duplicate names are allowed.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
      required: ['name', 'start_time', 'end_time', 'break_start', 'break_end'], properties } } } },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: {
        message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'integer' }, ...properties, is_default: { type: 'boolean', example: false } } }
      } } } } },
      400: { $ref: '#/components/responses/ValidationError' },
      401: { $ref: '#/components/responses/UnauthorizedError' },
      403: { description: 'Requires an active HR user.' }
    }
  } }
};
workSchedulesPaths['/api/work-schedules'].get = {
  tags: ['Work schedules'], summary: 'HR lists work schedules', security: [{ bearerAuth: [] }],
  description: 'Requires an active HR user. Returns all ACTIVE and INACTIVE schedules ordered by id ascending. Returns an empty array when no schedules exist.',
  responses: {
    200: { description: 'Work schedules', content: { 'application/json': { schema: {
      type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'integer' }, ...properties, is_default: { type: 'boolean' }
      } } } }
    } } } },
    401: { $ref: '#/components/responses/UnauthorizedError' },
    403: { description: 'Requires an active HR user.' }
  }
};
workSchedulesPaths['/api/work-schedules/{id}'] = { patch: {
  tags: ['Work schedules'], summary: 'HR updates permitted work schedule fields', security: [{ bearerAuth: [] }],
  description: 'Active HR only. Default schedules and schedules with any assignment history permit name updates only. Other schedules permit name, time, working_days and status updates. Merged times must satisfy start_time < break_start < break_end < end_time. id and is_default cannot be changed.',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 2147483647 } }],
  requestBody: { required: true, content: { 'application/json': { schema: {
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => {
      const { default: ignored, ...schema } = value;
      return [key, schema];
    }))
  } } } },
  responses: {
    200: { description: 'Updated schedule', content: { 'application/json': { schema: { type: 'object', properties: {
      message: { type: 'string' }, data: { type: 'object', properties: { id: { type: 'integer' }, ...properties, is_default: { type: 'boolean' } } }
    } } } } },
    400: { $ref: '#/components/responses/ValidationError' },
    401: { $ref: '#/components/responses/UnauthorizedError' },
    403: { description: 'Requires an active HR user.' },
    404: { description: 'Work schedule not found.' },
    409: { description: 'Only name can be updated for a default or assigned schedule.' }
  }
} };
const scheduleResult = { type: 'object', properties: { id: { type: 'integer' }, ...properties, is_default: { type: 'boolean' } } };
const commonErrors = {
  400: { $ref: '#/components/responses/ValidationError' },
  401: { $ref: '#/components/responses/UnauthorizedError' },
  403: { description: 'Requires an active HR user.' },
  404: { description: 'Employee or work schedule not found.' },
  409: { description: 'Inactive schedule or overlapping assignment dates.' }
};
const idParameter = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 2147483647 } };
workSchedulesPaths['/api/work-schedules/{id}/default'] = { patch: {
  tags: ['Work schedules'], summary: 'HR sets the default work schedule', security: [{ bearerAuth: [] }],
  description: 'No body required. Only ACTIVE schedules can be selected. Replaces the previous default atomically. Selecting the current default succeeds without changes.',
  parameters: [idParameter], responses: { ...commonErrors,
    409: { description: 'An inactive schedule cannot be the default.' },
    200: { description: 'Default schedule', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, data: scheduleResult } } } } }
  }
} };
workSchedulesPaths['/api/employees/{id}/schedule-assignments'] = { post: {
  tags: ['Work schedules'], summary: 'HR assigns an individual schedule to an employee', security: [{ bearerAuth: [] }],
  parameters: [idParameter],
  description: 'Both dates are inclusive. effective_to may be omitted or null for an open-ended assignment. Overlaps are rejected; existing assignments are never automatically modified. Only ACTIVE schedules may be assigned.',
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
    required: ['schedule_id', 'effective_from'], properties: {
      schedule_id: { type: 'integer', minimum: 1, maximum: 2147483647 },
      effective_from: { type: 'string', format: 'date', example: '2026-12-01' },
      effective_to: { type: 'string', format: 'date', nullable: true, example: '2026-12-31' }
    }
  } } } },
  responses: { ...commonErrors, 201: { description: 'Assignment created', content: { 'application/json': { schema: {
    type: 'object', properties: { message: { type: 'string' }, data: { type: 'object', properties: {
      id: { type: 'integer' }, employee_id: { type: 'integer' }, schedule_id: { type: 'integer' },
      effective_from: { type: 'string', format: 'date' }, effective_to: { type: 'string', format: 'date', nullable: true }
    } } }
  } } } } }
} };
workSchedulesPaths['/api/employees/{id}/schedule-assignments'].get = {
  tags: ['Work schedules'], summary: 'HR views employee schedule assignment history', security: [{ bearerAuth: [] }],
  parameters: [idParameter],
  description: 'Active HR only. Returns all individual assignments (past, present and future), ordered by effective_from DESC, id DESC. Does not include fallback default schedules. Schedule names reflect the current name. Existing employees without assignments return data: [].',
  responses: {
    200: { description: 'Assignment history', content: { 'application/json': { schema: {
      type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'integer' }, employee_id: { type: 'integer' }, schedule_id: { type: 'integer' },
        effective_from: { type: 'string', format: 'date' }, effective_to: { type: 'string', format: 'date', nullable: true },
        ...properties
      } } } }
    } } } },
    400: { $ref: '#/components/responses/ValidationError' },
    401: { $ref: '#/components/responses/UnauthorizedError' },
    403: { description: 'Requires an active HR user.' },
    404: { description: 'Employee not found.' }
  }
};
workSchedulesPaths['/api/employees/{id}/schedule-assignments/{assignmentId}']={delete:{
  tags:['Work schedules'],summary:'HR xóa lần gán lịch riêng chưa sử dụng',security:[{bearerAuth:[]}],
  description:'Chỉ HR ACTIVE. Không có body. Chỉ xóa lần gán bắt đầu hôm nay hoặc tương lai theo giờ Việt Nam và chưa có attendance trong toàn khoảng gán. Xóa bản ghi gán, không xóa lịch mẫu hay chấm công. Có audit DELETE cùng transaction. Sau khi xóa, nhân viên dùng lịch riêng khác còn hiệu lực hoặc lịch mặc định ACTIVE; có thể gán lịch mới nếu không chồng lấn.',
  parameters:[idParameter,{name:'assignmentId',in:'path',required:true,schema:{type:'integer',minimum:1,maximum:2147483647}}],
  responses:{...commonErrors,200:{description:'Đã xóa; data chứa bản ghi gán trước khi xóa.'},409:{description:'Lần gán đã bắt đầu trước hôm nay hoặc khoảng gán có bản ghi attendance.'}}
}};
module.exports = { workSchedulesPaths };

const creationProperties={...properties};
workSchedulesPaths['/api/work-schedules/default']={post:{tags:['Work schedules'],summary:'HR tạo lịch mặc định áp dụng từ ngày mai',security:[{bearerAuth:[]}],
 description:'Không nhận effective_from/effective_to. Chỉ ACTIVE. Tự lập kế hoạch cho ngày mai theo giờ Việt Nam, tạo dòng trong employee_schedule_assignments cho nhân viên ACTIVE; chỉ thay lịch có schedule_id là mặc định hiện tại hoặc lấp khoảng chưa có lịch. Giữ nguyên khoảng lịch riêng. Lịch cũ kết thúc ngày trước lịch mới; cờ is_default chỉ đổi đến ngày hiệu lực. Lệnh chờ lưu Redis, có audit SQL để khôi phục. Một lệnh chờ tại một thời điểm.',
 requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['name','start_time','end_time','break_start','break_end'],properties:creationProperties}}}},
 responses:{...commonErrors,201:{description:'data: lịch mới, scheduled=true, effective_from (ngày mai), effective_to=null, affectedEmployees, skippedEmployees, preservedIndividualEmployees.'},503:{description:'Redis chưa sẵn sàng.'}}
}};
workSchedulesPaths['/api/work-schedules/individual']={post:{tags:['Work schedules'],summary:'HR tạo và gán lịch riêng có ngày bắt đầu/kết thúc',security:[{bearerAuth:[]}],
 description:'Tạo lịch mẫu và gán cho một employee trong cùng transaction. Không chồng lịch riêng khác hoặc sửa ngày đã có attendance. Nếu chồng lịch mặc định hiện tại/đang chờ, tách phần mặc định trước/sau khoảng riêng; khi lịch riêng kết thúc quay về mặc định. Không thêm cột nguồn gán.',
 requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['name','start_time','end_time','break_start','break_end','employee_id','effective_from','effective_to'],properties:{...creationProperties,employee_id:{type:'integer',minimum:1},effective_from:{type:'string',format:'date'},effective_to:{type:'string',format:'date'}}}}}},responses:{...commonErrors,201:{description:'data gồm lịch mới và assignment.'}}
}};
workSchedulesPaths['/api/work-schedules/{id}/default'].patch.description='Đặt lịch ACTIVE đã có làm mặc định từ ngày mai, không nhận ngày trong body. Hôm nay giữ mặc định cũ; lưu lịch gán theo từng nhân viên, không ghi đè lịch riêng. Cờ is_default đổi khi đến ngày áp dụng; chọn lịch đã mặc định là thao tác không đổi. Trả data.scheduled/effective_from nếu có lệnh chờ.';
workSchedulesPaths['/api/employees/{id}/schedule-assignments'].get.description='HR ACTIVE xem tất cả lịch áp dụng đã được lưu, gồm lịch mặc định và lịch riêng, quá khứ/hiện tại/tương lai. Ngày kết thúc được tính cả ngày đó. Sắp xếp effective_from DESC, id DESC.';
workSchedulesPaths['/api/employees/{id}/schedule-assignments'].post.description='Gán lịch riêng đã có. Không gán trực tiếp schedule đang mặc định/đang chờ mặc định. Tự tách các phần mặc định trước/sau khoảng riêng; không ghi đè lịch riêng khác hay khoảng đã chấm công.';
