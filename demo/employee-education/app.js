(() => {
  'use strict';
  const $=id=>document.getElementById(id),levels={1:'Cao đẳng',2:'Cử nhân',3:'Thạc sĩ',4:'Tiến sĩ'};
  let token='',employees=[],records=[],editing=null,selectedSchool=null,busy=false,session=0,listVersion=0,searchVersion=0,timer,controller,options=[],active=-1;
  const notify=(text,kind='error')=>{$('notice').textContent=text;$('notice').dataset.kind=kind;};
  const currentEmployee=()=>employees.find(e=>String(e.id)===$('employee').value);
  const educationUrl=id=>'/api/employees/'+encodeURIComponent(id)+'/educations';
  function levelWarningFor(level,name){
    if(![1,2,3,4].includes(level)||!name)return '';
    const text=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();
    const college=/\b(cao dang|college|polytechnic)\b/.test(text);
    const university=/\b(dai hoc|university|hoc vien|academy)\b/.test(text);
    if(college===university||((level===1)?college:university))return '';
    return 'Tên trường có thể không phù hợp với trình độ đã chọn. Vui lòng kiểm tra lại văn bằng trước khi lưu.';
  }
  function refreshLevelWarning(){
    const name=selectedSchool?.institution||($('institution').value.trim()===editing?.institution?editing.institution:'');
    const message=levelWarningFor(Number($('level').value),name);
    $('levelWarning').textContent=message;$('levelWarning').hidden=!message;
  }
  function closeSuggestions(){options=[];active=-1;$('suggestions').replaceChildren();$('suggestions').hidden=true;$('institution').setAttribute('aria-expanded','false');$('institution').removeAttribute('aria-activedescendant');}
  function cancelSearch(){clearTimeout(timer);controller?.abort();searchVersion++;closeSuggestions();}
  function resetForm(){editing=null;selectedSchool=null;$('education').reset();$('formTitle').textContent='Thêm bằng cấp';$('save').textContent='Lưu bằng cấp';$('selectedSchool').hidden=true;$('levelWarning').hidden=true;cancelSearch();updateEmployeeInfo();}
  function logout(){session++;listVersion++;token='';employees=[];records=[];editing=null;busy=false;cancelSearch();$('loginPanel').hidden=false;$('workspace').hidden=true;$('logout').hidden=true;$('password').value='';$('rows').replaceChildren();$('employee').replaceChildren(new Option('Chọn nhân viên',''));$('all').checked=false;resetForm();}
  async function api(url,init={}){
    const requestSession=session,access=token;
    const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin',headers:{...(init.body?{'Content-Type':'application/json'}:{}),...(access?{Authorization:'Bearer '+access}:{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===401&&access&&requestSession===session){logout();notify('Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.');}const e=new Error(data.message||'Không xử lý được yêu cầu ('+response.status+').');e.status=response.status;throw e;}
    return data;
  }
  function updateEmployeeInfo(){
    const e=currentEmployee(),inactive=e?.employmentStatus==='INACTIVE';
    const birth=typeof e?.dateOfBirth==='string'?e.dateOfBirth.slice(0,10):null;
    $('employeeInfo').textContent=e?(e.employeeCode+' · '+e.fullName+' · Ngày sinh: '+(birth||'Chưa có')+(inactive?' · INACTIVE, không được xem bằng cấp':'')):'';
    $('save').disabled=busy||!e||inactive;
    $('year').min=birth?String(Math.max(1900,Number(birth.slice(0,4))+21)):'1900';
    $('year').max=new Intl.DateTimeFormat('en',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric'}).format(new Date());
    $('yearHint').textContent=birth?'Năm tốt nghiệp từ '+$('year').min+' đến '+$('year').max+' (tuổi tối thiểu 21 theo năm).':'Cần ngày sinh trong hồ sơ để lưu năm tốt nghiệp.';
  }
  function setBusy(value){busy=value;updateEmployeeInfo();$('employee').disabled=value;$('all').disabled=value;$('reload').disabled=value;$('cancelEdit').disabled=value;$('logout').disabled=value;for(const button of $('rows').querySelectorAll('button'))button.disabled=value||button.dataset.inactive==='true';}
  function renderRows(){
    $('rows').replaceChildren();$('listStatus').textContent=records.length?records.length+' bản ghi. Nút Xóa sẽ chuyển bằng cấp sang INACTIVE.':'Chưa có bằng cấp.';
    for(const row of records){
      const tr=document.createElement('tr');
      const employee=employees.find(e=>String(e.id)===String(row.employeeId));
      const cells=[[row.fullName||employee?.fullName||'Nhân viên #'+row.employeeId,row.employeeCode||employee?.employeeCode||''],[levels[row.educationLevel]||'Chưa xác định',row.fieldOfStudy||'—'],[row.institution||'Chưa nhập trường',row.graduationYear==null?'Chưa nhập năm':String(row.graduationYear)]];
      for(const [text,detail]of cells){const td=document.createElement('td');td.textContent=text;const small=document.createElement('small');small.textContent=detail;td.append(small);tr.append(td);}
      const actions=document.createElement('td');
      for(const [label,handler,cls]of[['Sửa',()=>editRecord(row),'secondary'],['Xóa',()=>deleteRecord(row),'danger']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.className=cls;button.dataset.inactive=String(employee?.employmentStatus==='INACTIVE');button.disabled=busy||employee?.employmentStatus==='INACTIVE';button.addEventListener('click',handler);actions.append(button);}
      tr.append(actions);$('rows').append(tr);
    }
  }
  async function loadRecords(){
    const version=++listVersion,current=session;
    const url=$('all').checked?'/api/employee-educations':$('employee').value?educationUrl($('employee').value):null;
    records=[];$('rows').replaceChildren();$('listStatus').textContent=url?'Đang tải…':'Chọn nhân viên để xem bằng cấp.';
    if(!url)return;
    try{const result=await api(url);if(current!==session||version!==listVersion)return;records=result.data;renderRows();}
    catch(error){if(current===session&&version===listVersion){$('listStatus').textContent='Chưa tải được danh sách.';throw error;}}
  }
  $('login').addEventListener('submit',async event=>{
    event.preventDefault();if($('loginButton').disabled)return;$('loginButton').disabled=true;notify('');const current=++session;
    try{
      const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('email').value.trim(),password:$('password').value})});
      if(current!==session)return;$('password').value='';
      if(!result.accessToken)throw new Error('Tài khoản chưa kích hoạt. Hoàn tất OTP và đặt mật khẩu trước khi dùng demo.');
      token=result.accessToken;
      const list=await api('/api/employee-educations/employees');if(current!==session)return;
      employees=list.data;
      if(Array.isArray(employees))employees=employees.filter(e=>e.employmentStatus==='ACTIVE');if(!Array.isArray(employees))throw new Error('Response danh sách nhân viên không hợp lệ.');
      $('employee').replaceChildren(new Option('Chọn nhân viên',''));
      for(const e of employees)$('employee').append(new Option(e.employeeCode+' · '+e.fullName+(e.employmentStatus==='INACTIVE'?' (INACTIVE)':''),String(e.id)));
      $('identity').textContent='Đang đăng nhập: '+(result.user?.email||$('email').value.trim());$('loginPanel').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;resetForm();
    }catch(error){if(current===session){logout();notify(error.message);}}
    finally{$('loginButton').disabled=false;}
  });
  $('employee').addEventListener('change',async()=>{resetForm();notify('');try{await loadRecords();}catch(e){notify(e.message);}});
  $('all').addEventListener('change',async()=>{notify('');try{await loadRecords();}catch(e){notify(e.message);}});
  $('reload').addEventListener('click',async()=>{notify('');try{await loadRecords();}catch(e){notify(e.message);}});
  $('cancelEdit').addEventListener('click',()=>{resetForm();notify('');});
  function editRecord(row){
    if(busy)return;
    resetForm();editing={id:row.id,employeeId:row.employeeId,institution:row.institution||''};$('employee').value=String(row.employeeId);updateEmployeeInfo();
    $('level').value=row.educationLevel==null?'':String(row.educationLevel);$('major').value=row.fieldOfStudy||'';$('institution').value=row.institution||'';$('year').value=row.graduationYear??'';
    $('formTitle').textContent='Sửa bằng cấp #'+row.id;$('save').textContent='Lưu thay đổi';$('level').focus();refreshLevelWarning();notify('');
  }
  $('education').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!currentEmployee())return;
    const changed=!editing||$('institution').value.trim()!==editing.institution;
    if(changed&&(!selectedSchool||selectedSchool.institution!==$('institution').value.trim())){notify('Hãy chọn trường từ danh sách gợi ý, không nhập tay.');return;}
    cancelSearch();setBusy(true);notify('');const current=session,employeeId=$('employee').value,edit=editing;
    const body={educationLevel:Number($('level').value),fieldOfStudy:$('major').value.trim()||null,institution:$('institution').value.trim()||null,graduationYear:$('year').value===''?null:Number($('year').value)};
    if(selectedSchool)body.institutionRefId=selectedSchool.id;
    else if(edit)delete body.institution;
    try{
      const result=await api(educationUrl(employeeId)+(edit?'/'+encodeURIComponent(edit.id):''),{method:edit?'PATCH':'POST',body:JSON.stringify(body)});
      if(current!==session)return;
      resetForm();notify(result.warning||((edit?'Đã cập nhật bằng cấp.':'Đã thêm bằng cấp vào database.')),(result.warning?'warning':'success'));
      try{await loadRecords();}catch{notify(result.warning||'Đã lưu thành công nhưng chưa tải lại được danh sách. Bấm Tải lại; không lưu lại lần nữa.',result.warning?'warning':'success');}
    }catch(error){if(current===session)notify(error.message);}
    finally{if(current===session)setBusy(false);}
  });
  async function deleteRecord(row){
    if(busy||!window.confirm('Xóa mềm bằng cấp #'+row.id+' của '+(row.fullName||employees.find(e=>String(e.id)===String(row.employeeId))?.fullName||'nhân viên này')+'?'))return;
    setBusy(true);notify('');const current=session;
    try{
      await api(educationUrl(row.employeeId)+'/'+encodeURIComponent(row.id),{method:'DELETE'});if(current!==session)return;
      if(String(editing?.id)===String(row.id))resetForm();notify('Đã xóa bằng cấp.','success');
      try{await loadRecords();}catch{notify('Đã xóa thành công. Bấm Tải lại để cập nhật danh sách.','success');}
    }catch(error){if(current===session)notify(error.message);}finally{if(current===session)setBusy(false);}
  }
  function pick(index){const school=options[index];if(!school)return;selectedSchool=school;$('institution').value=school.institution;$('selectedSchool').textContent=school.institution+(school.address?' · '+school.address:'')+' · '+(school.source||'ROR');$('selectedSchool').hidden=false;cancelSearch();$('searchStatus').textContent='Đã chọn trường từ '+(school.source||'ROR')+'. Tên và ID sẽ được xác minh khi lưu.';refreshLevelWarning();}
  function activate(index){active=index;for(let i=0;i<$('suggestions').children.length;i++)$('suggestions').children[i].setAttribute('aria-selected',String(i===index));if(index>=0)$('institution').setAttribute('aria-activedescendant','school-'+index);else $('institution').removeAttribute('aria-activedescendant');}
  function search(){
    selectedSchool=null;cancelSearch();$('selectedSchool').hidden=true;$('levelWarning').hidden=true;const name=$('institution').value.trim(),current=session,version=searchVersion;
    if(name.length<2||!token){$('searchStatus').textContent='Gõ từ 2 ký tự để tìm trường, rồi chọn trường trong danh sách.';return;}
    $('searchStatus').textContent='Đang tìm trường…';
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const query=new URLSearchParams({name});if($('level').value)query.set('educationLevel',$('level').value);const result=await api('/api/employee-educations/institutions?'+query,{signal:controller.signal});
        if(current!==session||version!==searchVersion)return;
        options=result.data;$('suggestions').replaceChildren();
        options.forEach((school,index)=>{const li=document.createElement('li');li.id='school-'+index;li.setAttribute('role','option');li.setAttribute('aria-selected','false');li.textContent=school.institution;const detail=document.createElement('small');detail.textContent=(school.address||school.country||'')+(school.website?' · '+school.website:'')+(school.levelWarning?' · '+school.levelWarning:'');li.append(detail);li.addEventListener('pointerdown',e=>e.preventDefault());li.addEventListener('click',()=>pick(index));$('suggestions').append(li);});
        $('suggestions').hidden=!options.length;$('institution').setAttribute('aria-expanded',String(!!options.length));$('searchStatus').textContent=options.length?options.length+' gợi ý từ '+(result.source||'ROR')+'. Kiểm tra đúng trường trước khi chọn.':'Không có gợi ý. Hãy thử tên khác; bắt buộc chọn trường từ gợi ý.';
      }catch(error){if(error.name!=='AbortError'&&current===session&&version===searchVersion)$('searchStatus').textContent=error.status===401?'Phiên đăng nhập đã hết hạn.':'Chưa lấy được gợi ý: '+error.message;}
    },400);
  }
  $('institution').addEventListener('input',search);
  $('level').addEventListener('change',()=>{refreshLevelWarning();if(!selectedSchool&&$('institution').value.trim().length>=2&&token&&!editing)search();});
  $('institution').addEventListener('keydown',event=>{
    if(event.key==='Escape'){cancelSearch();return;}if(!options.length)return;
    if(event.key==='ArrowDown'){event.preventDefault();activate((active+1)%options.length);}
    if(event.key==='ArrowUp'){event.preventDefault();activate((active-1+options.length)%options.length);}
    if(event.key==='Enter'){event.preventDefault();if(active>=0)pick(active);}
  });
  document.addEventListener('click',event=>{if(event.target!==$('institution')&&!$('suggestions').contains(event.target))cancelSearch();});
  $('logout').addEventListener('click',async()=>{if(busy)return;logout();notify('');try{await api('/api/auth/logout',{method:'POST'});}catch{/* Local session already cleared. */}});
})();
