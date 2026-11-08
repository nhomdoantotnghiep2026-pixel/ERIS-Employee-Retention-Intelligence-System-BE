const { resolveSchedule, isScheduledDay } = require('./attendance-schedule');
const { AppError } = require('../../common/errors/app-error');

const columns = `id, employee_id AS "employeeId", to_char(start_date,'YYYY-MM-DD') AS "fromDate",
  to_char(end_date,'YYYY-MM-DD') AS "toDate", reason, status, created_at AS "createdAt", updated_at AS "updatedAt"`;
const baseStatuses = new Set(['PENDING','APPROVED','REJECTED','CANCELLED']);

function effectiveStatus(row, histories) {
  if (baseStatuses.has(row.status)) return row.status;
  let effective = null;
  for (const history of histories) {
    if (effective === null && baseStatuses.has(history.fromStatus)) effective = history.fromStatus;
    if (baseStatuses.has(history.toStatus)) effective = history.toStatus;
  }
  return ['PENDING','APPROVED'].includes(effective) ? effective : null;
}
function output(row, histories) {
  const latestReview = [...histories].reverse().find(item=>['APPROVED','REJECTED','CANCELLED','CANCEL_REJECTED'].includes(item.toStatus));
  const cancellationRequest = [...histories].reverse().find(item=>item.toStatus==='CANCEL_REQUESTED');
  const cancellationReview = cancellationRequest && [...histories].reverse().find(item=>
    item.id>cancellationRequest.id && ['CANCELLED','CANCEL_REJECTED'].includes(item.toStatus));
  return {...row,effectiveStatus:effectiveStatus(row,histories),histories,
    reviewNote:latestReview?.note ?? null,reviewedBy:latestReview?.reviewedBy ?? null,reviewedAt:latestReview?.createdAt ?? null,
    ...(cancellationRequest ? {cancellation:{
      reason:cancellationRequest.note,requestedAt:cancellationRequest.createdAt,
      reviewedBy:cancellationReview?.reviewedBy ?? null,reviewedAt:cancellationReview?.createdAt ?? null,
      reviewNote:cancellationReview?.note ?? null
    }} : {})};
}

class LeaveRequestsRepository {
  constructor(pool) { this.pool=pool; }

