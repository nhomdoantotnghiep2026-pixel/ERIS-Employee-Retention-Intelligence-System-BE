(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let token='',generation=0,busy=false;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  function notice(text,kind='error'){$('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text;}
  function reset(){generation++;token='';busy=false;$('workspace').hidden=true;$('loginPanel').hidden=false;
    for(const id of ['employees','catalog','recommendations','prediction'])$(id).replaceChildren();
    $('resultTitle').textContent='Kết quả nhân viên';$('resultPanel').setAttribute('aria-busy','false');
    $('results').replaceChildren(el('option','Chọn một kết quả'));$('results').options[0].value='';$('raw').textContent='Chưa chọn kết quả.';}
  async function api(url,{method='GET',body,access=token}={}){
    const current=generation;
    const response=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(access?{Authorization:'Bearer '+access}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(current!==generation)throw new Error('Phiên đăng nhập đã thay đổi.');
    if(response.status===401&&access&&access===token)reset();
    if(!response.ok)throw new Error(data.message||'Không xử lý được yêu cầu.');
    return data;
  }
  function selections(){return [...$('employees').querySelectorAll('input:checked')].map(input=>Number(input.value));}
  $('employees').addEventListener('change',()=>{$('selectedCount').textContent=`Đã chọn ${selections().length} nhân viên`;});
  function focusResult(){
    $('resultPanel').scrollIntoView({behavior:'smooth',block:'start'});
    $('resultPanel').focus({preventScroll:true});
  }
  function renderPrediction(result){
    $('resultTitle').textContent='Kết quả #'+result.id+' · '+result.employee.employeeCode;
    $('prediction').replaceChildren(el('h3',result.employee.fullName),el('div',`${(result.attritionProbability*100).toFixed(0)}%`,'metric'),el('p',`Mức: ${result.riskLevel} · ${result.modelVersion}`),el('p','Các yếu tố dưới đây chỉ có điểm minh họa, chưa phải SHAP.','muted'));
    for(const item of result.explanations){
      const box=el('div',undefined,'factor');box.append(el('span',`${item.featureName} = ${item.featureValue} · ${item.impactDirection} (${item.impactValue})`));
      const track=el('div',undefined,'track'),fill=el('div',undefined,'fill');fill.style.width=Math.min(100,Math.abs(item.impactValue)*500)+'%';track.append(fill);box.append(track);$('prediction').append(box);
    }
    $('prediction').append(el('h3','Chính sách đề xuất'));
    for(const item of result.recommendations){const card=el('article',undefined,'policy');card.append(el('h3',item.policy.name),el('p',item.reason),el('p',`${item.priority} · ${item.status}`,'muted'));$('prediction').append(card);}
    $('raw').textContent=JSON.stringify(result,null,2);
    focusResult();
  }
  async function openResult(id){
    $('resultTitle').textContent='Kết quả #'+id;
    $('prediction').replaceChildren(el('p','Đang tải kết quả…','muted'));
    $('raw').textContent='Đang tải kết quả #'+id+'…';
    $('resultPanel').setAttribute('aria-busy','true');focusResult();
    try{const {data}=await api('/api/prediction-results/'+encodeURIComponent(id));renderPrediction(data);}
    catch(error){$('prediction').replaceChildren(el('p','Không tải được kết quả: '+error.message));$('raw').textContent=error.message;throw error;}
    finally{$('resultPanel').setAttribute('aria-busy','false');}
  }
  async function reload(){
    const [policies,recommendations]=await Promise.all([api('/api/retention-policies'),api('/api/policy-recommendations')]);
    $('catalog').replaceChildren();
    if(!policies.data.length)$('catalog').append(el('p','Chưa có chính sách. Tạo bộ demo để khởi tạo 2 chính sách mẫu.','muted'));
    for(const policy of policies.data){const card=el('article',undefined,'policy');card.append(el('h3',policy.name),el('p',policy.description),el('p',`${policy.targetFactor} · ${policy.status}`,'muted'));$('catalog').append(card);}
    $('recommendations').replaceChildren();
    const current=$('results').value,results=new Map();
    for(const item of recommendations.data){
      results.set(item.predictionResultId,`${item.employee.employeeCode} · ${item.employee.fullName} · kết quả #${item.predictionResultId}`);
      const row=el('tr');for(const text of [item.employee.fullName,item.policy.name,item.priority,item.status])row.append(el('td',text));
      const cell=el('td'),button=el('button','Xem','secondary');button.type='button';button.addEventListener('click',()=>run(async()=>{$('results').value=String(item.predictionResultId);await openResult(item.predictionResultId);}));cell.append(button);row.append(cell);$('recommendations').append(row);
    }
    $('results').replaceChildren(el('option','Chọn một kết quả'));$('results').options[0].value='';
    for(const [id,text]of results){const option=el('option',text);option.value=String(id);$('results').append(option);}
    if(results.has(Number(current)))$('results').value=current;
  }
  async function run(work){if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);notice('');try{await work();}catch(error){notice(error.message);}finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}}
  $('login').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const form=new FormData(event.target),login=await api('/api/auth/login',{method:'POST',body:{email:form.get('email'),password:form.get('password')}});
    if(!login.accessToken)throw new Error('Tài khoản cần được kích hoạt trước. Dùng màn hình /demo để hoàn tất OTP.');
    const actor=await api('/api/auth/me',{access:login.accessToken});if(actor.role!=='HR')throw new Error('Màn hình này cần tài khoản HR.');
    token=login.accessToken;const employees=await api('/api/employees');$('employees').replaceChildren();
    for(const employee of employees.data.filter(item=>item.employmentStatus==='ACTIVE')){
      const row=el('tr'),cell=el('td'),input=el('input');input.type='checkbox';input.value=employee.id;input.setAttribute('aria-label','Chọn '+employee.fullName);cell.append(input);row.append(cell,el('td',employee.employeeCode),el('td',employee.fullName));$('employees').append(row);
    }
    $('identity').textContent=actor.fullName||actor.email;$('loginPanel').hidden=true;$('workspace').hidden=false;$('selectedCount').textContent='Đã chọn 0 nhân viên';$('login').reset();await reload();
  });});
  $('generate').addEventListener('click',()=>run(async()=>{
    const employeeIds=selections();if(!employeeIds.length||employeeIds.length>100)throw new Error('Chọn từ 1 đến 100 nhân viên.');
    const response=await api('/api/prediction-results/demo',{method:'POST',body:{employeeIds}});
    const result=response.results[0];await reload();$('results').value=String(result.id);renderPrediction(result);notice(`Đã lưu bộ kết quả giả lập cho ${response.results.length} nhân viên.`,'success');
  }));
  $('results').addEventListener('change',()=>{if($('results').value)run(()=>openResult($('results').value));});
  $('reload').addEventListener('click',()=>run(reload));
  $('logout').addEventListener('click',()=>run(async()=>{await api('/api/auth/logout',{method:'POST'});reset();notice('Đã đăng xuất.','success');}));
})();
