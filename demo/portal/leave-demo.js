(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='/api/v1/attendance';
  const names={PENDING:'Chờ duyệt',APPROVED:'Đã duyệt nghỉ',REJECTED:'Từ chối nghỉ',CANCEL_REQUESTED:'Chờ duyệt hủy',CANCEL_REJECTED:'Từ chối hủy',CANCELLED:'Đã hủy'};
  let token='',actor=null,employeeId=null,today='',generation=0,busy=false,action=null;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  function notice(text,kind='error'){$('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text;}
  const shiftDay=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const displayDate=date=>date?date.split('-').reverse().join('/'):'—';
  function reset(){generation++;token='';actor=null;employeeId=null;today='';action=null;
    if($('actionDialog').open)$('actionDialog').close();$('workspace').hidden=true;$('hrPanel').hidden=true;$('loginPanel').hidden=false;
    $('myRequests').replaceChildren();$('allRequests').replaceChildren();$('raw').textContent='Chưa thực hiện thao tác.';$('requestLeave').reset();}
  async function api(url,{method='GET',body,access=token}={}){
    const current=generation;
    const response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(access?{Authorization:'Bearer '+access}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({message:'Backend chưa trả dữ liệu JSON.'}));
    if(current!==generation)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(response.status===401&&access&&access===token)reset();
    if(!response.ok)throw new Error(data.message||'Không thể xử lý yêu cầu.');
    return data;
  }
  async function run(work){if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button')].map(node=>[node,node.disabled]);buttons.forEach(([node])=>node.disabled=true);
    try{await work();}catch(error){if($('actionDialog').open)$('actionMessage').textContent=error.message;else notice(error.message);}
    finally{busy=false;buttons.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});}}
  function statusCell(row){const cell=el('td');cell.append(el('span',names[row.status]||row.status,'badge status-'+row.status));
    if(['CANCEL_REQUESTED','CANCEL_REJECTED'].includes(row.status))cell.append(el('p','Đơn gốc: '+(names[row.effectiveStatus]||'Chưa rõ'),'small muted'));
    if(row.reviewNote)cell.append(el('p','Ghi chú xử lý gần nhất: '+row.reviewNote,'small'));
    const details=el('details'),summary=el('summary','Lịch sử ('+(row.histories?.length||0)+')');details.append(summary);
    for(const history of row.histories||[]){
      const item=el('div',undefined,'summary-item');
      item.append(el('p',(names[history.fromStatus]||'Tạo mới')+' → '+(names[history.toStatus]||history.toStatus)));
      item.append(el('p',(history.actorName||'Tài khoản #'+(history.reviewedBy??'đã xóa'))+' · '+new Date(history.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),'small muted'));
      item.append(el('p',history.note||'Không có ghi chú'));details.append(item);
    }
    if(!row.histories?.length)details.append(el('p','Đơn cũ chưa có lịch sử được lưu.','small muted'));cell.append(details);return cell;}
  function dateCell(row){const cell=el('td');cell.append(el('p',displayDate(row.fromDate)+' → '+displayDate(row.toDate)));return cell;}
  function openAction(kind,row,decision){if(busy)return;action={kind,row,decision};$('actionForm').reset();$('actionMessage').textContent='';
    const cancel=kind==='cancel',reviewCancel=kind==='reviewCancellation';
    $('actionTitle').textContent=cancel?'Xin hủy đơn #'+row.id:(decision==='APPROVED'?'Chấp thuận':'Từ chối')+(reviewCancel?' hủy đơn #':' nghỉ phép #')+row.id;
    $('actionDescription').textContent=cancel?'Yêu cầu sẽ chờ HR duyệt. Đơn nghỉ đã được duyệt vẫn có hiệu lực trong lúc chờ hủy.':
      reviewCancel?(decision==='APPROVED'?'Đơn chuyển Đã hủy; không tạo ON_LEAVE vào ngày nghỉ đến hạn.':'Giữ nguyên hiệu lực đơn nghỉ trước khi xin hủy.'):
      decision==='APPROVED'?'Lưu đơn đã duyệt. Đến từng ngày nghỉ, hệ thống kiểm tra hiệu lực rồi mới ghi ON_LEAVE.':'Đơn chuyển Từ chối nghỉ và không tạo ON_LEAVE.';
    $('actionLabel').textContent=cancel?'Lý do xin hủy *':'Ghi chú cho nhân viên (tùy chọn)';$('actionNote').required=cancel;$('actionDialog').showModal();$('actionNote').focus();}
  function button(cell,label,kind,row,decision){const node=el('button',label,decision==='REJECTED'?'secondary':'');node.type='button';node.addEventListener('click',()=>openAction(kind,row,decision));cell.append(node);return node;}
  function renderOwn(rows){$('myRequests').replaceChildren();for(const row of rows){
    const tr=el('tr'),reason=el('td');reason.append(el('p',row.reason||'—'));if(row.cancellation)reason.append(el('p','Xin hủy: '+row.cancellation.reason,'small muted'));
    const actions=el('td');
    if(row.fromDate>today && ['PENDING','APPROVED','CANCEL_REJECTED'].includes(row.status) && ['PENDING','APPROVED'].includes(row.effectiveStatus))button(actions,'Xin hủy','cancel',row);
    else actions.append(el('span',row.status==='CANCEL_REQUESTED'?'Đang chờ HR xử lý hủy':'—','small muted'));
    tr.append(el('td','#'+row.id),dateCell(row),reason,statusCell(row),actions);$('myRequests').append(tr);
  }if(!rows.length){const cell=el('td','Bạn chưa có đơn nghỉ phép.','empty');cell.colSpan=5;const tr=el('tr');tr.append(cell);$('myRequests').append(tr);}}
  function renderHr(rows){$('allRequests').replaceChildren();for(const row of rows){const tr=el('tr'),person=el('td'),reason=el('td'),actions=el('td');
    person.append(el('p',row.fullName),el('p',row.employeeCode+' · #'+row.id,'small muted'));reason.append(el('p',row.reason||'—'));
    if(row.cancellation)reason.append(el('p','Xin hủy: '+row.cancellation.reason,'small muted'));
    const box=el('div',undefined,'actions');actions.append(box);
    if(Number(row.employeeId)===employeeId)box.append(el('p','HR khác xử lý đơn của bạn.','small muted'));
    else if(row.status==='CANCEL_REQUESTED'){
      if(row.fromDate>today)button(box,'Duyệt hủy','reviewCancellation',row,'APPROVED');
      button(box,'Từ chối hủy','reviewCancellation',row,'REJECTED');
    }else if(row.status==='PENDING'||(row.status==='CANCEL_REJECTED'&&row.effectiveStatus==='PENDING')){
      if(row.fromDate>today)button(box,'Duyệt nghỉ','review',row,'APPROVED');
      button(box,'Từ chối nghỉ','review',row,'REJECTED');
    }else box.append(el('span','Đã xử lý','small muted'));
    tr.append(person,dateCell(row),reason,statusCell(row),actions);$('allRequests').append(tr);
  }if(!rows.length){const tr=el('tr'),cell=el('td','Chưa có đơn nghỉ phép.','empty');cell.colSpan=5;tr.append(cell);$('allRequests').append(tr);}}
  function updateEndDate(){const start=$('fromDate').value;if(!start)return;
    $('toDate').min=start;$('toDate').max=shiftDay(start,29);
    if(!$('toDate').value||$('toDate').value<start||$('toDate').value>$('toDate').max)$('toDate').value=start;
  }
  $('fromDate').addEventListener('change',updateEndDate);
  async function reload(){const state=await api(base+'/today');today=state.date;employeeId=Number(state.user.employeeId);
    const tomorrow=shiftDay(today,1);$('fromDate').min=tomorrow;
    if(!$('fromDate').value||$('fromDate').value<tomorrow)$('fromDate').value=tomorrow;updateEndDate();
    $('serverDate').textContent='Hôm nay tại Việt Nam: '+displayDate(today)+'. Chọn ngày bắt đầu sau hôm nay.';
    const [own,all]=await Promise.all([api(base+'/leave-requests/me'),actor.role==='HR'?api(base+'/leave-requests'):Promise.resolve(null)]);
    renderOwn(own.data);if(all)renderHr(all.data);
  }
  async function saved(data,message){$('raw').textContent=JSON.stringify(data,null,2);try{await reload();notice(message,'success');}catch(error){notice(message+' Dữ liệu đã lưu nhưng chưa tải lại được danh sách: '+error.message);}}
  $('login').addEventListener('submit',event=>{event.preventDefault();run(async()=>{notice('');
    const form=new FormData(event.target),login=await api('/api/auth/login',{method:'POST',body:{email:form.get('email'),password:form.get('password')}});
    if(!login.accessToken)throw new Error('Tài khoản chưa kích hoạt. Hoàn tất OTP ở /demo rồi đăng nhập lại.');
    const user=await api('/api/auth/me',{access:login.accessToken});if(!['EMPLOYEE','HR'].includes(user.role))throw new Error('Dùng tài khoản EMPLOYEE hoặc HR có hồ sơ ACTIVE.');
    token=login.accessToken;actor=user;await reload();$('identity').textContent=(user.fullName||user.email)+' · '+user.role+' · employeeId '+employeeId;
    $('hrPanel').hidden=user.role!=='HR';$('loginPanel').hidden=true;$('workspace').hidden=false;event.target.reset();
  });});
  $('requestLeave').addEventListener('submit',event=>{event.preventDefault();run(async()=>{notice('');const form=new FormData(event.target);
    const data=await api(base+'/leave-requests',{method:'POST',body:{fromDate:form.get('fromDate'),toDate:form.get('toDate'),reason:form.get('reason')}});
    event.target.elements.reason.value='';await saved(data,'Đã gửi đơn nghỉ. Chờ HR duyệt.');
  });});
  $('actionForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!action)return;const selected=action,cancel=selected.kind==='cancel';
    const suffix=selected.kind==='review'?'':'/cancellation';
    const data=await api(base+'/leave-requests/'+selected.row.id+suffix,{method:cancel?'POST':'PATCH',body:cancel?{reason:$('actionNote').value}:{decision:selected.decision,reviewNote:$('actionNote').value}});
    $('actionDialog').close();action=null;await saved(data,cancel?'Đã gửi yêu cầu hủy. Chờ HR xử lý.':'Đã cập nhật trạng thái đơn.');
  });});
  $('closeDialog').addEventListener('click',()=>{if(!busy){$('actionDialog').close();action=null;}});
  $('actionDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else action=null;});
  $('reload').addEventListener('click',()=>run(async()=>{await reload();notice('Đã tải trạng thái mới nhất.','success');}));
  $('logout').addEventListener('click',()=>run(async()=>{await api('/api/auth/logout',{method:'POST'});reset();notice('Đã đăng xuất. Bạn có thể đăng nhập tài khoản khác.','success');}));
})();
