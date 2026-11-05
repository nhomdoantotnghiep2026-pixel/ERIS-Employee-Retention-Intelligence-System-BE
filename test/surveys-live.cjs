// Credentials enter via process environment; reports never contain tokens/passwords.
const fs = require('node:fs');
const path = require('node:path');
const { databasePool: pool } = require('../src/config/database');
const endpoints = [
  ['POST','/api/surveys'],['GET','/api/surveys'],['GET','/api/surveys/:id'],['PATCH','/api/surveys/:id'],
  ['POST','/api/surveys/:id/publish'],['POST','/api/surveys/:id/close'],['GET','/api/surveys/available'],
  ['POST','/api/surveys/:id/responses'],['GET','/api/surveys/:id/my-response'],
  ['GET','/api/surveys/:id/results'],['GET','/api/surveys/:id/responses'],['GET','/api/surveys/:id/responses/:responseId']
];
async function preflight() {
  return {
    columns: (await pool.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name IN ('users','survey_questions','survey_answers','survey_responses')
      ORDER BY table_name,ordinal_position`)).rows,
    questions: (await pool.query('SELECT id,question_text,display_order FROM survey_questions ORDER BY display_order,id')).rows,
    accounts: (await pool.query(`SELECT u.email,u.status,r.name AS role,u.employee_id,e.employment_status,e.hire_date,
      (e.employment_status='ACTIVE' AND e.hire_date <= CURRENT_DATE-INTERVAL '3 months') AS eligible
      FROM users u JOIN role r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id
      WHERE u.email IN ($1,$2)`,[process.env.SURVEY_TEST_HR_EMAIL,process.env.SURVEY_TEST_EMP_EMAIL])).rows
  };
}
if(process.argv.includes('--preflight')) {
  preflight().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
} else run().catch(e=>{console.error(e.message);process.exitCode=1});

async function run() {
  const { app } = require('../src/app');
  const { redisClient } = require('../src/config/redis');
  const { mailTransporter } = require('../src/config/mail');
  const startedAt = new Date().toISOString(), tag = `QA-SURVEY-${Date.now()}`;
  const cases=[], fixtures=[], tokens={}, cookies={};
  let server,base,context;
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  function clean(x) {
    if(Array.isArray(x))return x.map(clean);
    if(x && typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/password|token|cookie|authorization/i.test(k)?'[REDACTED]':clean(v)]));
    return x;
  }
  async function check(n,name,actor,route,body,expected,verify,method) {
    method=method || endpoints[n-1]?.[0] || 'POST';
    const group=n?`${endpoints[n-1][0]} ${endpoints[n-1][1]}`:'AUTH';
    if(!['NONE','INVALID'].includes(actor)&&!tokens[actor]) {
      cases.push({group,name,actor,outcome:'BLOCKED',detail:'Không có access token hợp lệ.'});return null;
    }
    try {
      const res=await fetch(base+route,{method,headers:{'content-type':'application/json',
        ...(actor==='INVALID'?{authorization:'Bearer invalid-token'}:tokens[actor]?{authorization:`Bearer ${tokens[actor]}`}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
      const response=await res.json().catch(()=>null);let detail=response?.message||'';
      let passed=res.status===expected;
      if(passed&&verify)try{verify(response)}catch(e){passed=false;detail=e.message}
      cases.push({group,name,actor,method,route,request:clean(body),expected,actual:res.status,outcome:passed?'PASS':'FAIL',detail,response:clean(response)});
      return {status:res.status,data:response,cookie:res.headers.get('set-cookie')};
    }catch(e){cases.push({group,name,actor,method,route,expected,outcome:'FAIL',detail:e.message});return null}
  }
  const block=(n,name,detail)=>cases.push({group:`${endpoints[n-1][0]} ${endpoints[n-1][1]}`,name,outcome:'BLOCKED',detail});
  const batch=async(n,actor,tests)=>{for(const row of tests)await check(n,row[0],actor,...row.slice(1))};
  const missing=2147483647;
  const dates={startDate:new Date(Date.now()-60000).toISOString(),endDate:new Date(Date.now()+3600000).toISOString()};
  async function create(name,extra={}) {
    const r=await check(1,`Tạo fixture: ${name}`,'HR','/api/surveys',{title:`[${tag}] ${name}`,description:'Dữ liệu test API, không phải khảo sát chính thức.',...extra},201,
      x=>assert(x.data.questions.length===12,'Phải có 12 câu hỏi chung.'));
    if(r?.status===201){fixtures.push(r.data.data.id);return r.data.data}return null;
  }
  try {
    context=await preflight();
    cases.push({group:'SETUP',name:'Bộ câu hỏi đúng 12 câu',expected:12,actual:context.questions.length,
      outcome:context.questions.length===12?'PASS':'FAIL',detail:context.questions.length===12?'':'DB còn câu cũ; bộ dùng chung hiện chứa cả câu cũ và mới.'});
    const oldColumn=context.columns.some(c=>c.table_name==='survey_answers'&&c.column_name==='survey_id');
    cases.push({group:'SETUP',name:'survey_answers đã bỏ survey_id',expected:'Không có survey_id',actual:oldColumn?'Còn survey_id':'Không có survey_id',
      outcome:oldColumn?'FAIL':'PASS',detail:oldColumn?'Schema thật chưa khớp thiết kế/backend mới.':''});
    const hashColumn=context.columns.some(c=>c.table_name==='users'&&c.column_name==='password_hash');
    cases.push({group:'SETUP',name:'Cột mật khẩu khớp AuthRepository',expected:'users.password_hash tồn tại',actual:hashColumn?'Có password_hash':'Không có password_hash',
      outcome:hashColumn?'PASS':'FAIL',detail:hashColumn?'':'AuthRepository truy vấn users.password_hash nhưng DB không có cột này, gây HTTP 500 khi login. Không đọc/in giá trị mật khẩu hoặc hash.'});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
    for(const actor of ['HR','EMP']) {
      const email=process.env[`SURVEY_TEST_${actor}_EMAIL`],password=process.env[`SURVEY_TEST_${actor}_PASSWORD`];
      if(!email||!password)throw Error('Thiếu biến môi trường tài khoản test.');
      const r=await check(0,`Đăng nhập ${actor}`,'NONE','/api/auth/login',{email,password},200,x=>assert(!!x.accessToken,'Chưa có accessToken; kiểm tra IN_PROCESS.'));
      if(r?.data?.accessToken){tokens[actor]=r.data.accessToken;cookies[actor]=r.cookie?.split(';')[0]}
    }
    await check(0,'Login thiếu email/password','NONE','/api/auth/login',{},400);
    await check(0,'Login email sai định dạng','NONE','/api/auth/login',{email:'invalid',password:'invalid-test-value'},400);
    for(let n=1;n<=12;n++)for(const actor of ['NONE','INVALID'])await check(n,`Auth ${actor}`,actor,
      endpoints[n-1][1].replace(':id','2147483647').replace(':responseId','2147483647'),
      ['POST','PATCH'].includes(endpoints[n-1][0])?{}:undefined,401);
    if(!tokens.HR||!tokens.EMP){
      for(let n=1;n<=12;n++)block(n,'Happy path và lỗi nghiệp vụ cần token thật','Đăng nhập thật trả lỗi; chưa có token. Xem lỗi AUTH/SETUP và ma trận case trong surveys-api-guide.md.');
      return;
    }
    const main=await create('Happy lifecycle',dates),other=await create('Draft isolation');
    const expired=await create('Expired schedule',{startDate:'2000-01-01T00:00:00Z',endDate:'2000-01-02T00:00:00Z'});
    const future=await create('Future schedule',{startDate:new Date(Date.now()+86400000).toISOString(),endDate:new Date(Date.now()+172800000).toISOString()});
    if(!main)throw Error('Không tạo được fixture chính; không thể chạy các case phụ thuộc.');
    assert(!(await pool.query('SELECT id FROM surveys WHERE id=$1',[missing])).rowCount,'ID dùng cho not-found đã tồn tại.');
    const id=main.id,root=`/api/surveys/${id}`;
    const employee=context.accounts.find(a=>a.email===process.env.SURVEY_TEST_EMP_EMAIL);
    const hr=context.accounts.find(a=>a.email===process.env.SURVEY_TEST_HR_EMAIL);
    const eligible=employee?.status==='ACTIVE'&&employee?.eligible===true;
    await batch(1,'HR',[
      ['Thiếu title','/api/surveys',{},400],['Title rỗng','/api/surveys',{title:' '},400],
      ['Title quá dài','/api/surveys',{title:'x'.repeat(256)},400],['Body array','/api/surveys',[],400],
      ['Trường lạ','/api/surveys',{title:'QA invalid',status:'ACTIVE'},400],
      ['Description sai kiểu','/api/surveys',{title:'QA invalid',description:1},400],
      ['Ngày sai','/api/surveys',{title:'QA invalid',startDate:'invalid'},400],
      ['Ngày kết thúc trước bắt đầu','/api/surveys',{title:'QA invalid',startDate:'2030-01-02',endDate:'2030-01-01'},400]
    ]);
    await batch(1,'EMP',[['Employee không được tạo','/api/surveys',{title:'QA forbidden'},403]]);
    await batch(2,'HR',[['Danh sách HR','/api/surveys',undefined,200,x=>assert(x.data.some(s=>s.id===id&&s.questionCount===12),'Thiếu fixture hoặc bộ câu chung.')]]);
    await batch(2,'EMP',[['Employee bị chặn','/api/surveys',undefined,403]]);
    await batch(3,'HR',[
      ['HR xem draft',root,undefined,200],['Không tồn tại',`/api/surveys/${missing}`,undefined,404],
      ...['0','-1','abc','1e0','2147483648'].map(v=>[`ID sai ${v}`,`/api/surveys/${v}`,undefined,400])
    ]);
    await batch(4,'HR',[
      ['Sửa draft',root,{description:`[${tag}] Updated`},200],['Body trống',root,{},400],['Title null',root,{title:null},400],
      ['Không sửa status trực tiếp',root,{status:'ACTIVE'},400],['Ngày trước lịch đã lưu',root,{endDate:'1999-01-01T00:00:00Z'},400],
      ['Không tồn tại',`/api/surveys/${missing}`,{title:'QA missing'},404],['ID sai','/api/surveys/abc',{title:'QA invalid'},400]
    ]);
    await batch(4,'EMP',[['Employee bị chặn',root,{title:'QA forbidden'},403]]);
    if(other)await batch(5,'HR',[['Thiếu lịch',`/api/surveys/${other.id}/publish`,{},400]]);
    if(expired)await batch(5,'HR',[['Lịch hết hạn',`/api/surveys/${expired.id}/publish`,{},400]]);
    await batch(5,'EMP',[['Employee bị chặn',root+'/publish',{},403]]);
    await batch(5,'HR',[
      ['Publish thành công',root+'/publish',{},200],['Publish lần hai',root+'/publish',{},409],
      ['Không tồn tại',`/api/surveys/${missing}/publish`,{},404],['ID sai','/api/surveys/abc/publish',{},400]
    ]);
    if(future)await batch(5,'HR',[['Publish lịch tương lai',`/api/surveys/${future.id}/publish`,{},200]]);
    await batch(4,'HR',[['Không sửa ACTIVE',root,{title:'QA active'},409]]);
    await batch(7,'EMP',[['Danh sách available theo điều kiện tài khoản','/api/surveys/available',undefined,eligible?200:403,x=>{
      if(eligible){assert(x.data.some(s=>s.id===id),'Thiếu survey mở.');if(future)assert(!x.data.some(s=>s.id===future.id),'Lộ survey tương lai.');}
    }]]);
    await batch(7,'HR',[['HR theo employee profile','/api/surveys/available',undefined,hr?.status==='ACTIVE'&&hr?.employee_id&&hr?.eligible?200:403]]);
    await batch(3,'EMP',[['Employee xem survey mở',root,undefined,eligible?200:403]]);
    if(other)await batch(3,'EMP',[['Không xem draft',`/api/surveys/${other.id}`,undefined,eligible?409:403]]);
    if(future)await batch(3,'EMP',[['Không xem trước lịch',`/api/surveys/${future.id}`,undefined,eligible?409:403]]);
    const answers=main.questions.map((q,i)=>({questionId:q.id,score:i?4:5,comment:i?null:`[${tag}] test comment`}));
    await batch(8,'EMP',[
      ['Thiếu answers',root+'/responses',{},400],['Answers sai kiểu',root+'/responses',{answers:{}},400],
      ...[4.5,0,6,'5',null].map(v=>[`Điểm không hợp lệ ${JSON.stringify(v)}`,root+'/responses',{answers:[{...answers[0],score:v}]},400]),
      ['Trùng câu',root+'/responses',{answers:[answers[0],answers[0]]},400],
      ['QuestionId sai kiểu',root+'/responses',{answers:[{...answers[0],questionId:'1'}]},400],
      ['Comment sai kiểu',root+'/responses',{answers:[{...answers[0],comment:1}]},400],
      ['Comment quá dài',root+'/responses',{answers:[{...answers[0],comment:'x'.repeat(1001)}]},400],
      ['Chèn employeeId',root+'/responses',{answers,employeeId:1},400],
      ['Thiếu một câu',root+'/responses',{answers:answers.slice(1)},eligible?400:403],
      ['Answers rỗng',root+'/responses',{answers:[]},eligible?400:403],
      ['Câu ngoài bộ chung',root+'/responses',{answers:[{...answers[0],questionId:missing},...answers.slice(1)]},eligible?400:403],
      ['Không tồn tại',`/api/surveys/${missing}/responses`,{answers},eligible?404:403],
      ['ID sai','/api/surveys/abc/responses',{answers},400]
    ]);
    if(other)await batch(8,'EMP',[['Không submit draft',`/api/surveys/${other.id}/responses`,{answers},eligible?409:403]]);
    if(future)await batch(8,'EMP',[['Không submit trước lịch',`/api/surveys/${future.id}/responses`,{answers},eligible?409:403]]);
    await batch(9,'EMP',[['Chưa submit',root+'/my-response',undefined,employee?.employee_id&&employee?.status==='ACTIVE'?404:403],['ID sai','/api/surveys/abc/my-response',undefined,400]]);
    let responseId;
    if(eligible){
      const result=await check(8,'Submit đủ 12 câu','EMP',root+'/responses',{answers},201,x=>assert(x.data.satisfactionScore===4.0833,'Điểm trung bình phải là 4.0833.'));
      if(result?.status===201)responseId=result.data.data.responseId;
      await batch(8,'EMP',[['Submit lần hai',root+'/responses',{answers},409]]);
      await batch(9,'EMP',[['Xem bài của mình',root+'/my-response',undefined,200,x=>assert(x.data.answers.length===12&&x.data.response.satisfactionScore===4.0833,'Sai bài hoặc điểm.')]]);
      await batch(7,'EMP',[['Loại survey đã submit','/api/surveys/available',undefined,200,x=>assert(!x.data.some(s=>s.id===id),'Available còn bài đã nộp.')]]);
    }else {
      block(8,'Happy submit/gửi trùng','Employee chưa đủ điều kiện ACTIVE và đủ 3 tháng. Không sửa hồ sơ để vượt kiểm tra.');
      block(7,'Happy available cho người đủ điều kiện','Employee chưa đủ 3 tháng; HR không có employee profile.');
      block(9,'Happy xem bài đã gửi','Không thể tạo bài gửi bằng tài khoản Employee hiện tại.');
    }
    await batch(10,'HR',[
      ['Thống kê survey test',root+'/results',undefined,200,x=>{assert(x.data.questions.length===12,'Thiếu câu.');if(responseId)assert(x.data.questions[0].scoreDistribution[5]===1,'Phân bố điểm 5 sai.')}],
      ['Không tồn tại',`/api/surveys/${missing}/results`,undefined,404],['ID sai','/api/surveys/abc/results',undefined,400]
    ]);
    if(other)await batch(10,'HR',[['Không lẫn survey khác',`/api/surveys/${other.id}/results`,undefined,200,x=>assert(x.data.responseCount===0&&x.data.questions.every(q=>q.answerCount===0&&q.averageScore===null),'Kết quả lẫn survey.')]]);
    await batch(10,'EMP',[['Employee bị chặn',root+'/results',undefined,403]]);
    await batch(11,'HR',[
      ['Danh sách bài',root+'/responses',undefined,200],['Không tồn tại',`/api/surveys/${missing}/responses`,undefined,404],['ID sai','/api/surveys/abc/responses',undefined,400]
    ]);
    if(other)await batch(11,'HR',[['Survey chưa có bài',`/api/surveys/${other.id}/responses`,undefined,200,x=>assert(!x.data.participants.length,'Survey trống có bài.')]]);
    await batch(11,'EMP',[['Employee bị chặn',root+'/responses',undefined,403]]);
    await batch(12,'HR',[
      ['Response không tồn tại',`${root}/responses/${missing}`,undefined,404],['Response ID sai',root+'/responses/abc',undefined,400],['Survey ID sai','/api/surveys/abc/responses/1',undefined,400]
    ]);
    await batch(12,'EMP',[['Employee không dùng API HR',`${root}/responses/${responseId||1}`,undefined,403]]);
    if(responseId){
      await batch(12,'HR',[['Chi tiết bài',`${root}/responses/${responseId}`,undefined,200,x=>assert(x.data.response.answers.length===12&&x.data.response.satisfactionScore===4.0833,'Chi tiết sai.')]]);
      if(other)await batch(12,'HR',[['Response thuộc survey khác',`/api/surveys/${other.id}/responses/${responseId}`,undefined,404]]);
    }else block(12,'Happy xem chi tiết bài','Không có responseId từ submit thành công.');
    await batch(6,'EMP',[['Employee bị chặn',root+'/close',{},403]]);
    if(other)await batch(6,'HR',[['Không đóng draft',`/api/surveys/${other.id}/close`,{},409]]);
    await batch(6,'HR',[
      ['Close thành công',root+'/close',{},200],['Close lần hai',root+'/close',{},200],
      ['Không tồn tại',`/api/surveys/${missing}/close`,{},404],['ID sai','/api/surveys/abc/close',{},400]
    ]);
    await batch(5,'HR',[['Không publish CLOSED',root+'/publish',{},409]]);
    await batch(4,'HR',[['Không sửa CLOSED',root,{title:'QA closed'},409]]);
    await batch(8,'EMP',[['Không submit CLOSED',root+'/responses',{answers},eligible?409:403]]);
    if(responseId)await batch(9,'EMP',[['Xem bài sau đóng',root+'/my-response',undefined,200]]);
  }catch(e){cases.push({group:'RUN',name:'Run error',outcome:'FAIL',detail:e.message})}
  finally {
    // Close only fixtures created by this run. Leave records for reviewer inspection.
    for(const id of fixtures){
      const state=await pool.query('SELECT status FROM surveys WHERE id=$1',[id]);
      if(state.rows[0]?.status==='ACTIVE')await check(6,'Cleanup đóng fixture ACTIVE','HR',`/api/surveys/${id}/close`,{},200);
    }
    for(const actor of Object.keys(cookies))if(cookies[actor])await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:cookies[actor]}}).catch(()=>{});
    const states=fixtures.length?(await pool.query('SELECT id,title,status FROM surveys WHERE id=ANY($1::integer[]) ORDER BY id',[fixtures])).rows:[];
    const summary=Object.fromEntries(['PASS','FAIL','BLOCKED'].map(k=>[k,cases.filter(c=>c.outcome===k).length]));
    const dir=path.join(__dirname,'../docs');fs.mkdirSync(dir,{recursive:true});
    const report={startedAt,finishedAt:new Date().toISOString(),tag,baseUrl:base,context,fixtures:states,summary,cases};
    fs.writeFileSync(path.join(dir,'surveys-api-live-test.json'),JSON.stringify(report,null,2));
    const esc=v=>String(v??'—').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
    const lines=['# Báo cáo kiểm thử Survey API','',`Ngày chạy: ${new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} (Asia/Saigon).`,'',
      'Chạy Express từ code workspace trên cổng localhost tạm; dùng database và Redis trong `.env`, đăng nhập thật và middleware JWT thật. Không mock quyền truy cập.',
      '',`**${summary.PASS} PASS · ${summary.FAIL} FAIL · ${summary.BLOCKED} BLOCKED**`,'',
      'Phạm vi: 12 API survey và đăng nhập phục vụ test. Không phải các module khác của backend. Mật khẩu và token đã bị loại khỏi tài liệu. Contract và toàn bộ ma trận happy/error cases xem [surveys-api-guide.md](surveys-api-guide.md).',
      '', '## Tài khoản thực tế','','| Email | Role | Status | Employee | Đủ điều kiện tham gia |','|---|---|---|---|---|',
      ...(context?.accounts||[]).map(a=>`| ${a.email} | ${a.role} | ${a.status} | ${a.employee_id??'Không có'} | ${a.eligible??false} |`),
      '',`Đọc trực tiếp DB: ${context?.questions?.length??0} câu hỏi chung. Điểm từng câu nguyên 1–5; trung bình là số thập phân.`,'',
      '## Fixture đã tạo','','Không thay đổi tài khoản, ngày vào làm, bộ câu hỏi hoặc khảo sát công ty có sẵn. Chỉ thao tác fixture có tiền tố QA-SURVEY của lần chạy này; giữ lại để đối chiếu. Fixture đã publish được đóng sau test.',
      '','| ID | Tiêu đề | Trạng thái cuối |','|---|---|---|',...states.map(s=>`| ${s.id} | ${esc(s.title)} | ${s.status} |`),
      '', '## Cách đọc kết quả','','PASS: HTTP và kiểm tra dữ liệu khớp kỳ vọng. FAIL: khác kỳ vọng hoặc lỗi hệ thống. BLOCKED: thiếu điều kiện, chưa chứng minh được case. Request/response thực tế đầy đủ xem `surveys-api-live-test.json` cùng thư mục.'];
    for(const group of ['SETUP','AUTH',...endpoints.map(e=>e.join(' '))]){
      const rows=cases.filter(c=>c.group===group);lines.push('',`## ${group}`,'','| Case | Actor | Expected | Actual | Kết quả | Ghi nhận |','|---|---|---|---|---|---|',
        ...rows.map(c=>`| ${esc(c.name)} | ${esc(c.actor)} | ${esc(c.expected)} | ${esc(c.actual)} | ${c.outcome} | ${esc(c.detail)} |`));
      const happy=rows.find(c=>c.actual<400&&c.outcome==='PASS');
      if(happy&&group!=='AUTH'){
        lines.push('','Request thành công đã chạy:','','```http',`${happy.method} ${happy.route}`,'Authorization: Bearer <accessToken>','```');
        if(happy.request!==undefined)lines.push('','```json',JSON.stringify(happy.request,null,2),'```');
        const response=JSON.stringify(happy.response,null,2);
        if(response.length<14000)lines.push('','Response thực tế:','','```json',response,'```');
        else lines.push('','Response đầy đủ xem case tương ứng trong JSON artifact.');
      }
    }
    lines.push('','## Case lỗi hoặc chưa chạy được','',...cases.filter(c=>c.outcome!=='PASS').map(c=>`- **${c.outcome}** ${c.group}: ${c.name} — ${c.detail}`),
      '', '## Các điều kiện cần giải quyết để chạy happy path','',
      '- Đăng nhập: thống nhất tên cột mật khẩu giữa AuthRepository và users. Hiện query users.password_hash không chạy được; chưa thể kết luận mật khẩu hai tài khoản đúng hay sai.',
      '- Bộ câu hỏi: DB có cả 8 câu cũ và 12 câu mới, tổng 20 câu, với display_order bị trùng 1–8. Cần xác định cách xử lý câu cũ và bảo toàn câu trả lời lịch sử trước khi đổi dữ liệu.',
      '- survey_answers vẫn còn survey_id. Chưa tự migration; cần kiểm tra constraint/trigger còn phụ thuộc cột trước khi bỏ.',
      '- Employee có ngày vào làm 03/11/2026 theo giờ Việt Nam, chưa đủ ba tháng tại ngày kiểm thử. HR không có employee profile. Cần tài khoản test đủ điều kiện để chứng minh happy path tham gia; không tự thay ngày vào làm.',
      '- Lần chạy này chưa tạo survey hoặc response nào; các kiểm tra thành công là 24 case 401 trên 12 endpoint và 2 case validation login 400, không phải happy path của 12 nghiệp vụ.',
      '', '## Giới hạn kiểm thử','','Không sửa hồ sơ nhân viên để giả lập INACTIVE hoặc chưa đủ ba tháng; không xóa bộ câu hỏi để test bộ rỗng. Chưa test tải, race condition, lỗi mạng hoặc mọi trạng thái DB. Các lỗi dùng expected 403 do tài khoản không đủ điều kiện không chứng minh được luồng nghiệp vụ sâu hơn.',
      '', '## Chạy lại','','Cấp biến môi trường SURVEY_TEST_HR_EMAIL, SURVEY_TEST_HR_PASSWORD, SURVEY_TEST_EMP_EMAIL, SURVEY_TEST_EMP_PASSWORD rồi chạy `node test/surveys-live.cjs`. Mỗi lần tạo fixture mới và ghi đè hai báo cáo. Không ghi mật khẩu vào repo.');
    fs.writeFileSync(path.join(dir,'surveys-api-live-test.md'),lines.join('\n')+'\n');
    console.log(JSON.stringify({summary,fixtures:states.map(s=>({id:s.id,status:s.status})),report:path.join(dir,'surveys-api-live-test.md')}));
    if(server)await new Promise(r=>server.close(r));redisClient.disconnect();mailTransporter.close?.();await pool.end();
    if(summary.FAIL)process.exitCode=1;
  }
}
