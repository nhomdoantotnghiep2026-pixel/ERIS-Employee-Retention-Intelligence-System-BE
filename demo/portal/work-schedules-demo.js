(() => {
 'use strict';
 const $=id=>document.getElementById(id),base='/api/work-schedules';
 const dayNames={1:'T2',2:'T3',3:'T4',4:'T5',5:'T6',6:'T7',7:'CN'};
 let token='',generation=0,busy=false,schedules=[];
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const notice=(text,kind='error')=>{ $('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text; };
 const days=value=>(value||[]).map(n=>dayNames[n]||n).join(', ');
 const time=value=>value?String(value).slice(0,5):'—';
 const date=value=>value?String(value).split('-').reverse().join('/'):'Không thời hạn';
 function raw(url,method,body,data,status){$('endpoint').textContent=`${method} ${url} · HTTP ${status}`;$('response').textContent=JSON.stringify({...(body?{request:body}:{}),response:data},null,2);}
 function reset(){generation++;token='';schedules=[];$('workspace').hidden=true;$('loginPanel').hidden=false;$('scheduleRows').replaceChildren();$('historyRows').replaceChildren();$('employee').replaceChildren(new Option('Chọn nhân viên',''));$('createEmployee').replaceChildren(new Option('Chọn nhân viên',''));$('historyForm').reset();$('identity').textContent='';$('endpoint').textContent='';$('response').textContent='Chưa gửi yêu cầu.';newEditor();}
 async function api(url,{method='GET',body,secret=false}={}){
  const session=generation;
  const res=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json().catch(()=>({message:'Backend không trả JSON hợp lệ.'}));
  if(session!==generation)throw new Error('Phiên đăng nhập đã thay đổi.');
  if(!secret)raw(url,method,body,data,res.status);
  if(res.status===401&&token){reset();throw new Error('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');}
  if(!res.ok){const error=new Error(data.message||`HTTP ${res.status}`);error.status=res.status;throw error;}
  return data;
 }
 async function run(fn){if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button')].map(b=>[b,b.disabled]);buttons.forEach(([b])=>b.disabled=true);$('workspace').inert=true;
  try{await fn();}catch(e){notice(e.message);$('notice').scrollIntoView({behavior:'smooth',block:'center'});}finally{busy=false;$('workspace').inert=false;buttons.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});}
 }
 function empty(tbody,text,count){const tr=el('tr'),td=el('td',text);td.colSpan=count;tr.append(td);tbody.replaceChildren(tr);}
 function button(text,fn,disabled=false){const b=el('button',text);b.type='button';b.className='secondary';b.disabled=disabled;b.addEventListener('click',fn);return b;}
 function renderSchedules(){
  $('counts').textContent=`${schedules.length} lịch · ${schedules.filter(s=>s.status==='ACTIVE').length} đang hoạt động`;
  const tbody=$('scheduleRows');tbody.replaceChildren();
  for(const s of schedules){
   const tr=el('tr'),name=el('td',`#${s.id} · ${s.name}`),badge=el('small',s.pending_default?'CHỜ MẶC ĐỊNH · từ '+date(s.pending_default.effective_from):s.is_default?'MẶC ĐỊNH · '+s.status:s.status);name.append(badge);
   const clock=el('td',`${time(s.start_time)}–${time(s.end_time)}`);clock.append(el('small',`Nghỉ ${time(s.break_start)}–${time(s.break_end)}`));
   const actions=el('td');actions.className='actions';actions.append(button('Sửa',()=>editSchedule(s)),button('Đặt mặc định',()=>run(async()=>{
    if(!window.confirm(`Dùng “${s.name}” làm lịch mặc định từ ngày mai? Hôm nay giữ lịch cũ; không ghi đè lịch riêng.`))return;
    const planned=await api(`${base}/${s.id}/default`,{method:'PATCH'});await loadSchedules();notice(planned.data.scheduled?'Đã hẹn áp dụng mặc định từ '+date(planned.data.effective_from)+'. Lịch hôm nay không đổi.':'Lịch này đã là mặc định.','success');
   }),s.status!=='ACTIVE'||s.is_default||!!s.pending_default));
   tr.append(name,clock,el('td',days(s.working_days)),actions);tbody.append(tr);
  }
  if(!schedules.length)empty(tbody,'Chưa có lịch. Tạo lịch mới ở bên cạnh.',4);

 }
 async function loadSchedules(){const result=await api(base);schedules=Array.isArray(result.data)?result.data:[];renderSchedules();}
 function updateEditMode(){const editing=!!$('editingId').value;const current=schedules.find(s=>String(s.id)===$('editingId').value);if(current?.is_default||current?.pending_default)$('nameOnly').checked=true;$('nameOnly').disabled=!!(current?.is_default||current?.pending_default);$('scheduleFields').disabled=editing&&$('nameOnly').checked;}
 function createMode(){const individual=$('createMode').value==='individual';if(!$('editingId').value)$('saveSchedule').textContent=individual?'Tạo và gán lịch riêng':'Tạo lịch mặc định';if(individual&&!$('createEmployeeId').value&&$('employeeId').value){$('createEmployeeId').value=$('employeeId').value;$('createEmployee').value=$('employeeId').value;}$('privateCreateFields').hidden=!individual;for(const id of ['createEmployeeId','createFrom','createTo'])$(id).required=individual&&!$('editingId').value;$('createModeHint').textContent=individual?'Tạo lịch mới và gán cho một nhân viên. Bắt buộc ngày bắt đầu/kết thúc.':'Không nhập ngày: mặc định mới áp dụng từ ngày mai, giữ lịch riêng. Lịch cũ kết thúc ngày trước đó.';}
 function newEditor(){$('scheduleForm').reset();$('editingId').value='';$('editorTitle').textContent='Tạo lịch mới';$('saveSchedule').textContent='Tạo lịch';$('nameOnlyLabel').hidden=true;$('editHint').hidden=true;$('createOptions').hidden=false;createMode();updateEditMode();}
 function editSchedule(s){$('editingId').value=s.id;$('createOptions').hidden=true;for(const id of ['createEmployeeId','createFrom','createTo'])$(id).required=false;$('scheduleName').value=s.name;$('startTime').value=s.start_time;$('endTime').value=s.end_time;$('breakStart').value=s.break_start;$('breakEnd').value=s.break_end;$('scheduleStatus').value=s.status;document.querySelectorAll('[name=day]').forEach(n=>n.checked=s.working_days.includes(Number(n.value)));$('nameOnly').checked=true;$('nameOnlyLabel').hidden=false;$('editHint').hidden=false;$('editorTitle').textContent=`Sửa lịch #${s.id}`;$('saveSchedule').textContent='Lưu thay đổi';updateEditMode();$('editor').scrollIntoView({behavior:'smooth',block:'start'});$('scheduleName').focus({preventScroll:true});}
 function employeeId(){const value=$('employeeId').value.trim();if(!/^[1-9]\d*$/.test(value)||Number(value)>2147483647)throw new Error('Nhập ID nhân viên là số nguyên dương hợp lệ.');return Number(value);}
 async function history(){
  const id=employeeId();const result=await api(`/api/employees/${id}/schedule-assignments`);
  $('historyTitle').textContent=`Lịch sử áp dụng lịch · Nhân viên #${id}`;
  const tbody=$('historyRows');tbody.replaceChildren();
  for(const a of result.data||[]){
   const tr=el('tr'),actions=el('td');
   const defaultSchedule=schedules.find(s=>String(s.id)===String(a.schedule_id));
   actions.append(button('Xóa lịch riêng',()=>run(async()=>{
    if(!window.confirm(`Xóa lần gán #${a.id} (${a.name}) của nhân viên #${id}? Sau đó bạn có thể gán lịch mới. Lịch mẫu không bị xóa.`))return;
    await api(`/api/employees/${id}/schedule-assignments/${a.id}`,{method:'DELETE'});
    await history();await loadSchedules();
    notice('Đã xóa lần gán. Bạn có thể chọn lịch mới và lưu lại.','success');$('notice').scrollIntoView({behavior:'smooth',block:'center'});
   }),!!(defaultSchedule?.is_default||defaultSchedule?.pending_default)));
   tr.append(el('td',a.id),el('td',`#${a.schedule_id} · ${a.name}`),el('td',`${date(a.effective_from)} → ${date(a.effective_to)}`),el('td',`${time(a.start_time)}–${time(a.end_time)} · nghỉ ${time(a.break_start)}–${time(a.break_end)}`),el('td',days(a.working_days)),el('td',a.status),actions);tbody.append(tr);
  }
  if(!result.data?.length)empty(tbody,'Nhân viên chưa có lịch áp dụng được lưu.',7);
 }
 async function loadEmployees(){
  try{
   const result=await api('/api/employees');const list=Array.isArray(result.data)?result.data:result.data?.items||result.items||[];
   for(const selector of ['employee','createEmployee']){
    const selected=selector==='employee'?$('employeeId').value:$('createEmployeeId').value;
    $(selector).replaceChildren(new Option('Chọn nhân viên',''));
    for(const e of list)$(selector).add(new Option(`${e.employeeCode||'#'+e.id} · ${e.fullName||e.email||'Nhân viên'} · ${e.employmentStatus||''}`,e.id));
    $(selector).value=selected;
   }
   $('employeeNotice').textContent=list.length?'Chọn nhân viên để xem lịch sử; tạo và gán bằng form lịch riêng phía trên.':'Danh sách trống. Bạn có thể nhập ID hồ sơ trực tiếp.';
  }catch(e){if(token)$('employeeNotice').textContent='Chưa tải được nhân viên: '+e.message+' Bạn có thể nhập ID trực tiếp.';}
 }
 $('loginForm').addEventListener('submit',event=>{event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);run(async()=>{
  reset();const login=await api('/api/auth/login',{method:'POST',body:{email:form.get('email').trim(),password:form.get('password')},secret:true});formElement.reset();
  if(!login.accessToken)throw new Error('Tài khoản chưa kích hoạt. Hoàn tất OTP/đặt mật khẩu trước khi đăng nhập.');
  token=login.accessToken;
  try{const actor=await api('/api/auth/me',{secret:true});if(actor.role!=='HR')throw new Error('Màn hình chỉ dành cho tài khoản HR ACTIVE.');await loadSchedules();$('identity').textContent=actor.fullName||actor.email;await loadEmployees();if(!token)return;$('workspace').hidden=false;$('loginPanel').hidden=true;notice('Đã tải lịch làm việc. Các thao tác lưu sẽ ghi dữ liệu thật.','success');}
  catch(e){reset();throw e;}
 });});
 $('logout').addEventListener('click',()=>run(async()=>{reset();await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});notice('Đã đăng xuất.','success');}));
 $('reload').addEventListener('click',()=>run(async()=>{await loadSchedules();await loadEmployees();notice('Đã tải lại danh sách.','success');}));
 $('createMode').addEventListener('change',createMode);$('newSchedule').addEventListener('click',newEditor);$('nameOnly').addEventListener('change',updateEditMode);
 $('scheduleForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const id=$('editingId').value;let body={name:$('scheduleName').value.trim()};
  if(!id||!$('nameOnly').checked){const selected=[...document.querySelectorAll('[name=day]:checked')].map(n=>Number(n.value));if(!selected.length)throw new Error('Chọn ít nhất một ngày làm việc.');const start=$('startTime').value,end=$('endTime').value,bs=$('breakStart').value,be=$('breakEnd').value;if(!(start<bs&&bs<be&&be<end))throw new Error('Giờ phải theo thứ tự: bắt đầu < nghỉ trưa < hết nghỉ trưa < kết thúc.');body={...body,start_time:start,end_time:end,break_start:bs,break_end:be,working_days:selected,status:$('scheduleStatus').value};}
  const individual=$('createMode').value==='individual';
  if(!id&&individual){body={...body,employee_id:Number($('createEmployeeId').value),effective_from:$('createFrom').value,effective_to:$('createTo').value};if(body.effective_to<body.effective_from)throw new Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.');}
  const saved=await api(id?`${base}/${id}`:base+(individual?'/individual':'/default'),{method:id?'PATCH':'POST',body});
  const employee=saved.data.assignment?.employee_id;
  newEditor();await loadSchedules();
  if(employee){$('employeeId').value=employee;$('employee').value=String(employee);await history();}
  notice(id?'Đã cập nhật lịch.':saved.data.scheduled?'Đã tạo lịch mặc định; áp dụng từ '+date(saved.data.effective_from)+'. Số nhân viên có lịch mới: '+saved.data.affectedEmployees+'.':'Đã tạo và gán lịch riêng.','success');

 });});
 $('employee').addEventListener('change',()=>{if($('employee').value){$('employeeId').value=$('employee').value;$('createEmployeeId').value=$('employee').value;$('createEmployee').value=$('employee').value;run(history);}});
 $('employeeId').addEventListener('input',()=>{$('employee').value=$('employeeId').value;$('historyTitle').textContent='Lịch sử áp dụng lịch';empty($('historyRows'),'Bấm Xem lịch sử để tải dữ liệu cho ID này.',7);});
 $('createEmployee').addEventListener('change',()=>{
  $('createEmployeeId').value=$('createEmployee').value;
  if($('createEmployee').value){$('employeeId').value=$('createEmployee').value;$('employee').value=$('createEmployee').value;}
 });
 $('createEmployeeId').addEventListener('input',()=>{$('createEmployee').value=$('createEmployeeId').value;});
 $('createFrom').addEventListener('change',()=>{$('createTo').min=$('createFrom').value;});
 $('historyForm').addEventListener('submit',event=>{event.preventDefault();run(history);});

 newEditor();
})();
