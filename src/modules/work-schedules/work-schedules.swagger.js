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
module.exports = { workSchedulesPaths };