  async transaction(user, hrOnly, work) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows}=await client.query(`SELECT u.id,u.employee_id AS "employeeId",r.name AS role
        FROM users u JOIN role r ON r.id=u.role_id JOIN employees e ON e.id=u.employee_id
        WHERE u.id=$1 AND u.status='ACTIVE' AND e.employment_status='ACTIVE' FOR SHARE OF u,e`,[user.id]);
      const actor=rows[0];
      if(!actor || !['EMPLOYEE','HR'].includes(actor.role) || (hrOnly && actor.role!=='HR')) {
        throw new AppError(403,'Cần tài khoản và hồ sơ ACTIVE với quyền phù hợp.');
      }
      const result=await work(client,actor);
      await client.query('COMMIT');return result;
    } catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }

  async lockEmployee(client,employeeId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('leave-requests:' || $1::text))",[employeeId]);
  }

  async loadHistories(client,ids) {
    if(!ids.length)return new Map();
    const {rows}=await client.query(`SELECT h.id,h.leave_request_id AS "leaveRequestId",h.reviewed_by AS "reviewedBy",
      h.from_status AS "fromStatus",h.to_status AS "toStatus",h.note,h.created_at AS "createdAt",
      u.full_name AS "actorName",r.name AS "actorRole"
      FROM leave_request_histories h LEFT JOIN users u ON u.id=h.reviewed_by
      LEFT JOIN role r ON r.id=u.role_id WHERE h.leave_request_id=ANY($1::int[]) ORDER BY h.id`,[ids]);
    const grouped=new Map();
    for(const row of rows){if(!grouped.has(row.leaveRequestId))grouped.set(row.leaveRequestId,[]);grouped.get(row.leaveRequestId).push(row);}
    return grouped;
  }
  async decorate(client,rows) {
    const histories=await this.loadHistories(client,rows.map(row=>row.id));
    return rows.map(row=>output(row,histories.get(row.id)||[]));
  }
  async appendHistory(client,requestId,actorId,fromStatus,toStatus,note) {
    await client.query(`INSERT INTO leave_request_histories(leave_request_id,reviewed_by,from_status,to_status,note)
      VALUES($1,$2,$3,$4,$5)`,[requestId,actorId,fromStatus,toStatus,note]);
  }
  async transition(client,request,status,actorId,note) {
    const {rows}=await client.query(`UPDATE leave_requests SET status=$2,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status=$3 RETURNING ${columns}`,[request.id,status,request.status]);
    if(!rows[0])throw new AppError(409,'Đơn đã thay đổi; vui lòng tải lại.');
    await this.appendHistory(client,request.id,actorId,request.status,status,note);
    return (await this.decorate(client,rows))[0];
  }

  async lockedRequest(client,id) {
    const {rows}=await client.query('SELECT employee_id FROM leave_requests WHERE id=$1',[id]);
    if(!rows[0])throw new AppError(404,'Không tìm thấy đơn nghỉ phép.');
    await this.lockEmployee(client,rows[0].employee_id);
    const result=await client.query(`SELECT ${columns} FROM leave_requests WHERE id=$1 FOR UPDATE`,[id]);
    if(!result.rows[0])throw new AppError(404,'Không tìm thấy đơn nghỉ phép.');
    return (await this.decorate(client,result.rows))[0];
  }

  async create(user,input) {
    return this.transaction(user,false,async(client,actor)=>{
      await this.lockEmployee(client,actor.employeeId);
      const {rows:existing}=await client.query(`SELECT id FROM leave_requests WHERE employee_id=$1
        AND start_date<=$3::date AND end_date>=$2::date
        AND status IN ('PENDING','APPROVED','CANCEL_REQUESTED','CANCEL_REJECTED')`,
      [actor.employeeId,input.fromDate,input.toDate]);
      if(existing.length)throw new AppError(409,'Đã có đơn nghỉ trùng khoảng ngày.');
      const {rows}=await client.query(`INSERT INTO leave_requests(employee_id,start_date,end_date,reason,status)
        VALUES($1,$2::date,$3::date,$4,'PENDING') RETURNING ${columns}`,
      [actor.employeeId,input.fromDate,input.toDate,input.reason]);
      await this.appendHistory(client,rows[0].id,actor.id,null,'PENDING',input.reason);
      return (await this.decorate(client,rows))[0];
    });
  }
  async list(user,own=false) {
    return this.transaction(user,!own,async(client,actor)=>{
      const {rows}=await client.query(`SELECT l.*,e.employee_code AS "employeeCode",e.full_name AS "fullName"
        FROM (SELECT ${columns} FROM leave_requests ${own?'WHERE employee_id=$1':''}) l
        JOIN employees e ON e.id=l."employeeId" ORDER BY l."createdAt" DESC,l.id DESC`,own?[actor.employeeId]:[]);
      return this.decorate(client,rows);
    });
  }
  async history(user,id) {
    return this.transaction(user,false,async(client,actor)=>{
      const {rows}=await client.query(`SELECT ${columns} FROM leave_requests WHERE id=$1`,[id]);
      if(!rows[0])throw new AppError(404,'Không tìm thấy đơn nghỉ phép.');
      if(actor.role!=='HR' && rows[0].employeeId!==actor.employeeId)throw new AppError(403,'Chỉ được xem lịch sử đơn của mình.');
      return {data:(await this.decorate(client,rows))[0]};
    });
  }
  async requestCancellation(user,id,reason,today) {
    return this.transaction(user,false,async(client,actor)=>{
      const request=await this.lockedRequest(client,id);
      if(request.employeeId!==actor.employeeId)throw new AppError(403,'Chỉ được xin hủy đơn nghỉ của chính mình.');
      if(request.fromDate<=today)throw new AppError(409,'Chỉ được xin hủy đơn có ngày bắt đầu nghỉ trong tương lai.');
      if(!['PENDING','APPROVED','CANCEL_REJECTED'].includes(request.status) || !['PENDING','APPROVED'].includes(request.effectiveStatus)) {
        throw new AppError(409,'Đơn không còn đủ điều kiện xin hủy hoặc thiếu lịch sử trạng thái.');
      }
      return this.transition(client,request,'CANCEL_REQUESTED',actor.id,reason);
    });
  }
  async review(user,id,decision,note,today) {
    return this.transaction(user,true,async(client,actor)=>{
      const request=await this.lockedRequest(client,id);
      if(request.employeeId===actor.employeeId)throw new AppError(403,'HR khác phải xử lý đơn nghỉ của bạn.');
      if(request.status==='CANCEL_REQUESTED' || request.effectiveStatus!=='PENDING')throw new AppError(409,'Đơn không ở trạng thái chờ duyệt nghỉ phép.');
      if(decision==='APPROVED') {
        if(request.fromDate<=today)throw new AppError(409,'Không duyệt nghỉ phép cho ngày hôm nay hoặc quá khứ.');
        const {rows:eligible}=await client.query(`SELECT e.id FROM employees e WHERE e.id=$1
          AND e.employment_status='ACTIVE' AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')
          FOR SHARE OF e`,[request.employeeId]);
        if(!eligible[0])throw new AppError(409,'Nhân viên không còn ACTIVE.');
        const {rows:others}=await client.query(`SELECT ${columns} FROM leave_requests WHERE employee_id=$1 AND id<>$2
          AND start_date<=$4::date AND end_date>=$3::date AND status IN ('APPROVED','CANCEL_REQUESTED','CANCEL_REJECTED')`,
        [request.employeeId,id,request.fromDate,request.toDate]);
        if((await this.decorate(client,others)).some(row=>row.effectiveStatus==='APPROVED'))throw new AppError(409,'Đã có đơn được duyệt trùng khoảng ngày.');
      }
      const data=await this.transition(client,request,decision,actor.id,note);
      return {data,attendance:[],attendanceScheduled:decision==='APPROVED'};
    });
  }
  async reviewCancellation(user,id,decision,note,today) {
    return this.transaction(user,true,async(client,actor)=>{
      const request=await this.lockedRequest(client,id);
      if(request.employeeId===actor.employeeId)throw new AppError(403,'HR khác phải xử lý đơn hủy của bạn.');
      if(request.status!=='CANCEL_REQUESTED' || !['PENDING','APPROVED'].includes(request.effectiveStatus)) {
        throw new AppError(409,'Đơn không có yêu cầu hủy hợp lệ đang chờ xử lý.');
      }
      if(decision==='APPROVED' && request.fromDate<=today)throw new AppError(409,'Không hủy đơn đã đến ngày bắt đầu nghỉ.');
      const data=await this.transition(client,request,decision==='APPROVED'?'CANCELLED':'CANCEL_REJECTED',actor.id,note);
      return {data,removedAttendance:0};
    });
  }

  // A short transaction checks one due date, never pre-creates future attendance.
  async materializeDay(date,employeeId=null) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows:employees}=await client.query(`SELECT e.id FROM employees e WHERE e.employment_status='ACTIVE'
        AND e.hire_date<=$1::date AND ($2::int IS NULL OR e.id=$2)
        AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')
        AND EXISTS(SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.start_date<=$1::date AND l.end_date>=$1::date
          AND l.status IN ('APPROVED','CANCEL_REQUESTED','CANCEL_REJECTED'))
        ORDER BY e.id FOR SHARE OF e`,[date,employeeId]);
      const attendance=[];
      for(const employee of employees) {
        await this.lockEmployee(client,employee.id);
        const schedule=await resolveSchedule(client,employee.id,date);
        if(!isScheduledDay(date,schedule))continue;
        const {rows}=await client.query(`SELECT ${columns} FROM leave_requests WHERE employee_id=$1
          AND start_date<=$2::date AND end_date>=$2::date
          AND status IN ('APPROVED','CANCEL_REQUESTED','CANCEL_REJECTED') ORDER BY id FOR SHARE`,[employee.id,date]);
        if(!(await this.decorate(client,rows)).some(row=>row.effectiveStatus==='APPROVED'))continue;
        await client.query("SELECT pg_advisory_xact_lock(hashtext('attendance:' || $1::text || ':' || $2::text))",[employee.id,date]);
        const result=await client.query(`INSERT INTO attendance(employee_id,work_date,attendance_status,check_in,check_out,working_minutes,overtime_minutes,created_at,updated_at)
          VALUES($1,$2::date,'ON_LEAVE',$2::date+$3::time,$2::date+$4::time,0,0,
            CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')
          ON CONFLICT(employee_id,work_date) DO UPDATE SET attendance_status='ON_LEAVE',working_minutes=0,overtime_minutes=0,
            check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,
            updated_at=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'
          WHERE attendance.attendance_status IN ('ABSENT','ON_LEAVE') AND attendance.check_in IS NULL AND attendance.check_out IS NULL
          RETURNING id,employee_id AS "employeeId",to_char(work_date,'YYYY-MM-DD') AS "workDate",attendance_status AS "attendanceStatus"`,[employee.id,date,schedule.startTime,schedule.endTime]);
        attendance.push(...result.rows);
      }
      await client.query('COMMIT');return {date,created:attendance.length,data:attendance};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
}
module.exports = { LeaveRequestsRepository };
