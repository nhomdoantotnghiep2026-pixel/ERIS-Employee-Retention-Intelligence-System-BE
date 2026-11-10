(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let token='',generation=0,lastPreview=null,selectedSnapshot=null,policyPredictionId=null;
  const notify=(message,isError=false)=>{
    $('notice').textContent=message;
    $('notice').style.background=isError?'#fff0ed':'';
    if($('actionNotice')){$('actionNotice').textContent=message;$('actionNotice').style.color=isError?'#b42318':'#1d5268';}
    if(isError)$('notice').scrollIntoView({behavior:'smooth',block:'center'});
  };
  function logout(){policyPredictionId=null;$('policyPanel').hidden=true;$('policyOutput').replaceChildren();selectedSnapshot=null;generation++;token='';lastPreview=null;$('password').value='';$('login').hidden=false;$('workspace').hidden=true;$('result').hidden=true;$('previewOutput').textContent='';$('json').textContent='';$('supplemental').value='{}';$('save').checked=false;}
  async function request(path,body){
    const response=await fetch(path,{method:body!==undefined?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok){if(response.status===401){logout();}const e=new Error(data.message||'Không xử lý được yêu cầu.');e.details=data.details;throw e;}
    return data.data??data;
  }
  async function busy(work){
    const version=generation;
    $('workspace').inert=true;$('login').inert=true;
    try{await work(version);}catch(error){if(version===generation){if(error.details){lastPreview=error.details;$('previewOutput').textContent=JSON.stringify(error.details,null,2);}notify(error.message,true);}}
    finally{$('workspace').inert=false;$('login').inert=false;}
  }
  function input(){
    let raw;
    try{raw=JSON.parse($('supplemental').value);}catch{throw new Error('JSON bổ sung chưa đúng cú pháp. Kiểm tra dấu ngoặc, dấu phẩy và dấu nháy kép.');}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Dữ liệu bổ sung phải là JSON object, ví dụ {"Sick_Days": 2}.');
    const supplementalFeatures={};
    for(const [key,value] of Object.entries(raw)){
      const canonical=key.trim().replace(/\s+/g,'_');
      if(Object.hasOwn(supplementalFeatures,canonical))throw new Error('Trùng feature sau khi chuẩn hóa tên: '+canonical);
      supplementalFeatures[canonical]=value;
    }
    $('supplemental').value=JSON.stringify(supplementalFeatures,null,2);
    const body={supplementalFeatures};
    if($('periodStart').value)body.periodStart=$('periodStart').value;
    if($('periodEnd').value)body.periodEnd=$('periodEnd').value;
    if($('rate').value)body.vndPerUsd=Number($('rate').value);
    return body;
  }
  function showSnapshot(data){
    selectedSnapshot=data;lastPreview=data;
    $('previewOutput').textContent=JSON.stringify(data,null,2);
    $('snapshotStatus').textContent='Snapshot #'+data.snapshotId+' · '+data.capturedAt+' · '+(data.ready?'Đủ dữ liệu để chạy':'Thiếu/sai: '+[...data.missingFeatures,...data.invalidFeatures].join(', '))+(data.issues.length?' · '+data.issues.join(' '):'');
    notify($('snapshotStatus').textContent);
  }
  async function loadSnapshots(preferredId){
    selectedSnapshot=null;const rows=await request(path('snapshots'));
    $('snapshot').replaceChildren();
    for(const row of rows){const option=document.createElement('option');option.value=row.snapshotId;option.textContent='#'+row.snapshotId+' · '+row.capturedAt+(row.ready?'':' · Thiếu/sai dữ liệu');$('snapshot').append(option);}
    if(!rows.length){$('snapshotStatus').textContent='Nhân viên chưa có snapshot. Kiểm tra và bổ sung đủ dữ liệu để tạo.';return;}
    if(preferredId&&rows.some(row=>row.snapshotId===preferredId))$('snapshot').value=String(preferredId);
    const data=await request(path('snapshots')+'/'+$('snapshot').value);showSnapshot(data);
  }
  function path(action){const employee=$('employee').value;if(!employee)throw new Error('Chọn nhân viên trước.');return '/api/ai/employees/'+encodeURIComponent(employee)+'/'+action;}
  function render(data){
    policyPredictionId=data.saved?data.predictionId:null;$('policyPanel').hidden=!policyPredictionId;$('policyOutput').replaceChildren();
    const model=data.model,preview=data.preview;
    $('result').hidden=false;$('score').textContent=(model.score*100).toLocaleString('vi-VN',{maximumFractionDigits:2})+'%';
    $('source').textContent=(preview.employee.fullName||preview.employee.employeeCode)+' · '+preview.dataSource+' · '+(data.saved?'Đã lưu kết quả #'+data.predictionId:'Chưa lưu database');
    $('base').textContent='Mức tham chiếu: '+(model.base_value*100).toFixed(2)+'%. Dấu + tăng, dấu − giảm điểm so với tham chiếu; không phải quan hệ nhân quả.';
    $('factors').replaceChildren();
    const sorted=Object.entries(model.contributions).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const max=Math.max(...sorted.map(([,v])=>Math.abs(v)),0.001);
    for(const [name,value] of sorted){
      const item=document.createElement('div');item.className='factor';
      const label=document.createElement('span');label.textContent=name+' · '+String(preview.features[name]);
      const amount=document.createElement('strong');amount.textContent=(value>=0?'+':'')+(value*100).toFixed(3)+' điểm phần trăm';
      const bar=document.createElement('div');bar.className='bar';bar.style.width=Math.abs(value)/max*100+'%';bar.style.background=value>0?'#dc685c':'#279e9a';
      item.append(label,amount,bar);$('factors').append(item);
    }
    $('json').textContent=JSON.stringify(data,null,2);if(data.predictionId)$('resultId').value=data.predictionId;
    notify(data.warning||preview.warning);$('result').scrollIntoView({behavior:'smooth'});
  }
  $('login').addEventListener('submit',event=>{event.preventDefault();busy(async()=>{
    const data=await request('/api/auth/login',{email:$('email').value,password:$('password').value});
    $('password').value='';if(!data.accessToken)throw new Error('Tài khoản chưa ACTIVE; hãy hoàn thành kích hoạt trước.');
    token=data.accessToken;
    try{const employees=await request('/api/ai/employees');$('employee').replaceChildren();for(const e of employees){const option=document.createElement('option');option.value=e.id;option.textContent=e.employeeCode+' · '+e.fullName;$('employee').append(option);}}
    catch(error){token='';throw error;}
    $('login').hidden=true;$('workspace').hidden=false;notify('Đã đăng nhập HR. Chọn nhân viên và kiểm tra dữ liệu.');if($('employee').value)await loadSnapshots();
  });});
  $('logout').onclick=()=>{logout();notify('Đã đăng xuất.');};
  $('employee').onchange=()=>busy(async()=>{lastPreview=null;selectedSnapshot=null;$('supplemental').value='{}';$('previewOutput').textContent='';$('result').hidden=true;$('save').checked=false;await loadSnapshots();});
  $('reloadSnapshots').onclick=()=>busy(async()=>loadSnapshots(Number($('snapshot').value)));
  $('snapshot').onchange=()=>busy(async()=>showSnapshot(await request(path('snapshots')+'/'+$('snapshot').value)));
  $('modelInfo').onclick=()=>busy(async(version)=>{const data=await request('/api/ai/model');if(version===generation)notify('Model sẵn sàng: '+data.model_id+'\n'+data.warning);});
  $('preview').onclick=()=>busy(async(version)=>{const data=await request(path('preview'),input());if(version!==generation)return;lastPreview=data;$('previewOutput').textContent=JSON.stringify(data,null,2);if(data.snapshotCreated){await loadSnapshots(data.snapshotId);notify('Đã tạo snapshot #'+data.snapshotId+' trong ai_input.');}else{notify('Chưa tạo snapshot. Còn thiếu: '+data.missingFeatures.join(', '));}});
  $('suggest').onclick=()=>{
    if(!lastPreview){notify('Hãy kiểm tra dữ liệu trước.');return;}
    const examples={Department:'IT',Gender:'Male',Age:30,Hire_Date:'2020-10-20',Years_At_Company:6,Education_Level:'Bachelor',Monthly_Salary:1000,Work_Hours_Per_Week:40,Overtime_Hours:5,Sick_Days:2,Promotions:0,Employee_Satisfaction_Score:4};
    $('supplemental').value=JSON.stringify(Object.fromEntries(lastPreview.missingFeatures.map(k=>[k,examples[k]])),null,2);
    notify('Đã điền GIÁ TRỊ VÍ DỤ cho field còn thiếu. Hãy sửa theo dữ liệu muốn demo trước khi chạy.');
  };
  $('predict').onclick=()=>busy(async(version)=>{
    if(!selectedSnapshot)throw new Error('Chọn snapshot đã có hoặc tạo snapshot đủ dữ liệu trước.');
    if(!selectedSnapshot.ready)throw new Error('Snapshot còn thiếu hoặc sai feature. Xem danh sách phía trên.');
    const body={snapshotId:selectedSnapshot.snapshotId,save:$('save').checked};
    if(body.save&&!window.confirm('Lưu một bộ kết quả demo model thật vào database?'))return;
    const result=await request(path('predict'),body);if(version===generation)render(result);
  });
  async function generatePolicies(save){
    if(!policyPredictionId)throw new Error('Lưu kết quả model trước khi đề xuất policy.');
    if(save&&!window.confirm('Lưu các đề xuất SUGGESTED cho policy đang có? Không tự thêm policy mới hoặc áp dụng cho nhân viên.'))return;
    const data=await request('/api/ai/results/'+policyPredictionId+'/policy-recommendations',{save,limit:3});
    $('policyOutput').replaceChildren();
    const notice=document.createElement('p');notice.textContent=data.warning;$('policyOutput').append(notice);
    if(!data.recommendations.length){const empty=document.createElement('p');empty.textContent='Chưa có yếu tố phù hợp để đề xuất policy theo quy tắc hiện tại.';$('policyOutput').append(empty);}
    for(const r of data.recommendations){const item=document.createElement('section');item.className='card';const title=document.createElement('h3');title.textContent=r.rank+'. '+(r.policy?.name??r.policyDraft.name);const status=document.createElement('p');status.textContent=r.policy?'Policy đã có trong danh mục · '+r.status:'Chờ duyệt thêm policy vào danh mục';const reason=document.createElement('p');reason.textContent=r.reason;item.append(title,status,reason);$('policyOutput').append(item);}
    if(save){const note=document.createElement('p');note.textContent='Đã tạo mới '+data.savedRecommendations.filter(r=>r.created).length+' đề xuất; policy chưa có vẫn chờ duyệt.';$('policyOutput').append(note);}
    $('policyPanel').scrollIntoView({behavior:'smooth'});
  }
  $('previewPolicies').onclick=()=>busy(async()=>generatePolicies(false));
  $('savePolicies').onclick=()=>busy(async()=>generatePolicies(true));
  $('loadResult').onclick=()=>busy(async(version)=>{const id=$('resultId').value;if(!/^[1-9]\d*$/.test(id))throw new Error('Nhập ID kết quả dương.');const result=await request('/api/ai/results/'+id);if(version===generation)render(result);});
})();
