const { AppError } = require('../../common/errors/app-error');
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
function createAttendanceService(config, repository, clock=()=>new Date(), locationStore=null) {
  const settings=config.attendance;
  async function currentSettings() {
    const location = locationStore ? await locationStore.get() : { latitude: settings.latitude, longitude: settings.longitude, address: settings.address || '', source: 'env', updatedAt: null, updatedBy: null };
    return { ...settings, ...location };
  }
  function assertLocationHr(user) {
    if (user?.status !== 'ACTIVE' || user?.role_name !== 'HR' || user.employeeId == null || user.employmentStatus !== 'ACTIVE') {
      error('FORBIDDEN', 'Chỉ HR ACTIVE có employeeId và hồ sơ ACTIVE được quản lý vị trí công ty.', 403);
    }
  }
  async function record(action,user,body) {
    const now=clock(),day=localDay(now);
    if(!day.workday) error('NON_WORKDAY','Attendance is available Monday to Friday.');
    const gps=evaluate(body,await currentSettings(),now);
    if(gps.status!=='INSIDE') return {...gps,persisted:false,storage:'postgresql',mockMode:false};
    const attendanceStatus=now>new Date(day.date+'T08:00:00+07:00')?'LATE':'PRESENT';
    const row=await repository.record({userId:user.id,employeeId:user.employeeId,date:day.date,instant:now.toISOString(),action,attendanceStatus});
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
    configuration:async()=>{ const current=await currentSettings(); return ({companyLocation:{latitude:current.latitude,longitude:current.longitude,address:current.address},companyLocationSource:current.source,allowedRadiusMeters:settings.radiusMeters,maximumAccuracyMeters:settings.maxAccuracyMeters,timeZone:zone,workStart:'08:00',workEnd:'17:00',lunchStart:'12:00',lunchEnd:'13:00',storage:'postgresql',mockMode:false}); },
    async today(user) {
      const now=clock(),day=localDay(now),row=await repository.find(user.employeeId,day.date);
      const blocked=['ON_LEAVE','HOLIDAY'].includes(row?.attendanceStatus);
      return {user:{id:user.id,employeeId:user.employeeId},date:day.date,serverTime:now.toISOString(),timeZone:zone,workday:day.workday&&!blocked,
        checkedIn:!!row?.checkIn,checkedOut:!!row?.checkOut,showCheckInPrompt:day.workday&&!blocked&&!row?.checkIn,
        checkedInAt:row?.checkIn||null,checkedInAtLocal:local(row?.checkIn),checkedOutAt:row?.checkOut||null,checkedOutAtLocal:local(row?.checkOut),
        attendance:row,storage:'postgresql',mockMode:false};
    },
    checkIn:(user,body)=>record('check-in',user,body),
    checkOut:(user,body)=>record('check-out',user,body)
  };
}
module.exports = { createAttendanceService, localDay, evaluate };
