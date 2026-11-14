const responses={200:{description:'Success'},400:{description:'Invalid payload'},401:{description:'Authentication required'},403:{description:'Active HR required'},404:{description:'Employee or schedule not found'},409:{description:'Schedule inactive or assigned schedule cannot be edited'}};
const body=schema=>({required:true,content:{'application/json':{schema}}});
const schedule={type:'object',additionalProperties:false,required:['name','shift_type','start_time','end_time','break_start','break_end'],properties:{name:{type:'string',maxLength:150},shift_type:{type:'string',maxLength:100},start_time:{type:'string',example:'11:00:00'},end_time:{type:'string',example:'20:00:00'},break_start:{type:'string',example:'15:00:00'},break_end:{type:'string',example:'16:00:00'},working_days:{type:'array',uniqueItems:true,items:{type:'integer',minimum:1,maximum:7}},status:{type:'string',enum:['ACTIVE','INACTIVE']}}};
const assignment={type:'object',additionalProperties:false,required:['work_schedule_id'],properties:{work_schedule_id:{type:'integer',minimum:1}}};
const id={name:'id',in:'path',required:true,schema:{type:'integer',minimum:1}};
schedule.required=['name','shift_type','start_time','end_time'];
for(const key of ['break_start','break_end'])schedule.properties[key]={type:'string',nullable:true,description:'Set both break times, or both null for no break. No-break shifts require work-schedules-optional-break.sql.'};
const op=(summary,extra={})=>({tags:['Work Schedules'],security:[{bearerAuth:[]}],summary,responses,...extra});
const workSchedulesPaths={
 '/api/work-schedules':{get:op('HR list work schedules'),post:op('HR create a shift definition',{requestBody:body(schedule),responses:{...responses,201:{description:'Created'}}})},
 '/api/work-schedules/{id}':{patch:op('HR update a shift definition',{parameters:[id],description:'Assigned schedules can only be renamed. Create a new schedule and assign it to change time/shift type.',requestBody:body({...schedule,required:undefined,minProperties:1})})},
 '/api/work-schedules/individual':{post:op('HR create a shift and assign it immediately',{requestBody:body({...schedule,required:[...schedule.required,'employee_id'],properties:{...schedule.properties,employee_id:{type:'integer',minimum:1}}}),responses:{...responses,201:{description:'Created and assigned'}}})},
 '/api/employees/{id}/work-schedule':{get:op('HR get employee current schedule',{parameters:[id]}),put:op('HR assign employee current schedule',{parameters:[id],requestBody:body(assignment),description:'Updates employees.work_schedule_id immediately. No effective dates or schedule history are stored. Imported historical attendance is checked against this current schedule.'})},
 '/api/employees/{id}/schedule-assignments':{get:op('Compatibility: current schedule as zero/one-item array',{parameters:[id]}),post:op('Compatibility: assign current work_schedule_id',{parameters:[id],requestBody:body(assignment)})},
 '/api/employees/{id}/schedule-assignments/{assignmentId}':{delete:op('Clear employee current schedule',{parameters:[id,{name:'assignmentId',in:'path',required:true,schema:{type:'integer'}}],description:'assignmentId means the current work schedule ID; clears employees.work_schedule_id only if it still matches.'})},
 '/api/work-schedules/default':{post:op('Retired default schedule endpoint',{responses:{410:{description:'Assign work_schedule_id directly to employees.'}}})},
 '/api/work-schedules/{id}/default':{patch:op('Retired default schedule endpoint',{parameters:[id],responses:{410:{description:'Assign work_schedule_id directly to employees.'}}})}
};
module.exports={workSchedulesPaths};
