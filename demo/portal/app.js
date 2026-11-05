(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let token='',setupToken='',actor=null,session=0,busy=false,openedSurvey=null;
  const operations=[
    ['employees','HR','Danh sách nhân viên','/api/employees'],
    ['employee','HR','Chi tiết một nhân viên','/api/employees/{id}'],
    ['departments','HR','Danh sách phòng ban','/api/departments'],
    ['positions','HR','Danh sách vị trí','/api/positions'],
    ['educations','HR','Tất cả bằng cấp','/api/employee-educations'],
    ['histories','HR','Tất cả lịch sử công việc','/api/job-histories'],
    ['employeeHistory','HR','Lịch sử công việc của một nhân viên','/api/employees/{id}/job-histories'],
    ['surveys','HR','Danh sách khảo sát','/api/surveys'],
    ['surveyResults','HR','Kết quả tổng hợp khảo sát','/api/surveys/{id}/results'],
    ['surveyParticipants','HR','Nhân viên tham gia và từng câu trả lời','/api/surveys/{id}/responses'],
    ['attendance','HR','Danh sách chấm công','/api/v1/attendance'],
    ['attendanceDetail','HR','Chi tiết một bản ghi chấm công','/api/v1/attendance/{id}'],
    ['users','ADMIN','Danh sách tài khoản','/api/users'],
    ['user','ADMIN','Chi tiết tài khoản','/api/users/{id}'],
    ['audits','ADMIN','Danh sách audit log','/api/audit-logs'],
    ['audit','ADMIN','Chi tiết audit log','/api/audit-logs/{id}'],
    ['me','ADMIN,HR,EMPLOYEE','Tài khoản của tôi','/api/auth/me'],
    ['myProfile','HR,EMPLOYEE','Hồ sơ của tôi','/api/employees/me'],
    ['myEducation','HR,EMPLOYEE','Học vấn của tôi','/api/employees/me/educations'],
    ['myHistory','HR,EMPLOYEE','Lịch sử công việc của tôi','/api/employees/me/job-histories'],
    ['available','HR,EMPLOYEE','Khảo sát tôi được làm','/api/surveys/available'],
    ['myResponse','HR,EMPLOYEE','Câu trả lời khảo sát tôi đã nộp','/api/surveys/{id}/my-response']
  ];
  function notify(text,kind='error'){$('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text;}
  function redact(value){
    if(Array.isArray(value))return value.map(redact);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:password|token|secret|otp|cookie)/i.test(key)).map(([key,item])=>[key,redact(item)]));
    return value;
  }
  function show(data,status,method,url){
    $('httpStatus').textContent='HTTP '+status;$('endpoint').textContent=method+' '+url;
    $('response').textContent=JSON.stringify(redact(data),null,2);$('summary').textContent='';$('dataRows').replaceChildren();
    if(data.created!==undefined)$('summary').textContent=`Tổng ${data.total} · Đã tạo ${data.created} · Lỗi ${data.failed}`;
    const rows=data.data?.participants||data.results||(Array.isArray(data.data)?data.data:[]);
    for(const item of rows.slice(0,200)){
      const box=document.createElement('details');box.className='summary-item';
      const title=document.createElement('summary');title.textContent=item.employee?.fullName||item.fullName||item.name||item.title||item.email||(item.row?'Dòng '+item.row:'Bản ghi '+(item.id??item.responseId??''));
      const detail=document.createElement('pre');detail.textContent=JSON.stringify(redact(item),null,2);box.append(title,detail);$('dataRows').append(box);
    }
  }
  async function api(url,{method='GET',body,access=token}={}){
    const generation=session,isFile=body instanceof FormData;
    let response;
    try{response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(access?{Authorization:'Bearer '+access}:{}),...(body&&!isFile?{'Content-Type':'application/json'}:{})},...(body?{body:isFile?body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Không kết nối được backend. Kiểm tra terminal và chạy lại project.');}
    const data=await response.json().catch(()=>({message:'Phản hồi không phải JSON.'}));
    if(generation!==session)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(response.status===401&&access===token&&token){resetSession();notify('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');}
    if(!response.ok){const error=new Error(data.message||data.error?.message||'HTTP '+response.status);error.status=response.status;error.data=data;throw error;}
    return {data,status:response.status};
  }
  function lock(value){busy=value;for(const button of document.querySelectorAll('form button'))button.disabled=value;}
  function resetSession(){session++;token='';setupToken='';actor=null;openedSurvey=null;$('questions').replaceChildren();$('answerSurvey').hidden=true;$('workspace').hidden=true;$('loginPanel').hidden=false;$('activation').hidden=true;$('activation').reset();$('response').textContent='';$('dataRows').replaceChildren();$('summary').textContent='';$('httpStatus').textContent='Chưa gửi';$('endpoint').textContent='Kết quả hiện tại của phiên đăng nhập.';for(const form of $('workspace').querySelectorAll('form'))form.reset();$('department').replaceChildren(new Option('Chọn phòng ban',''));}
  async function departments(){
    const {data}=await api('/api/departments');
    $('department').replaceChildren(new Option('Chọn phòng ban',''));
    for(const row of data.data||[])if(row.status==='ACTIVE')$('department').append(new Option(row.name,String(row.id)));
  }
  function readIdState(){const op=operations.find(o=>o[0]===$('readOperation').value);const required=!!op?.[3].includes('{id}');$('recordIdLabel').hidden=!required;$('recordId').required=required;}
  function openWorkspace(){
    $('loginPanel').hidden=true;$('workspace').hidden=false;$('identity').textContent=`${actor.fullName||actor.email||'Tài khoản'} · ${actor.role}`;
    for(const panel of document.querySelectorAll('[data-roles]'))panel.hidden=!panel.dataset.roles.split(',').includes(actor.role);
    $('readOperation').replaceChildren();
    for(const op of operations.filter(o=>o[1].split(',').includes(actor.role)))$('readOperation').append(new Option(op[2],op[0]));
    readIdState();
  }
  async function perform(form,url,body,success){
    if(busy)return;const generation=session;lock(true);notify('Đang xử lý…','info');
    try{const {data,status}=await api(url,{method:'POST',body});if(generation!==session)return;show(data,status,'POST',url);notify(data.data?.warning||success,'success');form.reset();}
    catch(error){if(generation!==session)return;if(error.status)show(error.data,error.status,'POST',url);notify(error.message);}
    finally{lock(false);}
  }
  $('login').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;resetSession();lock(true);notify('Đang đăng nhập…','info');
    const generation=session,values=new FormData($('login'));
    try{
      const {data}=await api('/api/auth/login',{method:'POST',access:'',body:{email:String(values.get('email')).trim(),password:values.get('password')}});
      $('login').elements.password.value='';if(generation!==session)return;
      if(data.passwordChangeToken){setupToken=data.passwordChangeToken;$('activation').hidden=false;notify('Tài khoản đang IN_PROCESS. Nhập OTP trong email để kích hoạt.','info');return;}
      if(!data.accessToken)throw new Error('Chưa nhận được access token.');token=data.accessToken;
      actor=(await api('/api/auth/me')).data;openWorkspace();notify('Đã đăng nhập. Chọn thao tác cần thử.','success');
      if(actor.role==='HR')try{await departments();}catch(error){notify('Đăng nhập thành công nhưng chưa tải được phòng ban: '+error.message);}
    }catch(error){if(generation===session){resetSession();notify(error.message);}}
    finally{lock(false);}
  });
  $('activation').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!setupToken)return;lock(true);const generation=session,values=new FormData(event.currentTarget);
    try{await api('/api/auth/change-password',{method:'PATCH',access:setupToken,body:{otp:values.get('otp'),newPassword:values.get('newPassword')}});if(generation!==session)return;resetSession();notify('Đã kích hoạt. Đăng nhập lại bằng mật khẩu mới.','success');}
    catch(error){if(generation===session)notify(error.message);}finally{lock(false);}
  });
  $('logout').onclick=async()=>{if(busy)return;resetSession();$('login').reset();notify('Đã xóa phiên trên màn hình.','success');try{await api('/api/auth/logout',{method:'POST',access:''});}catch{notify('Đã xóa phiên trên màn hình; chưa xác nhận được đăng xuất với máy chủ.');}};
  $('register').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,values=new FormData(form);perform(form,'/api/auth/user_register',{full_name:String(values.get('full_name')).trim(),email:String(values.get('email')).trim()},'Đã tạo HR. Kiểm tra email và trạng thái gửi thư trong kết quả.');});
  $('position').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,values=new FormData(form);perform(form,'/api/positions',{name:String(values.get('name')).trim(),jobLevel:Number(values.get('jobLevel')),departmentId:Number(values.get('departmentId')),description:String(values.get('description')).trim()||null},'Đã tạo vị trí. Có thể tải lại danh sách vị trí để kiểm tra.');});
  $('reloadDepartments').onclick=async()=>{if(busy)return;lock(true);try{await departments();notify('Đã tải lại phòng ban ACTIVE.','success');}catch(error){notify(error.message);}finally{lock(false);}};
  $('import').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget,file=form.elements.file.files[0];
    if(!file||!/\.xlsx$/i.test(file.name)||file.size>5*1024*1024)return notify('Chọn file .xlsx không quá 5 MB.');
    perform(form,'/api/employees/import',new FormData(form),'Đã nhận kết quả import. Kiểm tra từng dòng trước khi chạy lại.');
  });
  $('survey').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,values=new FormData(form);const start=new Date(values.get('startDate')),end=new Date(values.get('endDate'));if(end<start)return notify('Ngày kết thúc phải từ ngày bắt đầu trở đi.');perform(form,'/api/surveys',{title:String(values.get('title')).trim(),description:String(values.get('description')).trim()||null,startDate:start.toISOString(),endDate:end.toISOString()},'Đã tạo khảo sát DRAFT. Dùng ID trong kết quả để phát hành.');});
  $('publish').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,id=Number(new FormData(form).get('surveyId'));if(!Number.isInteger(id)||id<=0||id>2147483647)return notify('ID khảo sát không hợp lệ.');perform(form,`/api/surveys/${id}/publish`,undefined,'Đã phát hành khảo sát.');});
  $('loadSurvey').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const id=Number(new FormData(event.currentTarget).get('surveyId'));if(!Number.isInteger(id)||id<=0||id>2147483647)return notify('ID khảo sát không hợp lệ.');
    openedSurvey=null;$('questions').replaceChildren();$('answerSurvey').hidden=true;const generation=session;lock(true);const url='/api/surveys/'+id;
    try{
      const {data,status}=await api(url);if(generation!==session)return;const survey=data.data;
      if(!Array.isArray(survey?.questions))throw new Error('Không nhận được danh sách câu hỏi.');
      openedSurvey=survey;$('surveyTitle').textContent=survey.title;
      for(const question of survey.questions){
        const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=question.questionText+(question.required?' *':'');group.append(title);
        const label=document.createElement('label');label.textContent='Mức độ đồng ý (1–4)';const score=document.createElement('select');score.name='score-'+question.id;score.required=question.required;score.append(new Option('Chọn điểm',''));for(let n=1;n<=4;n++)score.append(new Option(String(n),String(n)));label.append(score);
        const commentLabel=document.createElement('label');commentLabel.textContent='Nhận xét';const comment=document.createElement('textarea');comment.name='comment-'+question.id;comment.maxLength=1000;comment.rows=2;commentLabel.append(comment);group.append(label,commentLabel);$('questions').append(group);
      }
      $('answerSurvey').hidden=false;show(data,status,'GET',url);notify('Đã mở khảo sát. Chọn điểm và nhập nhận xét nếu có.','success');
    }catch(error){if(generation===session){if(error.status)show(error.data,error.status,'GET',url);notify(error.message);}}finally{lock(false);}
  });
  $('answerSurvey').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!openedSurvey)return;const values=new FormData(event.currentTarget),survey=openedSurvey;
    const answers=survey.questions.filter(q=>values.get('score-'+q.id)).map(q=>({questionId:q.id,score:Number(values.get('score-'+q.id)),comment:String(values.get('comment-'+q.id)||'').trim()||null}));
    const generation=session,url='/api/surveys/'+survey.id+'/responses';lock(true);
    try{const {data,status}=await api(url,{method:'POST',body:{answers}});if(generation!==session)return;show(data,status,'POST',url);openedSurvey=null;$('answerSurvey').hidden=true;$('questions').replaceChildren();notify('Đã nộp khảo sát. Bạn có thể xem lại trong mục câu trả lời của tôi.','success');}
    catch(error){if(generation===session){if(error.status)show(error.data,error.status,'POST',url);notify(error.message);}}finally{lock(false);}
  });
  $('readOperation').onchange=readIdState;
  $('read').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const op=operations.find(o=>o[0]===$('readOperation').value);if(!op)return;
    let url=op[3];if(url.includes('{id}')){const id=Number($('recordId').value);if(!Number.isInteger(id)||id<=0||id>2147483647)return notify('ID phải là số nguyên dương.');url=url.replace('{id}',String(id));}
    const generation=session;lock(true);notify('Đang tải dữ liệu…','info');
    try{const {data,status}=await api(url);if(generation!==session)return;show(data,status,'GET',url);notify('Đã tải dữ liệu. Mở từng bản ghi hoặc Response JSON để xem chi tiết.','success');}
    catch(error){if(generation===session){if(error.status)show(error.data,error.status,'GET',url);notify(error.message);}}
    finally{lock(false);}
  });
})();
