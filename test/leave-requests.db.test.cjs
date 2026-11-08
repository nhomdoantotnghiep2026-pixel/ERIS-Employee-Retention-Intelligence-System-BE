const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {databasePool}=require('../src/config/database');
const {AppError}=require('../src/common/errors/app-error');
const {LeaveRequestsRepository}=require('../src/modules/attendance/leave-requests.repository');
const {AttendanceRepository}=require('../src/modules/attendance/attendance.repository');
const {createAttendanceService}=require('../src/modules/attendance/attendance.service');
const {createAttendanceRouter}=require('../src/modules/attendance/attendance.routes');

test('PostgreSQL TEMP: lịch sử ghi chú, nghỉ tương lai, ghi ON_LEAVE từng ngày và hủy',async()=>{
  const client=await databasePool.connect();
  let server,failHistory=false,failAttendance=false;
  // Redirect the attendance repository's schema-qualified queries to TEMP fixtures.
  const query=(sql,args)=>{
    sql=sql.replaceAll('public.attendance','attendance');
    if(failHistory && sql.startsWith('INSERT INTO leave_request_histories'))throw new Error('Simulated history write failure');
    if(failAttendance && sql.startsWith('INSERT INTO attendance'))throw new Error('Simulated attendance write failure');
    return client.query(sql,args);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  try{
    await client.query("SET statement_timeout TO '10s'");
    for(const table of ['role','employees','users','attendance','employee_job_histories','leave_requests','leave_request_histories','work_schedules','employee_schedule_assignments']){
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await client.query(`SET search_path TO pg_temp,public;
      ALTER TABLE leave_request_histories ADD FOREIGN KEY(leave_request_id) REFERENCES leave_requests(id),
        ADD FOREIGN KEY(reviewed_by) REFERENCES users(id);
      INSERT INTO role(name) VALUES('HR'),('EMPLOYEE');
      INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status,is_default)
        VALUES('Test default','08:00','17:00','12:00','13:00',ARRAY[1,2,3,4,5],'ACTIVE',TRUE);`);
    const people=[];
    for(let i=0;i<4;i++){
      const employee=(await client.query(`INSERT INTO employees(employee_code,full_name,hire_date,employment_status)
        VALUES($1,$2,'2020-01-01','ACTIVE') RETURNING id`,[`TEST${i}`,`Test ${i}`])).rows[0];
      const role=i<2?'HR':'EMPLOYEE';
      const account=(await client.query(`INSERT INTO users(email,password,role_id,status,employee_id)
        SELECT $1,'hash',id,'ACTIVE',$2 FROM role WHERE name=$3 RETURNING id`,[`test${i}@leave.invalid`,employee.id,role])).rows[0];
      await client.query(`INSERT INTO employee_job_histories(employee_id,change_type,start_date,created_at)
        VALUES($1,'HIRE','2020-01-01','2020-01-01')`,[employee.id]);
      people.push({id:account.id,employeeId:employee.id,role_name:role,status:'ACTIVE',employmentStatus:'ACTIVE'});
    }
    const [hr,otherHr,employee,otherEmployee]=people;
    let now=new Date('2026-11-05T03:00:00Z');
    const holidays=new Map([['2026-11-10',{date:'2026-11-10',name:'Test holiday'}]]);
    const repository=new LeaveRequestsRepository(pool);
    const service=createAttendanceService({attendance:{latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:50}},
      new AttendanceRepository(pool),()=>now,null,{holiday:async date=>holidays.get(date)},repository);
    const input={fromDate:'2026-11-09',toDate:'2026-11-11',reason:'Việc gia đình'};
    const send=async(user=employee,body=input)=>(await service.requestLeave(user,body)).data;
    const cancel=async(id,user=employee)=>(await service.requestLeaveCancellation(user,String(id),{reason:'Lý do xin hủy của nhân viên'})).data;
    const review=async(id,decision,user=hr,note='Ghi chú HR')=>service.reviewLeave(user,String(id),{decision,reviewNote:note});
    const reviewCancel=async(id,decision,user=hr,note='Ghi chú xử lý hủy HR')=>service.reviewLeaveCancellation(user,String(id),{decision,reviewNote:note});
    const state=async id=>(await client.query('SELECT status FROM leave_requests WHERE id=$1',[id])).rows[0].status;
    const attendance=async employeeId=>(await client.query("SELECT to_char(work_date,'YYYY-MM-DD') AS date,attendance_status AS status FROM attendance WHERE employee_id=$1 ORDER BY work_date",[employeeId])).rows;
    const history=async id=>(await client.query('SELECT from_status,to_status,note,reviewed_by FROM leave_request_histories WHERE leave_request_id=$1 ORDER BY id',[id])).rows;

    await assert.rejects(()=>send(employee,{...input,fromDate:'2026-11-05'}),{statusCode:400});
    const pending=await send(); // four days ahead, no longer restricted to tomorrow
    assert.deepEqual((await history(pending.id))[0],{from_status:null,to_status:'PENDING',note:input.reason,reviewed_by:employee.id});
    assert.equal((await attendance(employee.employeeId)).length,0);
    await assert.rejects(()=>send(),{statusCode:409});
    await assert.rejects(()=>cancel(pending.id,otherEmployee),{statusCode:403});
    let changed=await cancel(pending.id);
    assert.equal(changed.effectiveStatus,'PENDING');
    assert.equal(changed.histories.at(-1).note,'Lý do xin hủy của nhân viên');
    await assert.rejects(()=>cancel(pending.id),{statusCode:409});
    await reviewCancel(pending.id,'REJECTED');
    assert.equal(await state(pending.id),'CANCEL_REJECTED');
    assert.equal((await service.myLeaveRequests(employee)).data[0].effectiveStatus,'PENDING');
    await cancel(pending.id);
    await reviewCancel(pending.id,'APPROVED');
    assert.equal(await state(pending.id),'CANCELLED');

    const approved=await send();
    let response=await review(approved.id,'APPROVED',hr,'Đồng ý nghỉ');
    assert.equal(response.attendanceScheduled,true);
    assert.deepEqual(response.attendance,[]);
    assert.equal((await attendance(employee.employeeId)).length,0); // no immediate rows
    changed=await cancel(approved.id);
    assert.equal(changed.effectiveStatus,'APPROVED');
    await assert.rejects(()=>review(approved.id,'APPROVED'),{statusCode:409});
    response=await reviewCancel(approved.id,'REJECTED',hr,'Không đồng ý hủy');
    assert.equal(response.data.effectiveStatus,'APPROVED');
    assert.equal(response.data.reviewNote,'Không đồng ý hủy');
    assert.equal(response.data.histories.at(-1).note,'Không đồng ý hủy');
    assert.equal(response.data.histories.at(-2).note,'Lý do xin hủy của nhân viên');
    await cancel(approved.id);
    failHistory=true;
    await assert.rejects(()=>reviewCancel(approved.id,'APPROVED'),/Simulated history write failure/);
    failHistory=false;
    assert.equal(await state(approved.id),'CANCEL_REQUESTED'); // status and history rolled back together
    await reviewCancel(approved.id,'APPROVED');
    assert.equal(await state(approved.id),'CANCELLED');
    assert.equal((await history(approved.id)).filter(item=>item.to_status==='CANCELLED').length,1);

    const scheduled=await send();
    await review(scheduled.id,'APPROVED');
    await cancel(scheduled.id); // approval remains effective while cancellation is pending
    const other=await send(otherEmployee);
    await client.query("UPDATE employees SET employment_status='INACTIVE' WHERE id=$1",[otherEmployee.employeeId]);
    await assert.rejects(()=>review(other.id,'APPROVED'),{statusCode:409});
    await client.query("UPDATE employees SET employment_status='ACTIVE' WHERE id=$1",[otherEmployee.employeeId]);
    await review(other.id,'REJECTED');
    const actualDateInput={fromDate:'2026-11-16',toDate:'2026-11-16',reason:'Test existing attendance'};
    await client.query(`INSERT INTO attendance(employee_id,work_date,attendance_status,check_in,check_out,working_minutes,overtime_minutes)
      VALUES($1,'2026-11-16','PRESENT','2026-11-16 08:00','2026-11-16 17:00',480,0)`,[otherEmployee.employeeId]);
    const withAttendance=await send(otherEmployee,actualDateInput);
    await review(withAttendance.id,'APPROVED'); // old attendance is not a submission/approval validation rule
    assert.equal((await attendance(otherEmployee.employeeId)).length,1);

    failHistory=true;
    const before=(await client.query('SELECT count(*)::int AS n FROM leave_requests')).rows[0].n;
    await assert.rejects(()=>send(hr,actualDateInput),/Simulated history write failure/);
    failHistory=false;
    assert.equal((await client.query('SELECT count(*)::int AS n FROM leave_requests')).rows[0].n,before);
    const ownHr=await send(hr,actualDateInput);
    await assert.rejects(()=>review(ownHr.id,'APPROVED',hr),{statusCode:403});
    await review(ownHr.id,'APPROVED',otherHr);
    await cancel(ownHr.id,hr);
    await assert.rejects(()=>reviewCancel(ownHr.id,'APPROVED',hr),{statusCode:403});
    await reviewCancel(ownHr.id,'APPROVED',otherHr);

    assert.equal((await service.syncTodayLeaves()).created,0); // 05/11, no future rows
    assert.deepEqual(await attendance(employee.employeeId),[]);
    now=new Date('2026-11-08T17:01:00Z'); // 00:01 Monday 09/11 Vietnam
    failAttendance=true;
    await assert.rejects(()=>service.syncTodayLeaves(),/Simulated attendance write failure/);
    failAttendance=false;
    assert.deepEqual(await attendance(employee.employeeId),[]);
    assert.equal((await service.syncTodayLeaves()).created,1);
    assert.deepEqual(await attendance(employee.employeeId),[{date:'2026-11-09',status:'ON_LEAVE'}]);
    const hours=async date=>(await client.query(`SELECT to_char(check_in,'YYYY-MM-DD HH24:MI:SS') AS check_in,
      to_char(check_out,'YYYY-MM-DD HH24:MI:SS') AS check_out,working_minutes,overtime_minutes
      FROM attendance WHERE employee_id=$1 AND work_date=$2::date`,[employee.employeeId,date])).rows[0];
    assert.deepEqual(await hours('2026-11-09'),{check_in:'2026-11-09 08:00:00',check_out:'2026-11-09 17:00:00',working_minutes:0,overtime_minutes:0});
    assert.equal((await service.syncTodayLeaves()).created,0);
    await client.query("UPDATE attendance SET check_in=NULL,check_out=NULL WHERE employee_id=$1 AND work_date='2026-11-09'",[employee.employeeId]);
    assert.equal((await service.syncTodayLeaves()).created,1); // reconcile older ON_LEAVE rows without hours
    assert.equal((await hours('2026-11-09')).check_out,'2026-11-09 17:00:00');
    assert.equal((await attendance(employee.employeeId)).length,1);
    await assert.rejects(()=>cancel(scheduled.id),{statusCode:409});
    await assert.rejects(()=>reviewCancel(scheduled.id,'APPROVED'),{statusCode:409});
    await reviewCancel(scheduled.id,'REJECTED'); // rejected cancellation retains original approval
    assert.equal((await service.myLeaveRequests(employee)).data[0].effectiveStatus,'APPROVED');
    await assert.rejects(()=>service.checkIn(employee,{latitude:0,longitude:0,accuracyMeters:5}),error=>error instanceof AppError && error.code==='NON_WORKDAY');

    now=new Date('2026-11-10T01:00:00Z');
    await service.syncTodayHoliday();
    assert.equal((await service.syncTodayLeaves()).created,0);
    assert.deepEqual((await attendance(employee.employeeId)).at(-1),{date:'2026-11-10',status:'HOLIDAY'});
    // Restart after missing a due day: restore leave before closing absence.
    await client.query("DELETE FROM attendance WHERE employee_id=$1 AND work_date='2026-11-09'",[employee.employeeId]);
    await service.closePreviousDay();
    assert.deepEqual((await attendance(employee.employeeId))[0],{date:'2026-11-09',status:'ON_LEAVE'});
    now=new Date('2026-11-11T02:00:00Z');
    assert.equal((await service.syncTodayLeaves()).created,1);
    assert.deepEqual(await attendance(employee.employeeId),[
      {date:'2026-11-09',status:'ON_LEAVE'},{date:'2026-11-10',status:'HOLIDAY'},{date:'2026-11-11',status:'ON_LEAVE'}
    ]);
    assert.equal((await hours('2026-11-11')).check_in,'2026-11-11 08:00:00');
    await new AttendanceRepository(pool).markHoliday('2026-11-11');
    assert.deepEqual(await hours('2026-11-11'),{check_in:null,check_out:null,working_minutes:0,overtime_minutes:0});
    assert.equal((await attendance(employee.employeeId)).at(-1).status,'HOLIDAY');
    now=new Date('2026-11-12T02:00:00Z');
    assert.equal((await service.syncTodayLeaves()).created,0);
    now=new Date('2026-11-16T02:00:00Z');
    await service.syncTodayLeaves();
    assert.deepEqual((await attendance(otherEmployee.employeeId)).at(-1),{date:'2026-11-16',status:'PRESENT'});

    const app=express();app.use(express.json());
    app.use('/api/v1/attendance',createAttendanceRouter({service,databasePool:pool,authenticate:(req,res,next)=>{req.auth={userId:Number(req.headers['x-test-user'])};next();}}));
    await new Promise((resolve,reject)=>{server=app.listen(0,'127.0.0.1',resolve);server.on('error',reject);});
    const url=`http://127.0.0.1:${server.address().port}/api/v1/attendance`;
    const get=async(path,user)=>{const res=await fetch(url+path,{headers:{'x-test-user':String(user.id)},signal:AbortSignal.timeout(5000)});return {status:res.status,body:await res.json()};};
    assert.equal((await get('/leave-requests/'+scheduled.id+'/history',employee)).status,200);
    assert.equal((await get('/leave-requests/'+scheduled.id+'/history',otherEmployee)).status,403);
    const viewed=await get('/leave-requests/'+scheduled.id+'/history',hr);
    assert.equal(viewed.status,200);
    assert.equal(viewed.body.data.histories.at(-1).note,'Ghi chú xử lý hủy HR');
    assert.equal((await get('/leave-requests/2147483647/history',hr)).status,404);
    assert.equal((await get('/leave-requests/not-an-id/history',hr)).status,400);
    await assert.rejects(()=>service.leaveRequests(employee),{statusCode:403});
    console.log('PASS: schema histories thật; note văn bản theo actor/trạng thái; ngày tương lai bất kỳ; duyệt không tạo attendance; từng ngày đến hạn, ngày lễ, hủy, retry, bắt kịp trước ABSENT; quyền và rollback.');
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await client.query('RESET search_path');
    await client.query('DROP TABLE IF EXISTS pg_temp.leave_request_histories,pg_temp.leave_requests,pg_temp.attendance,pg_temp.employee_job_histories,pg_temp.users,pg_temp.employees,pg_temp.role');
    client.release();await databasePool.end();
  }
});
