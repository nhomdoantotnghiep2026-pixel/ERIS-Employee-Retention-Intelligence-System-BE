(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='/api/v1/attendance';
  let token=null,actor=null,batch=null,offset=0,editRecord=null,editAction=null,busy=false;
  const notify=(message,bad=false)=>{$('notice').hidden=false;$('notice').dataset.bad=String(bad);$('notice').textContent=message;};
  const isHr=()=>actor?.role==='HR';
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
  function renderBatch(data){
    batch=data;$('previewPanel').hidden=false;$('previewRows').replaceChildren();$('warnings').checked=false;
    $('batchInfo').textContent=`Batch ${data.batch_id} · ${data.status} · ${data.rows.length} dòng · Hết hạn ${new Date(data.expires_at).toLocaleString('vi-VN')}`;
    for(const row of data.rows){
      const tr=el('tr');if(row.excluded)tr.className='excluded';
      cell(tr,row.excel_row);cell(tr,`${row.employee_code} · ${row.full_name||row.employee_name||''}\n${row.shift_type}`);
      const day=cell(tr,row.work_date||'—');
      if(row.candidates?.length>1&&!row.excluded&&data.status!=='CONFIRMED'){
        const select=el('select');select.append(new Option('Chọn ngày ca',''));for(const d of row.candidates)select.append(new Option(d,d));select.value=row.selected_work_date||'';
        select.onchange=()=>run(async()=>renderBatch(await api(`${base}/import/${data.batch_id}/rows/${row.excel_row}`,{method:'PATCH',body:JSON.stringify({work_date:select.value})})));day.append(select);
      }
      const times=cell(tr,`${stamp(row.check_in)}\n→ ${stamp(row.check_out)}`);
      if(row.action==='CHANGED')times.append(el('small',`Cũ: ${stamp(row.previous.check_in)} → ${stamp(row.previous.check_out)}`));
      const metrics=cell(tr,`${row.working_minutes??'—'} / ${row.late_mins??'—'} / ${row.early_mins??'—'}`);
      if(row.action==='CHANGED')metrics.append(el('small',`Cũ: ${row.previous.working_minutes} / ${row.previous.late_mins} / ${row.previous.early_mins}`));
      const validation=cell(tr,row.validation_status);for(const i of row.issues)validation.append(el('small',`${i.code} · ${i.message}`));
      const actions=cell(tr,row.action);
      if(data.status!=='CONFIRMED'){
        button(actions,row.excluded?'Đưa vào Preview':'Loại dòng',async()=>renderBatch(await api(`${base}/import/${data.batch_id}/rows/${row.excel_row}`,{method:'PATCH',body:JSON.stringify({exclude:!row.excluded})})));
        if(row.action==='CHANGED'&&!row.excluded){const label=el('label'),check=el('input');check.type='checkbox';check.dataset.updateRow=row.excel_row;label.append(check,document.createTextNode(' Cập nhật bản ghi cũ'));const reason=el('input');reason.placeholder='Lý do cập nhật';reason.maxLength=1000;reason.dataset.reasonRow=row.excel_row;actions.append(label,reason);}
      }
      $('previewRows').append(tr);
    }
    $('confirmBatch').disabled=data.status==='CONFIRMED';
  }
  function filters(){const q=new URLSearchParams({limit:'50',offset:String(offset),record_status:$('recordStatus').value});if($('from').value)q.set('from',$('from').value);if($('to').value)q.set('to',$('to').value);return q;}
  async function loadRecords(){
    const q=filters(),data=await api(`${base}${isHr()?'':'/me'}?${q}`),summary=await api(`${base}/summary?${q}`);
    $('summary').textContent=`${summary.data.recorded_days} ngày có bản ghi ACTIVE · ${summary.data.working_minutes} phút làm · Trễ ${summary.data.late_mins} · Sớm ${summary.data.early_mins} · Ngoài ca ${summary.data.outside_shift_minutes} · Overtime ${summary.data.overtime_minutes}`;
    $('records').replaceChildren();
    for(const r of data.data){const tr=el('tr');cell(tr,`${r.employee_code} · ${r.full_name}`);cell(tr,r.work_date);cell(tr,`${stamp(r.check_in)}\n→ ${stamp(r.check_out)}`);cell(tr,`${r.working_minutes} / ${r.late_mins} / ${r.early_mins} / ${r.outside_shift_minutes}`);cell(tr,`${r.record_status}\n${r.attendance_status}`);const actions=cell(tr,'');
      if(isHr()){
        if(r.record_status==='ACTIVE')button(actions,'Sửa giờ',()=>openEdit(r,'UPDATE'));
        button(actions,r.record_status==='ACTIVE'?'Hủy':'Khôi phục',()=>openEdit(r,r.record_status==='ACTIVE'?'CANCEL':'RESTORE'));
        button(actions,'Audit',async()=>{const logs=await api(`${base}/${r.id}/audit-logs`);$('auditContent').replaceChildren();for(const log of logs.data){const details=el('details');details.append(el('summary',`${log.action} · User ${log.actor_id} · ${new Date(log.occurred_at).toLocaleString('vi-VN')}`),el('p',log.reason||'Tạo từ Excel'),el('pre',JSON.stringify({before:log.old_values,after:log.new_values},null,2)));$('auditContent').append(details);}$('auditDialog').showModal();});
      }$('records').append(tr);
    }
    if(!data.data.length){const tr=el('tr'),td=cell(tr,'Chưa có dữ liệu trong khoảng đã chọn.');td.colSpan=6;$('records').append(tr);}
  }
  function openEdit(r,action){editRecord=r;editAction=action;$('editTitle').textContent=action==='UPDATE'?'Chỉnh sửa giờ chấm công':action==='CANCEL'?'Hủy Attendance':'Khôi phục Attendance';$('timeFields').hidden=action!=='UPDATE';$('editIn').value=r.check_in?.slice(0,19)||'';$('editOut').value=r.check_out?.slice(0,19)||'';$('editReason').value='';$('editDialog').showModal();}
  $('loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});if(!data.accessToken)throw new Error('Cần hoàn tất kích hoạt/đổi mật khẩu trước khi sử dụng.');token=data.accessToken;$('password').value='';actor=(await api('/api/auth/me')).data;$('loginPanel').hidden=true;$('workspace').hidden=false;$('importPanel').hidden=!isHr();$('identity').textContent=`${actor.fullName||actor.email} · ${actor.role}`;await loadRecords();if(isHr()){const schedules=(await api('/api/work-schedules')).data;$('schedule').replaceChildren();for(const s of schedules)$('schedule').append(new Option(`${s.name} · ${s.shift_type||'Chưa có mã'} · ${s.start_time}–${s.end_time}`,s.id));}notify('Đã đăng nhập.');});};
  $('logout').onclick=()=>{token=null;actor=null;batch=null;$('workspace').hidden=true;$('loginPanel').hidden=false;$('previewPanel').hidden=true;$('records').replaceChildren();$('previewRows').replaceChildren();$('historyList').replaceChildren();$('response').textContent='';notify('Đã đăng xuất.');};
  $('uploadForm').onsubmit=e=>{e.preventDefault();run(async()=>{const f=new FormData();f.append('file',$('file').files[0]);renderBatch(await api(base+'/import/preview',{method:'POST',body:f}));notify('Preview đã tạo; chưa ghi Attendance.');});};
  $('mappingForm').onsubmit=e=>{e.preventDefault();run(async()=>{await api('/api/work-schedules/'+$('schedule').value,{method:'PATCH',body:JSON.stringify({shift_type:$('shiftType').value})});notify('Đã lưu mã ca. Tạo lại Preview nếu đã đổi mapping.');});};
  $('confirmBatch').onclick=()=>run(async()=>{const updates=[];for(const check of document.querySelectorAll('[data-update-row]:checked')){const n=Number(check.dataset.updateRow),reason=document.querySelector(`[data-reason-row="${n}"]`).value;if(!reason.trim())throw new Error(`Dòng ${n}: nhập lý do cập nhật.`);updates.push({excel_row:n,action:'UPDATE',reason});}const result=await api(`${base}/import/${batch.batch_id}/confirm`,{method:'POST',body:JSON.stringify({duplicate_strategy:'SKIP',confirm_warnings:$('warnings').checked,updates})});renderBatch(await api(`${base}/import/${batch.batch_id}`));await loadRecords();notify(`Đã lưu: ${result.inserted} mới, ${result.updated} cập nhật, ${result.skipped} bỏ qua, ${result.excluded} dòng loại trừ.`);});
  $('errors').onclick=()=>run(async()=>{const blob=await api(`${base}/import/${batch.batch_id}/errors`,{download:true}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='attendance-errors.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('history').onclick=()=>run(async()=>{const data=await api(base+'/import/history');$('historyList').replaceChildren();for(const b of data.data){const p=el('p',`${b.filename} · ${b.status} · ${new Date(b.created_at).toLocaleString('vi-VN')} `);button(p,'Xem Preview',async()=>renderBatch(await api(`${base}/import/${b.batch_id}`)));$('historyList').append(p);}});
  $('filterForm').onsubmit=e=>{e.preventDefault();offset=0;run(loadRecords);};$('previous').onclick=()=>{offset=Math.max(0,offset-50);run(loadRecords);};$('next').onclick=()=>{offset+=50;run(loadRecords);};
  $('editForm').onsubmit=e=>{e.preventDefault();run(async()=>{const body={expected_version:editRecord.version,reason:$('editReason').value};if(editAction==='UPDATE'){body.check_in=$('editIn').value.replace('T',' ');body.check_out=$('editOut').value.replace('T',' ');if(body.check_in.length===16)body.check_in+=':00';if(body.check_out.length===16)body.check_out+=':00';}await api(`${base}/${editRecord.id}${editAction==='UPDATE'?'':'/'+editAction.toLowerCase()}`,{method:'PATCH',body:JSON.stringify(body)});$('editDialog').close();await loadRecords();notify('Đã cập nhật Attendance và ghi Audit.');});};
  $('closeEdit').onclick=()=>$('editDialog').close();$('closeAudit').onclick=()=>$('auditDialog').close();
})();
