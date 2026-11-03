(() => {
  const $=id=>document.getElementById(id);
  let token=null,employees=[],session=0,busy=false;
  const reasons={UNSUPPORTED_DEPARTMENT:'Phòng ban ngoài ba nhóm model hỗ trợ.',MISSING_PREVIOUS_MONTH_ATTENDANCE:'Thiếu chấm công tháng trước.',INCOMPLETE_PREVIOUS_MONTH_ATTENDANCE:'Có lần check-in chưa check-out trong tháng trước.',SELF_PREDICTION_FORBIDDEN:'HR khác cần xem dự đoán của bạn.',INACTIVE_PROFILE_OR_ACCOUNT:'Hồ sơ hoặc tài khoản chưa ACTIVE.',INACTIVE_DEPARTMENT_OR_POSITION:'Phòng ban hoặc vị trí chưa ACTIVE.',MISSING_OR_INVALID_EDUCATION:'Thiếu bằng cấp ACTIVE hợp lệ.',MISSING_OR_INVALID_SURVEY_JS:'Thiếu đủ bốn câu JS trong khảo sát mới nhất.',MISSING_OR_INVALID_SURVEY_ES:'Thiếu đủ bốn câu ES trong khảo sát mới nhất.',EXCHANGE_RATE_UNAVAILABLE:'Chưa lấy được tỷ giá.',HISTORY_PROFILE_MISMATCH:'Lịch sử công việc không khớp hồ sơ hiện tại.'};
  const labels={Age:'Tuổi',Department:'Phòng ban',DistanceFromHome:'Khoảng cách nhà–công ty (km)',Education:'Học vấn',EnvironmentSatisfaction:'Hài lòng môi trường',JobLevel:'Cấp bậc',JobSatisfaction:'Hài lòng công việc',MonthlyIncome:'Lương (USD)',OverTime:'Tăng ca',TotalWorkingYears:'Tổng kinh nghiệm',TrainingTimesLastYear:'Số lần đào tạo',YearsAtCompany:'Thâm niên công ty',YearsInCurrentRole:'Thâm niên vị trí',YearsSinceLastPromotion:'Từ lần thăng chức',YearsWithCurrManager:'Thời gian cùng quản lý'};
  function message(text){$('message').textContent=text;}
  function clearResult(){ $('result').hidden=true;$('empty').hidden=false;for(const id of ['raw','features','factors','allFactors','shapBase','person','probability'])$(id).textContent=''; }
  function clearBatch(){$('batchPanel').hidden=true;$('batchRows').textContent='';$('batchSummary').textContent='';$('batchSkipped').textContent='';}
  function lock(value){busy=value;document.querySelectorAll('button').forEach(b=>{if(b.id!=='logout')b.disabled=value;});}
  function reset(){session++;token=null;employees=[];busy=false;$('workspace').hidden=true;$('loginPanel').hidden=false;$('logout').hidden=true;$('password').value='';$('employees').textContent='';$('search').value='';clearResult();clearBatch();lock(false);}
  async function api(url,body){
    let r;try{r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});}
    catch{throw new Error('Không kết nối được backend hoặc yêu cầu quá thời gian chờ.');}
    let data;try{data=await r.json();}catch{throw new Error('Backend không trả JSON hợp lệ.');}
    if(!r.ok){if(r.status===401&&token)reset();throw new Error(data.message||'Không xử lý được yêu cầu.');}return data.data??data;
  }
  function renderEmployees(){
    $('employees').textContent='';const q=$('search').value.trim().toLocaleLowerCase('vi');
    for(const e of employees.filter(e=>(e.fullName+' '+e.employeeCode).toLocaleLowerCase('vi').includes(q))){
      const row=document.createElement('div');row.className='employee';
      const info=document.createElement('div'),name=document.createElement('strong'),dep=document.createElement('p'),status=document.createElement('p');
      name.textContent=e.employeeCode+' · '+e.fullName;dep.textContent=e.department||'Chưa có phòng ban';status.textContent=e.eligible?'Đủ điều kiện':(reasons[e.reason]||e.reason);status.className=e.eligible?'muted':'reason';
      info.append(name,dep,status);row.append(info);
      if(e.eligible){const b=document.createElement('button');b.textContent='Dự đoán';b.disabled=busy;b.addEventListener('click',()=>predict(e.id));row.append(b);}
      $('employees').append(row);
    }
    if(!$('employees').children.length)$('employees').textContent='Không có nhân viên phù hợp.';
  }
  async function load(){
    const current=session;lock(true);message('Đang kiểm tra model và dữ liệu...');
    try{
      const [m,d]=await Promise.allSettled([api('/api/ai-review/models'),api('/api/ai-review/inputs')]);if(current!==session)return;
      $('models').textContent=m.status==='fulfilled'?m.value.models.map(x=>(x.modelId.startsWith('rf-')?'Random Forest':'AdaBoost')+': '+(x.ready?'sẵn sàng':'chưa sẵn sàng')).join(' · '):m.reason.message;
      if(d.status==='rejected')throw d.reason;
      employees=d.value.employees;$('counts').textContent=`${d.value.total} hồ sơ · ${d.value.eligibleCount} đủ điều kiện · ngày ${d.value.snapshotDate}`;
      const fx=d.value.exchangeRate;$('rate').textContent=fx?`1 USD = ${fx.vndPerUsd.toLocaleString('vi-VN')} VND · Tỷ giá cập nhật ${new Date(fx.updatedAt).toLocaleString('vi-VN')} · Tăng ca: ${d.value.overtimePeriod.startInclusive} đến trước ${d.value.overtimePeriod.endExclusive}`:d.value.exchangeRateError;
      message(m.status==='rejected'?'Đã tải dữ liệu; '+m.reason.message:'Đã tải xong. Có thể chạy hồ sơ giả lập để xem model thật.');
    }catch(e){if(current===session)message(e.message);}finally{if(current===session){lock(false);renderEmployees();}}
  }
  function drawFactors(container,factors){
    container.textContent='';const max=Math.max(...factors.map(f=>Math.abs(f.shapValue)),0.000001);
    for(const f of factors){const row=document.createElement('div');row.className='factor';const heading=document.createElement('div');heading.className='factor-heading';const name=document.createElement('strong'),value=document.createElement('span');
      name.textContent=(labels[f.feature]||f.feature)+' · '+(f.value??'thiếu, model tự điền');value.textContent=(f.shapValue>0?'+':'')+(f.shapValue*100).toLocaleString('vi-VN',{maximumFractionDigits:2})+' đpt';value.className=f.direction;
      heading.append(name,value);const track=document.createElement('div'),bar=document.createElement('div');track.className='shap-track';bar.className='shap-segment '+f.direction;bar.style.width=(Math.abs(f.shapValue)/max*49)+'%';track.append(bar);row.append(heading,track);container.append(row);
    }
  }
  function showResult(result){
      $('empty').hidden=true;$('result').hidden=false;$('source').textContent=result.synthetic?'HỒ SƠ GIẢ LẬP · MODEL THẬT':'DỮ LIỆU ERIS · KHÔNG LƯU KẾT QUẢ';
      $('person').textContent=result.employee?result.employee.employeeCode+' · '+result.employee.fullName:'Hồ sơ giả lập '+String((result.sampleIndex??0)+1).padStart(2,'0')+' · độc lập database';
      const percent=result.estimatedProbability*100;$('probability').textContent=percent.toLocaleString('vi-VN',{maximumFractionDigits:2})+'%';$('bar').style.width=percent+'%';
      $('resultMeta').textContent=result.metadata.modelId+' · '+new Date(result.predictedAt).toLocaleString('vi-VN');
      $('warning').textContent=result.warning+(result.explanationError?' '+result.explanationError:'');
      $('features').textContent=JSON.stringify(result.features,null,2);$('raw').textContent=JSON.stringify(result,null,2);
      drawFactors($('factors'),result.explanation?.topFactors||[]);drawFactors($('allFactors'),result.explanation?.contributions||[]);
      $('shapBase').textContent=result.explanation?'Mức tham chiếu: '+(result.explanation.baseValue*100).toLocaleString('vi-VN',{maximumFractionDigits:2})+'% · cộng đóng góp của toàn bộ 15 feature → '+percent.toLocaleString('vi-VN',{maximumFractionDigits:2})+'%':'';
      if(!result.explanation)$('factors').textContent=result.explanationError||'Chọn Xem / SHAP trong bảng để lấy giải thích, hoặc bật Lấy giải thích SHAP khi chạy hồ sơ.';
  }
  async function runBatch(sample){
    if(busy)return;const current=session;
    const ids=employees.filter(x=>x.eligible).slice(0,100).map(x=>x.id);
    if(!sample&&!ids.length){message('Chưa có nhân viên đủ điều kiện. Có thể chạy 10 hồ sơ giả lập.');return;}
    clearBatch();clearResult();lock(true);message('Đang chạy dự đoán hàng loạt...');
    try{
      const d=await api('/api/ai-review/'+(sample?'sample/batch':'predict/batch'),{modelId:$('model').value,...(sample?{}:{employeeIds:ids})});
      if(current!==session)return;$('batchPanel').hidden=false;$('batchSummary').textContent=`${sample?'10 hồ sơ giả lập, không phải nhân viên thật':'Hồ sơ ERIS'} · ${d.successCount}/${d.requestedCount} dự đoán thành công · ${d.skippedCount} bị bỏ qua · ${d.modelId}`;
      for(const result of d.results){const tr=document.createElement('tr');const title=result.synthetic?'Mẫu '+String(result.sampleIndex+1).padStart(2,'0'):result.employee.employeeCode+' · '+result.employee.fullName;
        for(const value of [title,result.features.Department,result.features.OverTime,(result.estimatedProbability*100).toLocaleString('vi-VN',{maximumFractionDigits:2})+'%']){const td=document.createElement('td');td.textContent=value;tr.append(td);}
        const td=document.createElement('td'),button=document.createElement('button');button.textContent='Xem / SHAP';button.addEventListener('click',()=>predict(result.employee?.id,result.sampleIndex??0,true,d.modelId));td.append(button);tr.append(td);$('batchRows').append(tr);
      }
      $('batchSkipped').textContent=d.skipped.map(x=>'ID '+x.employeeId+': '+(reasons[x.reason]||x.reason)).join(' · ');
      if(d.results.length)showResult(d.results[0]);message('Đã chạy batch. Chọn từng dòng để xem giải thích SHAP.');
    }catch(e){if(current===session)message(e.message);}finally{if(current===session){lock(false);renderEmployees();}}
  }
  async function predict(employeeId,sampleIndex=0,forceExplain=false,modelId=$('model').value){
    if(busy)return;const current=session;lock(true);clearResult();message('Đang chạy model'+($('explain').checked?' và giải thích SHAP; có thể mất khoảng một phút...':'...'));
    try{
      const sample=employeeId===undefined;
      const result=await api('/api/ai-review/'+(sample?'sample':'predict'),{...(sample?{sampleIndex}:{employeeId}),modelId,includeExplanation:forceExplain||$('explain').checked});
      if(current!==session)return;
      showResult(result);
      message('Đã nhận kết quả. Không thêm hoặc thay đổi dữ liệu trong database.');
    }catch(e){if(current===session)message(e.message);}finally{if(current===session){lock(false);renderEmployees();}}
  }
  $('login').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const current=++session;token=null;employees=[];clearResult();lock(true);
    try{const r=await api('/api/auth/login',{email:$('email').value.trim(),password:$('password').value});if(current!==session)return;$('password').value='';
      if(!r.accessToken)throw new Error('Tài khoản chưa kích hoạt. Hãy hoàn tất kích hoạt trước.');token=r.accessToken;
      // Authorization is checked against the database, not decoded JWT claims.
      await api('/api/ai-review/inputs');if(current!==session)return;
      $('loginPanel').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;await load();
    }catch(error){if(current===session){token=null;message(error.message);}}finally{if(current===session)lock(false);}
  });
  $('logout').addEventListener('click',()=>{reset();message('Đã thoát phiên demo.');});
  $('reload').addEventListener('click',()=>{clearBatch();clearResult();load();});$('sample').addEventListener('click',()=>predict());$('search').addEventListener('input',renderEmployees);
  $('sampleBatch').addEventListener('click',()=>runBatch(true));$('employeeBatch').addEventListener('click',()=>runBatch(false));
  $('model').addEventListener('change',()=>{clearBatch();clearResult();});
})();
