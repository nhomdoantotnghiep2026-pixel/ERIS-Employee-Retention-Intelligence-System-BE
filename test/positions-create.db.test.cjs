const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { databasePool } = require('../src/config/database');
const { createAccessToken } = require('../src/common/utils/token');
const { authenticate } = require('../src/common/middleware/authenticate');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { PositionsRepository } = require('../src/modules/positions/positions.repository');
const { PositionsService } = require('../src/modules/positions/positions.service');
const { PositionsController } = require('../src/modules/positions/positions.controller');
const { createPositionsRouter } = require('../src/modules/positions/positions.routes');

test('Create positions requires an existing department: real HTTP/JWT and PostgreSQL TEMP', async () => {
  let client, server; const results = [];
  try {
    client = await databasePool.connect();
    for (const table of ['role','users','departments','positions','employees','audit_logs']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await client.query(`SET search_path TO pg_temp, public;
      ALTER TABLE pg_temp.positions ADD FOREIGN KEY (department_id) REFERENCES pg_temp.departments(id);
      INSERT INTO role (id,name) VALUES (1,'HR'),(2,'ADMIN');
      INSERT INTO users (id,email,password,role_id,status) VALUES (1,'hr@position-test.invalid','fixture',1,'ACTIVE'),(2,'admin@position-test.invalid','fixture',2,'ACTIVE');
      INSERT INTO departments (id,code,name,status) VALUES (1,'TEST1','Phòng kỹ thuật','ACTIVE'),(2,'TEST2','Phòng nhân sự','ACTIVE');`);
    const pool = { query: (...args) => client.query(...args), connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
    const app = express(); app.use(express.json());
    app.use('/api/positions', createPositionsRouter({ positionsController: new PositionsController(new PositionsService({ positionsRepository: new PositionsRepository(pool) })), authenticate }));
    app.use(errorHandler);
    server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/positions`;
    const hrToken = createAccessToken({id:1,roleId:1,status:'ACTIVE'}), adminToken = createAccessToken({id:2,roleId:2,status:'ACTIVE'});
    const valid = { name: '  Backend Developer  ', jobLevel: 2, departmentId: 1, description: '  Phát triển backend  ' };
    async function call(label, method, suffix, body, expected, token = hrToken) {
      const response = await fetch(base + suffix, { method, headers: { ...(token ? { Authorization:`Bearer ${token}` } : {}), ...(body !== undefined ? {'Content-Type':'application/json'} : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const data = await response.json();
      results.push({label,method,url:'/api/positions'+suffix,request:body,expected,actual:response.status,response:data});
      assert.equal(response.status,expected,label); return data;
    }
    for (const [label,value] of [['thiếu',undefined],['null',null],['chuỗi','1'],['rỗng',''],['số 0',0],['số âm',-1],['số thập phân',1.5],['boolean',true],['mảng',[]],['object',{}],['vượt integer PostgreSQL',2147483648]]) {
      const input = {...valid}; if(value===undefined)delete input.departmentId; else input.departmentId=value;
      const response=await call(`departmentId ${label}`,'POST','',input,400);
      assert.equal(response.message,'departmentId is required and must be a positive integer, at most 2147483647.');
    }
    await call('Phòng ban không tồn tại','POST','',{...valid,departmentId:2147483647},404);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM positions')).rows[0].count,0);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count,0);
    await call('Không có token','POST','',valid,401,null);
    await call('Admin không có quyền tạo chức danh','POST','',valid,403,adminToken);
    await call('Tên chức danh rỗng','POST','',{...valid,name:''},400);
    await call('jobLevel ngoài 1 đến 5','POST','',{...valid,jobLevel:6},400);
    const created = await call('Tạo chức danh thuộc phòng ban tồn tại','POST','',valid,201);
    assert.equal(created.data.departmentId,1); assert.equal(created.data.name,'Backend Developer');
    const saved = (await client.query('SELECT department_id,name FROM positions WHERE id=$1',[created.data.id])).rows[0];
    assert.equal(saved.department_id,1); assert.equal(saved.name,'Backend Developer');
    const audit=(await client.query("SELECT new_value FROM audit_logs WHERE entity_type='positions' AND entity_id=$1",[created.data.id])).rows[0];
    assert.equal(audit.new_value.department_id,1);
    const other=await call('Tạo chức danh thuộc phòng ban khác','POST','',{...valid,name:'HR Specialist',departmentId:2},201);
    const list=await call('Lọc chức danh theo phòng ban','GET','?departmentId=1',undefined,200);
    assert.deepEqual(list.data.map(r=>r.id),[created.data.id]); assert(!list.data.some(r=>r.id===other.data.id));
    const detail=await call('Xem chi tiết có departmentId','GET',`/${created.data.id}`,undefined,200);
    assert.equal(detail.data.departmentId,1);
    const positionId=created.data.id;
    const blockedMessage='Cannot deactivate a position while employees with employment_status other than INACTIVE are assigned to it.';
    await client.query(`INSERT INTO employees(employee_code,full_name,hire_date,department_id,position_id,employment_status)
      VALUES ('TEST_EMP_1','Test employee',CURRENT_DATE,1,$1,'ACTIVE')`,[positionId]);
    for (const status of ['ACTIVE','IN_PROCESS']) {
      await client.query('UPDATE employees SET employment_status=$1 WHERE employee_code=$2',[status,'TEST_EMP_1']);
      const before=(await client.query('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count;
      const response=await call(`Chặn ngừng chức danh còn nhân viên ${status}`,'DELETE',`/${positionId}`,undefined,409);
      assert.equal(response.message,blockedMessage);
      assert.equal((await client.query('SELECT status FROM positions WHERE id=$1',[positionId])).rows[0].status,'ACTIVE');
      assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count,before);
    }
    await client.query("UPDATE employees SET employment_status='INACTIVE' WHERE employee_code='TEST_EMP_1'");
    await client.query(`INSERT INTO employees(employee_code,full_name,hire_date,department_id,position_id,employment_status)
      VALUES ('TEST_EMP_2','Pending employee',CURRENT_DATE,1,$1,'IN_PROCESS')`,[positionId]);
    await call('Chặn khi có cả nhân viên INACTIVE và IN_PROCESS','DELETE',`/${positionId}`,undefined,409);
    await client.query("UPDATE employees SET employment_status='INACTIVE' WHERE employee_code='TEST_EMP_2'");
    const removed=await call('Cho ngừng khi tất cả nhân viên đều INACTIVE','DELETE',`/${positionId}`,undefined,200);
    assert.equal(removed.data.status,'INACTIVE');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM employees WHERE position_id=$1',[positionId])).rows[0].count,2);
    assert.equal((await client.query("SELECT new_value FROM audit_logs WHERE entity_type='positions' AND entity_id=$1 AND action='SOFT_DELETE'",[positionId])).rows[0].new_value.status,'INACTIVE');
    await call('Ngừng chức danh đã INACTIVE','DELETE',`/${positionId}`,undefined,409);
    await client.query("UPDATE employees SET employment_status='ACTIVE' WHERE employee_code='TEST_EMP_1'");
    const empty=await call('Cho ngừng chức danh không có nhân viên, không bị ảnh hưởng bởi chức danh khác','DELETE',`/${other.data.id}`,undefined,200);
    assert.equal(empty.data.status,'INACTIVE');
    await call('Ngừng chức danh không tồn tại','DELETE','/2147483647',undefined,404);
    await call('Ngừng chức danh ID sai','DELETE','/abc',undefined,400);
    await call('Ngừng chức danh không có token','DELETE',`/${positionId}`,undefined,401,null);
    await call('Admin không được ngừng chức danh','DELETE',`/${positionId}`,undefined,403,adminToken);
  } finally {
    const dir=path.join(__dirname,'../docs'); fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'positions-create-test-results.json'),JSON.stringify({date:'2026-11-03',environment:'HTTP/JWT thật, PostgreSQL TEMP theo schema hiện tại, FK thật trên bảng TEMP; không thay đổi dữ liệu thật',results},null,2));
    const text='# Positions — Kiểm thử tạo chức danh thuộc phòng ban\n\nNgày 03/11/2026. HTTP/JWT thật và PostgreSQL TEMP theo schema database hiện tại. Có ràng buộc khóa ngoại trên bảng TEMP. Không thay đổi dữ liệu thật.\n\n'+results.map(r=>`## ${r.label}\n\nAPI: \`${r.method} ${r.url}\`.\n\n`+(r.request?'Dữ liệu gửi:\n\n```json\n'+JSON.stringify(r.request,null,2)+'\n```\n\n':'')+`HTTP trả về: **${r.actual}** (mong đợi ${r.expected}).\n\nNội dung trả về:\n\n\`\`\`json\n${JSON.stringify(r.response,null,2)}\n\`\`\`\n`).join('\n')+'\nĐã kiểm tra thêm: department_id được lưu đúng trong positions và audit log, validation thất bại không tạo positions/audit log, lọc theo phòng ban không lẫn dữ liệu phòng ban khác.\n';
    fs.writeFileSync(path.join(dir,'positions-create-api-test-results.md'),text);
    const deleteResults=results.filter(row=>row.method==='DELETE');
    fs.writeFileSync(path.join(dir,'positions-delete-api-test-results.md'),'# Ngừng hoạt động chức danh\n\nAPI: `DELETE /api/positions/:id`. Cần access token của HR.\n\nChặn nếu còn bất kỳ nhân viên nào gắn với chức danh có employment_status khác INACTIVE (bao gồm ACTIVE và IN_PROCESS). Chỉ cho ngừng khi không có nhân viên hoặc tất cả đều INACTIVE. API chuyển chức danh sang INACTIVE, không xóa vật lý.\n\nĐã test bằng HTTP/JWT thật và PostgreSQL TEMP theo schema hiện tại, không thay đổi dữ liệu thật. Các case bị chặn không đổi status chức danh và không thêm audit log; case thành công có audit log, giữ nguyên nhân viên.\n\n'+deleteResults.map(row=>`## ${row.label}\n\nAPI: \`${row.method} ${row.url}\`.\n\nHTTP trả về: **${row.actual}** (mong đợi ${row.expected}).\n\n\`\`\`json\n${JSON.stringify(row.response,null,2)}\n\`\`\`\n`).join('\n'));
    if(server)await new Promise(resolve=>server.close(resolve)); if(client)client.release(); await databasePool.end();
  }
});
