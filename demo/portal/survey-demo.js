(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='/api/surveys';
  const states={DRAFT:'Bản nháp',ACTIVE:'Đã phát hành',CLOSED:'Đã đóng'};
  let token='',actor=null,generation=0,busy=false,editing=null,opened=null,confirmation=null;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  function notice(text,kind='error'){$('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text;}
  function show(data,endpoint){$('raw').textContent=JSON.stringify(data,null,2);$('endpoint').textContent=endpoint;}
  function focus(id){$(id).hidden=false;$(id).scrollIntoView({behavior:'smooth',block:'start'});$(id).focus({preventScroll:true});}
  const formatDate=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'Chưa đặt';
  function localInput(value){if(!value)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
  function isoDate(value){if(!value)return null;const date=new Date(value+':00+07:00');if(!Number.isFinite(date.getTime()))throw new Error('Ngày giờ không hợp lệ.');return date.toISOString();}
  function resetForm(){editing=null;$('surveyForm').reset();$('formTitle').textContent='Tạo khảo sát nháp';$('saveSurvey').textContent='Tạo bản nháp';$('cancelEdit').hidden=true;const form=$('surveyForm').elements;form.startDate.value=localInput(Date.now()-300000);form.endDate.value=localInput(Date.now()+86400000);}
  function reset(){generation++;token='';actor=null;editing=null;opened=null;confirmation=null;
    if($('confirmDialog').open)$('confirmDialog').close();$('workspace').hidden=true;$('loginPanel').hidden=false;$('hrPanel').hidden=true;
    for(const id of ['surveyDetail','responseDetail','answerPanel','ownResponse'])$(id).hidden=true;
    for(const id of ['surveyRows','available','questions','aggregateRows','participantRows','responseAnswers','ownAnswers','questionPreview','detailMetrics'])$(id).replaceChildren();
    $('raw').textContent='Chưa có dữ liệu.';$('endpoint').textContent='';$('myResponseForm').reset();resetForm();
  }
  async function api(url,{method='GET',body,access=token}={}){
    const current=generation;let response;
    try{response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(30000),headers:{...(access?{Authorization:'Bearer '+access}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Không kết nối được backend. Nếu vừa lưu/nộp, tải lại trạng thái trước khi thử lại.');}
    const data=await response.json().catch(()=>({message:'Backend không trả JSON.'}));
    if(current!==generation)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(response.status===401&&access&&access===token)reset();
    if(!response.ok){const error=new Error(data.message||'Không xử lý được yêu cầu.');error.status=response.status;throw error;}return data;
  }
  async function run(work){if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button')].map(button=>[button,button.disabled]);buttons.forEach(([button])=>button.disabled=true);notice('');
    try{await work();}catch(error){if($('confirmDialog').open)$('confirmError').textContent=error.message;else{notice(error.message);$('notice').scrollIntoView({behavior:'smooth',block:'start'});}}
    finally{busy=false;buttons.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});}
  }
  function actionButton(cell,text,work,secondary=false){const button=el('button',text,secondary?'secondary':'');button.type='button';button.addEventListener('click',()=>run(work));cell.append(button);return button;}
  function emptyRow(container,text,colspan){const row=el('tr'),cell=el('td',text,'muted');cell.colSpan=colspan;row.append(cell);container.append(row);}
  function renderAnswers(container,answers){container.replaceChildren();for(const answer of answers){const row=el('tr');row.append(el('td',answer.questionText),el('td',answer.score??'—'),el('td',answer.comment||'Không có nhận xét','comment'));container.append(row);}}
  async function refreshHr(){
    const response=await api(base);$('surveyRows').replaceChildren();
    for(const survey of response.data){const row=el('tr'),title=el('td'),period=el('td'),status=el('td'),actions=el('td'),buttons=el('div',undefined,'actions');
      title.append(el('p','#'+survey.id+' · '+survey.title));period.append(el('p',formatDate(survey.startDate)),el('p','→ '+formatDate(survey.endDate),'small muted'));status.append(el('span',states[survey.status]||survey.status,'badge status-'+survey.status));
      actionButton(buttons,'Xem chi tiết',()=>openSurvey(survey.id),true);
      if(survey.status==='DRAFT'){
        actionButton(buttons,'Sửa nháp',async()=>{editing=survey.id;const form=$('surveyForm').elements;form.title.value=survey.title;form.description.value=survey.description||'';form.startDate.value=localInput(survey.startDate);form.endDate.value=localInput(survey.endDate);$('formTitle').textContent='Sửa bản nháp #'+survey.id;$('saveSurvey').textContent='Lưu chỉnh sửa';$('cancelEdit').hidden=false;$('surveyForm').scrollIntoView({behavior:'smooth',block:'center'});form.title.focus({preventScroll:true});},true);
        actionButton(buttons,'Phát hành',async()=>ask('publish',survey));
      }
      if(survey.status==='ACTIVE')actionButton(buttons,'Đóng khảo sát',async()=>ask('close',survey),true);
      actions.append(buttons);row.append(title,period,status,el('td',`${survey.questionCount} câu · ${survey.responseCount} đã nộp`),actions);$('surveyRows').append(row);
    }
    if(!response.data.length)emptyRow($('surveyRows'),'Chưa có khảo sát. Tạo bản nháp để bắt đầu.',5);
  }
  function ask(kind,survey){confirmation={kind,survey};$('confirmError').textContent='';$('confirmTitle').textContent=(kind==='publish'?'Phát hành':'Đóng')+' khảo sát #'+survey.id;
    $('confirmDescription').textContent=kind==='publish'?'Nhân viên đủ điều kiện sẽ thấy khảo sát khi đến thời gian bắt đầu. Chỉ có thể sửa thông tin lúc còn là bản nháp.':'Đóng sẽ ngăn nộp thêm câu trả lời, giữ nguyên kết quả đã thu thập.';$('confirmDialog').showModal();}
  async function openSurvey(id){
    const [detail,results,participants]=await Promise.all([api(base+'/'+id),api(base+'/'+id+'/results'),api(base+'/'+id+'/responses')]);
    const survey=detail.data;$('detailTitle').textContent='#'+id+' · '+survey.title;$('detailStatus').textContent=states[survey.status]||survey.status;$('detailStatus').className='badge status-'+survey.status;
    $('detailDescription').textContent=(survey.description||'Không có mô tả')+' · '+formatDate(survey.startDate)+' → '+formatDate(survey.endDate);
    $('questionPreview').replaceChildren();for(const question of survey.questions)$('questionPreview').append(el('li',question.questionText));
    $('detailMetrics').replaceChildren();for(const [label,value]of [['Câu hỏi chung',survey.questions.length],['Đã nộp',participants.data.responseCount]]){const box=el('div',label,'metric');box.append(el('b',value));$('detailMetrics').append(box);}
    $('aggregateRows').replaceChildren();for(const question of results.data.questions){const row=el('tr'),distribution=Object.entries(question.scoreDistribution).map(([score,count])=>score+': '+count).join(' · ');row.append(el('td',question.questionText),el('td',question.answerCount),el('td',question.averageScore??'Chưa có'),el('td',distribution,'distribution'));$('aggregateRows').append(row);}
    $('participantRows').replaceChildren();for(const participant of participants.data.participants){const row=el('tr'),identity=el('td'),actions=el('td');identity.append(el('p',participant.employee.fullName),el('p',participant.employee.employeeCode,'small muted'));actionButton(actions,'Xem câu trả lời',()=>openResponse(id,participant.responseId),true);row.append(identity,el('td',formatDate(participant.submittedAt)),actions);$('participantRows').append(row);}
    if(!participants.data.participants.length)emptyRow($('participantRows'),'Chưa có nhân viên nộp khảo sát này.',3);
    $('responseDetail').hidden=true;show({detail:detail.data,results:results.data,participants:participants.data},'GET '+base+'/'+id+' + /results + /responses');focus('surveyDetail');
  }
  async function openResponse(id,responseId){const response=await api(base+'/'+id+'/responses/'+responseId),data=response.data.response;
    $('responseTitle').textContent=data.employee.fullName+' · Bài #'+data.responseId;$('responseSummary').textContent='Nộp lúc '+formatDate(data.submittedAt)+' · Điểm hài lòng: '+(data.satisfactionScore??'—')+' / 5';renderAnswers($('responseAnswers'),data.answers);show(response,'GET '+base+'/'+id+'/responses/'+responseId);focus('responseDetail');}
  async function refreshAvailable(){
    $('available').replaceChildren();
    try{const response=await api(base+'/available');$('eligibility').textContent='Chỉ hiện khảo sát đang mở mà bạn chưa nộp. Mỗi bài dùng chung bộ câu hỏi 1–5.';
      for(const survey of response.data){const card=el('article',undefined,'tile');card.append(el('h3','#'+survey.id+' · '+survey.title),el('p',survey.description||''),el('p',`${survey.questionCount} câu · Hạn ${formatDate(survey.endDate)}`,'small muted'));actionButton(card,'Mở để trả lời',()=>openQuestions(survey.id));$('available').append(card);}
      if(!response.data.length)$('available').append(el('p','Hiện không có khảo sát để bạn nộp. Có thể chưa phát hành, chưa tới giờ mở, đã kết thúc hoặc bạn đã nộp rồi.','muted'));
    }catch(error){if(error.status===403){$('eligibility').textContent='Chưa đủ điều kiện tham gia: cần tài khoản và hồ sơ ACTIVE, role HR/EMPLOYEE, đủ 3 tháng làm việc. HR vẫn sử dụng được phần quản lý bên trên.';}else throw error;}
  }
  async function openQuestions(id){const response=await api(base+'/'+id);opened=response.data;$('answerTitle').textContent='#'+id+' · '+opened.title;$('answerDescription').textContent=opened.description||'';$('questions').replaceChildren();
    for(const [index,question]of opened.questions.entries()){
      const group=el('fieldset',undefined,'question');group.append(el('legend',(index+1)+'. '+question.questionText+' *'));
      const label=el('label','Mức độ đồng ý (1–5)'),select=el('select');select.name='score-'+question.id;select.required=true;select.append(new Option('Chọn điểm',''));
      for(let score=1;score<=5;score++)select.append(new Option(String(score),String(score)));label.append(select);
      const commentLabel=el('label','Nhận xét (tùy chọn)'),comment=el('textarea');comment.name='comment-'+question.id;comment.maxLength=1000;comment.rows=2;commentLabel.append(comment);group.append(label,commentLabel);$('questions').append(group);
    }show(response,'GET '+base+'/'+id);focus('answerPanel');}
  async function showOwn(id){const response=await api(base+'/'+id+'/my-response'),data=response.data;
    $('myResponseForm').elements.surveyId.value=id;$('ownTitle').textContent='#'+id+' · '+data.survey.title;$('ownSummary').textContent='Nộp lúc '+formatDate(data.response.submittedAt)+' · Điểm hài lòng: '+data.response.satisfactionScore+' / 5';renderAnswers($('ownAnswers'),data.answers);show(response,'GET '+base+'/'+id+'/my-response');focus('ownResponse');}
  async function afterSave(message,refresh){try{await refresh();notice(message,'success');}catch(error){notice(message+' Dữ liệu đã lưu nhưng chưa tải lại được: '+error.message);}}
  $('login').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const form=new FormData(event.target),login=await api('/api/auth/login',{method:'POST',body:{email:form.get('email'),password:form.get('password')}});
    if(!login.accessToken)throw new Error('Tài khoản cần kích hoạt qua OTP trước. Dùng /demo để hoàn tất rồi đăng nhập lại.');
    const user=await api('/api/auth/me',{access:login.accessToken});if(!['HR','EMPLOYEE'].includes(user.role))throw new Error('Màn hình dành cho HR và EMPLOYEE.');
    token=login.accessToken;actor=user;$('identity').textContent=(user.fullName||user.email)+' · '+user.role;$('loginPanel').hidden=true;$('workspace').hidden=false;$('hrPanel').hidden=user.role!=='HR';event.target.reset();resetForm();
    if(user.role==='HR')await refreshHr();await refreshAvailable();notice('Đã đăng nhập. Các giờ trên màn hình là giờ Việt Nam.','success');
  });});
  $('surveyForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const form=new FormData(event.target),id=editing,body={title:form.get('title'),description:String(form.get('description')||'').trim()||null,startDate:isoDate(form.get('startDate')),endDate:isoDate(form.get('endDate'))};
    if(body.startDate&&body.endDate&&new Date(body.endDate)<=new Date(body.startDate))throw new Error('Kết thúc phải sau bắt đầu.');
    const response=await api(base+(id?'/'+id:''),{method:id?'PATCH':'POST',body});show(response,(id?'PATCH ':'POST ')+base+(id?'/'+id:''));resetForm();await afterSave(id?'Đã cập nhật bản nháp.':'Đã tạo bản nháp. Bấm Phát hành khi sẵn sàng.',async()=>{await refreshHr();await openSurvey(response.data.id);});
  });});
  $('cancelEdit').addEventListener('click',()=>{if(!busy)resetForm();});
  $('confirmForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!confirmation)return;const selected=confirmation,response=await api(base+'/'+selected.survey.id+'/'+selected.kind,{method:'POST'});show(response,'POST '+base+'/'+selected.survey.id+'/'+selected.kind);$('confirmDialog').close();confirmation=null;await afterSave(selected.kind==='publish'?'Đã phát hành khảo sát.':'Đã đóng khảo sát.',async()=>{await refreshHr();await openSurvey(selected.survey.id);await refreshAvailable();});});});
  $('cancelConfirm').addEventListener('click',()=>{if(!busy){$('confirmDialog').close();confirmation=null;}});
  $('confirmDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else confirmation=null;});
  $('answerForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!opened)return;const survey=opened,form=new FormData(event.target),answers=survey.questions.map(question=>({questionId:question.id,score:Number(form.get('score-'+question.id)),comment:String(form.get('comment-'+question.id)||'').trim()||null}));
    if(answers.some(answer=>!Number.isInteger(answer.score)||answer.score<1||answer.score>5))throw new Error('Chọn điểm từ 1 đến 5 cho tất cả câu.');
    const response=await api(base+'/'+survey.id+'/responses',{method:'POST',body:{answers}});show(response,'POST '+base+'/'+survey.id+'/responses');opened=null;$('answerPanel').hidden=true;$('questions').replaceChildren();await afterSave('Đã nộp thành công. Điểm hài lòng: '+response.data.satisfactionScore+' / 5.',async()=>{await refreshAvailable();await showOwn(survey.id);});
  });});
  $('discardAnswer').addEventListener('click',()=>{if(!busy){opened=null;$('answerPanel').hidden=true;$('questions').replaceChildren();}});
  $('myResponseForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const id=Number(new FormData(event.target).get('surveyId'));if(!Number.isInteger(id)||id<1||id>2147483647)throw new Error('ID khảo sát không hợp lệ.');await showOwn(id);});});
  $('reloadHr').addEventListener('click',()=>run(refreshHr));$('reloadAvailable').addEventListener('click',()=>run(refreshAvailable));
  $('logout').addEventListener('click',()=>run(async()=>{await api('/api/auth/logout',{method:'POST'});reset();notice('Đã đăng xuất. Có thể đổi tài khoản.','success');}));
})();
