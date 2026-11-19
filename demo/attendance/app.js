(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='/api/v1/attendance';
  let currentFile=null,choices={},token=null,actor=null,batch=null,offset=0,editRecord=null,busy=false;
  let reconciliation=null,cancellationOffset=0;
  const notify=(message,bad=false)=>{$('notice').hidden=false;$('notice').dataset.bad=String(bad);$('notice').textContent=message;};
  const isHr=()=>actor?.role==='HR';
  function clearReconciliation(){
    reconciliation=null;
    $('reconcilePreview').hidden=true;
    $('reconcileWarnings').checked=false;
  }
  function el(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function cell(tr,text){const e=el('td',text);tr.append(e);return e;}
  function button(parent,label,fn){const b=el('button',label);b.type='button';b.className='secondary';b.onclick=()=>run(fn);parent.append(b);return b;}
  async function api(url,options={}){
    const headers={...(token?{Authorization:'Bearer '+token}:{}),...options.headers};
    if(options.body&&!(options.body instanceof FormData))headers['Content-Type']='application/json';
    const res=await fetch(url,{...options,headers,cache:'no-store'});
    if(options.download&&res.ok)return res.blob();
    const data=await res.json();$('response').textContent=JSON.stringify(data,null,2);
    if(!res.ok)throw new Error(data.message||`HTTP ${res.status}`);return data;
  }
  async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){notify(e.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(batch?.status==='CONFIRMED')$('confirmBatch').disabled=true;}}
  const stamp=value=>value?value.slice(0,19).replace('T',' '):'—';
  function renderPreview(data){
    batch=data;$('previewPanel').hidden=false;$('previewRows').replaceChildren();$('warnings').checked=false;
    $('previewInfo').textContent=`${data.status} · ${data.rows.length} dòng · Bản xem trước chỉ giữ trên trang, có hiệu lực 30 phút`;
    for(const row of data.rows){
      const tr=el('tr');if(row.excluded)tr.className='excluded';
      cell(tr,row.excel_row);cell(tr,`${row.employee_code} · ${row.full_name||row.employee_name||''}\n${row.shift_type}`);
      const day=cell(tr,row.work_date||'—');
      if(row.candidates?.length>1&&(!row.work_date||row.selected_work_date)&&!row.excluded&&data.status!=='CONFIRMED'){
        const select=el('select');select.append(new Option('Chọn ngày ca',''));for(const d of row.candidates)select.append(new Option(d,d));select.value=row.selected_work_date||'';
        select.onchange=()=>run(async()=>{choices[row.excel_row]={...choices[row.excel_row],work_date:select.value};await refreshPreview();});day.append(select);
      }
      const times=cell(tr,`${stamp(row.check_in)}\n→ ${stamp(row.check_out)}`);
      if(row.action==='CONFLICT')times.append(el('small',`Cũ: ${stamp(row.previous.check_in)} → ${stamp(row.previous.check_out)}`));
      const metrics=cell(tr,`${row.working_minutes??'—'} / ${row.late_mins??'—'} / ${row.early_mins??'—'}`);
      if(row.action==='CONFLICT')metrics.append(el('small',`Cũ: ${row.previous.working_minutes} / ${row.previous.late_mins} / ${row.previous.early_mins}`));
      const validation=cell(tr,row.validation_status);
      if(row.attendance_status)validation.append(el('small',row.attendance_status));
      for(const i of row.issues)validation.append(el('small',`${i.code} · ${i.message}`));
      const actions=cell(tr,row.action);
      if(data.status!=='CONFIRMED'){
        button(actions,row.excluded?'Đưa vào Preview':'Loại dòng',async()=>{choices[row.excel_row]={...choices[row.excel_row],exclude:!row.excluded};await refreshPreview();});

      }
      $('previewRows').append(tr);
    }
    $('confirmBatch').disabled=data.status==='CONFIRMED';
  }
  function uploadBody(options={}){if(!currentFile)throw new Error('Chọn lại file Excel.');const f=new FormData();f.append('file',currentFile);f.append('options',JSON.stringify(options));return f;}
  const decisions=()=>Object.entries(choices).map(([excel_row,c])=>({excel_row:Number(excel_row),...c}));
  const previewOptions=()=>({choices:decisions(),confirm_complete:$('completeData').checked});
  async function refreshPreview(){renderPreview(await api(`${base}/import/preview`,{method:'POST',body:uploadBody(previewOptions())}));}
  function filters(){const q=new URLSearchParams({limit:'50',offset:String(offset)});if($('from').value)q.set('from',$('from').value);if($('to').value)q.set('to',$('to').value);return q;}
  async function loadRecords(){
    $('reconcilePanel').hidden=!isHr();$('cancellationsPanel').hidden=!isHr();
    const q=filters(),data=await api(`${base}${isHr()?'':'/me'}?${q}`),summary=await api(`${base}/summary?${q}`);
    $('summary').textContent=`${summary.data.recorded_days} ngày có bản ghi ACTIVE · ${summary.data.worked_days} lượt ngày đi làm · ${summary.data.worked_employees} người đi làm · ${summary.data.working_minutes} phút làm · Trễ ${summary.data.late_mins} · Sớm ${summary.data.early_mins} · Overtime ${summary.data.overtime_minutes}`;
    $('records').replaceChildren();
    for(const r of data.data){const tr=el('tr');const employee=cell(tr,`${r.employee_code} · ${r.full_name}`);if(isHr())employee.append(el('small',`ID: ${r.employee_id}`));cell(tr,r.work_date);cell(tr,`${stamp(r.check_in)}\n→ ${stamp(r.check_out)}`);cell(tr,`${r.working_minutes} / ${r.late_mins} / ${r.early_mins} / ${r.overtime_minutes}`);cell(tr,`${r.record_status}\n${r.attendance_status}`);const actions=cell(tr,'');
      if(isHr()){
        for(const warning of r.holiday_warnings||[])actions.append(el('p',`${warning.code} · ${warning.message}`));
        if(r.worked_on_day_off)actions.append(el('p','Có giờ làm vào ngày nghỉ theo lịch.'));
        if(r.record_status==='ACTIVE')button(actions,'Hủy',async()=>{const detail=await api(`${base}/${r.id}`);openEdit(detail.data);});
        button(actions,'Audit',async()=>{const logs=await api(`${base}/${r.id}/audit-logs`);$('auditContent').replaceChildren();for(const log of logs.data){const details=el('details');details.append(el('summary',`${log.action} · User ${log.actor_id} · ${new Date(log.occurred_at).toLocaleString('vi-VN')}`),el('p',log.reason||'Tạo từ Excel'),el('pre',JSON.stringify({before:log.old_values,after:log.new_values},null,2)));$('auditContent').append(details);}$('auditDialog').showModal();});
      }$('records').append(tr);
    }
    if(!data.data.length){const tr=el('tr'),td=cell(tr,'Chưa có dữ liệu trong khoảng đã chọn.');td.colSpan=6;$('records').append(tr);}
  }
  function openEdit(r){editRecord=r;$('editReason').value='';$('editDialog').showModal();}
  async function loadCancellations(){
    const query=filters();query.set('offset',String(cancellationOffset));
    const {data}=await api(`${base}/cancellations?${query}`);
    $('cancellationRows').replaceChildren();
    for(const r of data){
      const tr=el('tr');cell(tr,`${r.employee_code} · ${r.work_date}`);cell(tr,`${r.schedule_name||'—'} · ${r.attendance_status}`);
      cell(tr,`${r.cancelled_by_name||r.cancelled_by||'—'} · ${r.cancelled_at?new Date(r.cancelled_at).toLocaleString('vi-VN'):'—'}`);
      cell(tr,r.cancellation_reason||'—');
      button(cell(tr,''),'Chi tiết',async()=>{
        const result=await api(`${base}/cancellations/${r.id}`);
        $('auditContent').replaceChildren(el('pre',JSON.stringify(result.data,null,2)));
        $('auditDialog').showModal();
      });
      $('cancellationRows').append(tr);
    }
  }
  $('loadCancellations').onclick=()=>{cancellationOffset=0;run(loadCancellations);};
  $('previousCancellation').onclick=()=>{cancellationOffset=Math.max(0,cancellationOffset-50);run(loadCancellations);};
  $('nextCancellation').onclick=()=>{cancellationOffset+=50;run(loadCancellations);};
  $('loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});if(!data.accessToken)throw new Error('Cần hoàn tất kích hoạt/đổi mật khẩu trước khi sử dụng.');token=data.accessToken;$('password').value='';actor=(await api('/api/auth/me')).data;$('loginPanel').hidden=true;$('workspace').hidden=false;$('importPanel').hidden=!isHr();$('identity').textContent=`${actor.fullName||actor.email} · ${actor.role}`;await loadRecords();if(isHr()){const schedules=(await api('/api/work-schedules')).data;$('schedule').replaceChildren();for(const s of schedules)$('schedule').append(new Option(`${s.name} · ${s.shift_type||'Chưa có mã'} · ${s.start_time}–${s.end_time}`,s.id));}notify('Đã đăng nhập.');});};
  $('logout').onclick=()=>{token=null;actor=null;batch=null;currentFile=null;choices={};clearReconciliation();cancellationOffset=0;$('cancellationRows').replaceChildren();$('auditContent').replaceChildren();$('workspace').hidden=true;$('loginPanel').hidden=false;$('previewPanel').hidden=true;$('records').replaceChildren();$('previewRows').replaceChildren();$('response').textContent='';notify('Đã đăng xuất.');};
  $('file').onchange=()=>{currentFile=null;batch=null;choices={};$('previewPanel').hidden=true;};
  $('uploadForm').onsubmit=e=>{e.preventDefault();run(async()=>{currentFile=$('file').files[0];choices={};await refreshPreview();notify('Đã xem trước; chưa lưu dữ liệu.');});};
  $('completeData').onchange=()=>{if(currentFile)run(refreshPreview);};
  $('reconcileForm').oninput=clearReconciliation;
  $('reconcileForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    clearReconciliation();
    const scope={from:$('reconcileFrom').value,to:$('reconcileTo').value,
      employee_ids:$('reconcileEmployees').value.split(',').map(id=>id.trim())};
    const data=await api(`${base}/reconcile/preview`,{method:'POST',body:JSON.stringify({scope})});
    reconciliation=data;
    $('reconcileRows').replaceChildren();
    for(const row of data.rows){
      const tr=el('tr');
      cell(tr,`${row.employee_code} · ${row.full_name||''}`);
      cell(tr,row.work_date||'—');
      cell(tr,row.attendance_status||'—');
      const action=cell(tr,row.action);
      if(row.warning||row.message)action.append(el('small',row.warning||row.message));
      $('reconcileRows').append(tr);
    }
    $('reconcilePreview').hidden=false;
    notify(data.rows.length?`Đã xem trước ${data.rows.length} dòng đối soát.`:'Không có dòng đối soát trong khoảng đã chọn.');
  });};
  $('confirmReconcile').onclick=()=>run(async()=>{
    if(!reconciliation?.rows.length)return;
    const {scope,preview_token}=reconciliation;
    const result=await api(`${base}/reconcile/confirm`,{method:'POST',body:JSON.stringify({scope,preview_token,confirm_warnings:$('reconcileWarnings').checked})});
    clearReconciliation();await loadRecords();
    notify(`Đối soát đã lưu: ${result.inserted} mới, ${result.kept} giữ nguyên.`);
  });
  $('mappingForm').onsubmit=e=>{e.preventDefault();run(async()=>{await api('/api/work-schedules/'+$('schedule').value,{method:'PATCH',body:JSON.stringify({shift_type:$('shiftType').value})});notify('Đã lưu mã ca. Tạo lại Preview nếu đã đổi mapping.');});};
  $('confirmBatch').onclick=()=>run(async()=>{
    const result=await api(`${base}/import/confirm`,{method:'POST',body:uploadBody({...previewOptions(),
      preview_token:batch.preview_token,confirm_warnings:$('warnings').checked})});
    renderPreview({...batch,status:'CONFIRMED'});await loadRecords();
    notify(`Đã lưu: ${result.inserted} mới, ${result.skipped} bỏ qua, ${result.excluded} dòng loại trừ.`);
  });
  $('errors').onclick=()=>run(async()=>{const blob=await api(`${base}/import/errors`,{method:'POST',body:uploadBody(previewOptions()),download:true}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='attendance-errors.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('filterForm').onsubmit=e=>{e.preventDefault();offset=0;run(loadRecords);};$('previous').onclick=()=>{offset=Math.max(0,offset-50);run(loadRecords);};$('next').onclick=()=>{offset+=50;run(loadRecords);};
  $('editForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    await api(`${base}/${editRecord.id}/cancel`,{method:'PATCH',body:JSON.stringify({reason:$('editReason').value})});
    $('editDialog').close();await loadRecords();cancellationOffset=0;await loadCancellations();notify('Đã hủy bản ghi. Bạn có thể import bản ghi thay thế.');
  });};
  $('closeEdit').onclick=()=>$('editDialog').close();$('closeAudit').onclick=()=>$('auditDialog').close();
})();
