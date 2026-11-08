const { requireSchedule, isScheduledDay } = require('./attendance-schedule');
const { AppError } = require('../../common/errors/app-error');
const { todayInVietnam, validDate, validateLeave, validateHoliday } = require('./attendance-calendar');
const { validateLeaveId, validateLeaveDecision, validateCancellation } = require('./attendance.validation');
const zone = 'Asia/Ho_Chi_Minh';
function error(code, message, status = 409) { const e = new AppError(status,message); e.code=code; throw e; }
function localDay(now) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,workday:!['Sat','Sun'].includes(p.weekday)};
}
const local = value => value ? new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)) : null;
function evaluate(body, config, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['latitude','longitude','accuracyMeters','capturedAt'].includes(k))) error('VALIDATION_ERROR','Only GPS fields are accepted.',400);
  for(const [key,min,max] of [['latitude',-90,90],['longitude',-180,180],['accuracyMeters',0,100000]]) {
    if(!Number.isFinite(body[key]) || body[key]<min || body[key]>max) error('VALIDATION_ERROR',`${key} is invalid.`,400);
  }
  if(body.capturedAt!==undefined){
    const captured = new Date(body.capturedAt);
    if(typeof body.capturedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.capturedAt) || !Number.isFinite(captured.getTime())) error('VALIDATION_ERROR','capturedAt must be an ISO timestamp with timezone.',400);
    if(Math.abs(now-captured)>300000) error('STALE_LOCATION','GPS must be captured within five minutes.',400);
  }
  const rad = x=>x*Math.PI/180;
  const a=Math.sin(rad(body.latitude-config.latitude)/2)**2+Math.cos(rad(config.latitude))*Math.cos(rad(body.latitude))*Math.sin(rad(body.longitude-config.longitude)/2)**2;
  const distance=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
  return {status:body.accuracyMeters>config.maxAccuracyMeters?'LOW_ACCURACY':distance<=config.radiusMeters?'INSIDE':'OUTSIDE',distanceMeters:Math.round(distance),accuracyMeters:body.accuracyMeters,allowedRadiusMeters:config.radiusMeters};
}
function createAttendanceService(config, repository, clock=()=>new Date(), locationStore=null, calendarStore=null, leaveRepository=null) {
  const settings=config.attendance;
  async function currentSettings() {
    const location = locationStore ? await locationStore.get() : { latitude: settings.latitude, longitude: settings.longitude, address: settings.address || '', source: 'env', updatedAt: null, updatedBy: null };
    return { ...settings, ...location };
  }
  async function syncLeavesForDay(date,employeeId=null) {
    if(!leaveRepository || (calendarStore && await calendarStore.holiday(date))) {
      return {date,created:0,data:[]};
    }
    return leaveRepository.materializeDay(date,employeeId);
  }
  function assertLocationHr(user) {
    if (user?.status !== 'ACTIVE' || user?.role_name !== 'HR' || user.employeeId == null || user.employmentStatus !== 'ACTIVE') {
      error('FORBIDDEN', 'Chỉ HR ACTIVE có employeeId và hồ sơ ACTIVE được quản lý vị trí công ty.', 403);
    }
  }
  async function record(action,user,body) {
    const now=clock(),day=localDay(now);
    const schedule=requireSchedule(await repository.getSchedule(user.employeeId,day.date));
    if(!isScheduledDay(day.date,schedule)) error('NON_WORKDAY','This date is not a working day in your schedule.');
    if (calendarStore && await calendarStore.holiday(day.date)) error('NON_WORKDAY','Hôm nay là ngày nghỉ lễ.');
    const gps=evaluate(body,await currentSettings(),now);
    if(gps.status!=='INSIDE') return {...gps,persisted:false,storage:'postgresql',mockMode:false};
    await syncLeavesForDay(day.date,user.employeeId);
    const row=await repository.record({userId:user.id,employeeId:user.employeeId,date:day.date,instant:now.toISOString(),action});
    return {...gps,persisted:true,storage:'postgresql',mockMode:false,attendance:row};
  }
  function assertHr(user) {
    if(user?.status!=='ACTIVE'||user?.role_name!=='HR') error('FORBIDDEN','Only ACTIVE HR can view attendance history.',403);
  }
  return {
    async list(user) { assertHr(user); return repository.list(); },
    async detail(user,id) { assertHr(user); const row=await repository.findById(id); if(!row) error('NOT_FOUND','Attendance record not found.',404); return {data:row}; },
    async companyLocation(user) { assertLocationHr(user); const current = await currentSettings(); return { data: { address: current.address, latitude: current.latitude, longitude: current.longitude, source: current.source, updatedAt: current.updatedAt, updatedBy: current.updatedBy }, allowedRadiusMeters: settings.radiusMeters }; },
    async updateCompanyLocation(user,body) {
      assertLocationHr(user);
      if (!locationStore) error('UNAVAILABLE', 'Chưa cấu hình nơi lưu vị trí công ty.', 503);
      return { message: 'Đã cập nhật vị trí công ty.', data: await locationStore.set(body,user.id), allowedRadiusMeters: settings.radiusMeters };
    },
    configuration:async(user)=>{
      const current=await currentSettings();
      const date=todayInVietnam(clock());
      const schedule=requireSchedule(await repository.getSchedule(user.employeeId,date));
      return {companyLocation:{latitude:current.latitude,longitude:current.longitude,address:current.address},
        companyLocationSource:current.source,allowedRadiusMeters:settings.radiusMeters,maximumAccuracyMeters:settings.maxAccuracyMeters,
        date,timeZone:zone,workStart:schedule.startTime,workEnd:schedule.endTime,
        lunchStart:schedule.breakStart,lunchEnd:schedule.breakEnd,schedule,storage:'postgresql',mockMode:false};
    },
    async today(user) {
      const now=clock(),day=localDay(now);
      const schedule=requireSchedule(await repository.getSchedule(user.employeeId,day.date));
      const scheduledWorkday=isScheduledDay(day.date,schedule);
      await syncLeavesForDay(day.date,user.employeeId);
      const row=await repository.find(user.employeeId,day.date);
      const holiday=calendarStore && await calendarStore.holiday(day.date);
      const blocked=!!holiday||['ON_LEAVE','HOLIDAY'].includes(row?.attendanceStatus);
      const attendance=row || (holiday ? {employeeId:user.employeeId,workDate:day.date,attendanceStatus:'HOLIDAY',checkIn:null,checkOut:null,workingMinutes:0,overtimeMinutes:0} : null);
      return {user:{id:user.id,employeeId:user.employeeId},date:day.date,serverTime:now.toISOString(),timeZone:zone,schedule,workday:scheduledWorkday&&!blocked,
        checkedIn:!!row?.checkIn,checkedOut:!!row?.checkOut,showCheckInPrompt:scheduledWorkday&&!blocked&&!row?.checkIn,
        checkedInAt:row?.checkIn||null,checkedInAtLocal:local(row?.checkIn),checkedOutAt:row?.checkOut||null,checkedOutAtLocal:local(row?.checkOut),
        attendance,storage:'postgresql',mockMode:false};
    },
    async requestLeave(user,body) {
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      const input=validateLeave(body,clock());
      let hasWorkingDay=false;
      for(const date of input.dates) {
        const schedule=await repository.getSchedule(user.employeeId,date);
        if(isScheduledDay(date,schedule)){hasWorkingDay=true;break;}
      }
      if(!hasWorkingDay) error('VALIDATION_ERROR','The leave range has no working day in your schedule.',400);
      return {data:await leaveRepository.create(user,input)};
    },
    async myLeaveRequests(user) {
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      return {data:await leaveRepository.list(user,true)};
    },
    async leaveRequests(user) {
      assertHr(user);
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      return {data:await leaveRepository.list(user)};
    },
    async reviewLeave(user,id,body) {
      assertHr(user);
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      const input=validateLeaveDecision(body);
      return leaveRepository.review(user,validateLeaveId(id),input.decision,input.reviewNote,todayInVietnam(clock()));
    },
    async requestLeaveCancellation(user,id,body) {
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      const now=clock();
      return {data:await leaveRepository.requestCancellation(user,validateLeaveId(id),validateCancellation(body),
        todayInVietnam(now),now.toISOString())};
    },
    async reviewLeaveCancellation(user,id,body) {
      assertHr(user);
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      const input=validateLeaveDecision(body);
      return leaveRepository.reviewCancellation(user,validateLeaveId(id),input.decision,input.reviewNote,todayInVietnam(clock()));
    },
    async leaveHistory(user,id) {
      if(!leaveRepository) error('UNAVAILABLE','Chưa cấu hình nơi lưu đơn nghỉ phép.',503);
      return leaveRepository.history(user,validateLeaveId(id));
    },
    async syncTodayLeaves() { return syncLeavesForDay(todayInVietnam(clock())); },
    async holidays(user) {
      assertHr(user); if(!calendarStore) error('UNAVAILABLE','Chưa cấu hình nơi lưu ngày lễ.',503);
      return {data:await calendarStore.holidays()};
    },
    async createHoliday(user,body) {
      assertHr(user); if(!calendarStore) error('UNAVAILABLE','Chưa cấu hình nơi lưu ngày lễ.',503);
      const input=validateHoliday(body,clock());
      return calendarStore.createHoliday(input,user.id,todayInVietnam(clock()));
    },
    async updateHoliday(user,id,body) {
      assertHr(user);
      if(!calendarStore) error('UNAVAILABLE','Holiday storage is unavailable.',503);
      if (typeof id !== 'string' || !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) error('VALIDATION_ERROR','Holiday id must be a positive integer.',400);
      const now=clock();
      const input=validateHoliday(body,now);
      return calendarStore.updateHoliday(Number(id),input,todayInVietnam(now));
    },
    async deleteHoliday(user,id) {
      assertHr(user);
      if(!calendarStore) error('UNAVAILABLE','Holiday storage is unavailable.',503);
      if (typeof id !== 'string' || !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) error('VALIDATION_ERROR','Holiday id must be a positive integer.',400);
      await calendarStore.deleteHoliday(Number(id),todayInVietnam(clock()));
    },
    async syncTodayHoliday() {
      if (!calendarStore) return {date:todayInVietnam(clock()),affectedEmployees:0};
      const date=todayInVietnam(clock());
      if (!await calendarStore.holiday(date)) return {date,affectedEmployees:0};
      return {date,affectedEmployees:await repository.markHoliday(date)};
    },
    async closeDay(user,body) {
      assertHr(user);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1) error('VALIDATION_ERROR','Chỉ nhận date.',400);
      const date=validDate(body.date,'date');
      if(date>=todayInVietnam(clock())) error('VALIDATION_ERROR','Chỉ chốt ngày làm việc đã qua.',400);
      if(calendarStore && await calendarStore.holiday(date)) error('NON_WORKDAY','Ngày lễ không thể chốt vắng mặt.');
      await syncLeavesForDay(date);
      return {date,created:await repository.closeAbsent(date)};
    },
    async closePreviousDay() {
      const current=todayInVietnam(clock());
      const previous=new Date(Date.parse(`${current}T00:00:00Z`)-86400000).toISOString().slice(0,10);
      if(calendarStore && await calendarStore.holiday(previous)) return {date:previous,created:0};
      await syncLeavesForDay(previous);
      return {date:previous,created:await repository.closeAbsent(previous)};
    },
    checkIn:(user,body)=>record('check-in',user,body),
    checkOut:(user,body)=>record('check-out',user,body)
  };
}
module.exports = { createAttendanceService, localDay, evaluate };
