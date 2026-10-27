'use strict';
const $ = selector => document.querySelector(selector);
const state = { token: null, user: null, departments: [], positions: [], busy: false, positionRequest: 0, educationId: 0 };
const schools = new Map();
const workCards = new Set();
const jobLevels = { 1: 'Entry', 2: 'Junior', 3: 'Intermediate', 4: 'Senior', 5: 'Expert / Leadership' };

function notice(message, type = 'error', auth = false) {
  const box = $(auth ? '#auth-message' : '#status');
  box.textContent = message;
  box.className = 'notice' + (type === 'error' ? '' : ` ${type}`);
  box.hidden = !message;
}
async function api(path, { method = 'GET', body, signal, publicRequest = false } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(!publicRequest && state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Không kết nối được máy chủ. Kiểm tra backend đang chạy rồi thử lại.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error?.message || `Yêu cầu thất bại (HTTP ${response.status}).`);
    error.status = response.status;
    if (response.status === 401 && !publicRequest) {
      signOut();
      notice('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'error', true);
    }
    throw error;
  }
  return payload;
}
function option(value, label) {
  const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
}
function setPositionPlaceholder(text) {
  $('#position').replaceChildren(option('', text)); $('#position').disabled = true; state.positions = [];
}
async function loadPositions() {
  const departmentId = $('#department').value;
  const request = ++state.positionRequest;
  setPositionPlaceholder(departmentId ? 'Đang tải vị trí…' : 'Chọn phòng ban trước');
  $('#position-hint').className = 'field-note full';
  $('#position-hint').textContent = departmentId ? 'Đang lấy vị trí của phòng ban…' : 'Chọn một phòng ban để xem các vị trí đang hoạt động.';
  $('#department-summary').textContent = state.departments.find(d => String(d.id) === departmentId)?.name || 'Chưa chọn phòng ban';
  if (!departmentId) return;
  try {
    const { data } = await api(`/api/positions?departmentId=${encodeURIComponent(departmentId)}`);
    if (request !== state.positionRequest || !state.token) return;
    state.positions = (data || []).filter(p => p.status === 'ACTIVE' && Number(p.departmentId) === Number(departmentId));
    $('#position').replaceChildren(option('', state.positions.length ? 'Chọn vị trí công việc' : 'Chưa có vị trí phù hợp'));
    for (const position of state.positions) $('#position').append(option(position.id, `${position.name} · ${jobLevels[position.jobLevel] || `Bậc ${position.jobLevel}`}`));
    $('#position').disabled = !state.positions.length;
    $('#position-hint').textContent = state.positions.length ? `${state.positions.length} vị trí đang hoạt động trong phòng ban đã chọn.` : 'Phòng ban này chưa có vị trí ACTIVE được liên kết. Chọn phòng khác hoặc bổ sung vị trí trước.';
  } catch (error) {
    if (request !== state.positionRequest) return;
    setPositionPlaceholder('Không tải được vị trí');
    $('#position-hint').textContent = `${error.message} Chọn lại phòng ban để thử lại.`;
    $('#position-hint').classList.add('error');
  }
}

// Shared autocomplete for school/address fields. Old requests cannot replace a newer query.
function autocomplete({ input, list, hint, minLength, search, label, select, onChange }) {
  let timer, controller, revision = 0, active = -1, results = [];
  const controlsId = list.id || `suggestions-${++state.educationId}`;
  list.id = controlsId;
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', controlsId); input.setAttribute('aria-expanded', 'false');
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const hintText = (text, kind = '') => { hint.textContent = text; hint.classList.toggle('error', kind === 'error'); hint.classList.toggle('selected', kind === 'selected'); };
  const pick = index => {
    if (!results[index]) return;
    try { select(results[index]); close(); }
    catch (error) { hintText(error.message, 'error'); }
  };
  const cancel = () => { clearTimeout(timer); controller?.abort(); revision++; close(); };
  input.addEventListener('input', () => {
    cancel(); onChange();
    input.setCustomValidity('');
    const query = input.value.trim();
    if (query.length < minLength) { hintText(`Nhập ít nhất ${minLength} ký tự để tìm kiếm.`); return; }
    hintText('Đang tìm gợi ý…');
    const current = revision;
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const found = await search(query, controller.signal);
        if (current !== revision || !state.token || !input.isConnected) return;
        results = found;
        list.replaceChildren();
        results.forEach((item, index) => {
          const node = document.createElement('div');
          node.id = `${controlsId}-${index}`; node.className = 'suggestion'; node.setAttribute('role', 'option'); node.setAttribute('aria-selected', 'false');
          const [title, detail] = label(item);
          const strong = document.createElement('strong'); strong.textContent = title; node.append(strong);
          if (detail) { const small = document.createElement('small'); small.textContent = detail; node.append(small); }
          node.addEventListener('pointerdown', event => { event.preventDefault(); pick(index); });
          list.append(node);
        });
        list.hidden = !results.length; input.setAttribute('aria-expanded', String(!!results.length)); active = -1;
        hintText(results.length ? `${results.length} gợi ý. Chọn một kết quả phù hợp.` : 'Chưa tìm thấy kết quả. Thử tên đầy đủ hơn.');
      } catch (error) {
        if (current !== revision || error.name === 'AbortError') return;
        close(); hintText(error.message, 'error');
      }
    }, 400);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (list.hidden || !results.length) return;
    if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(active); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      [...list.children].forEach((node, index) => { node.classList.toggle('active', active === index); node.setAttribute('aria-selected', String(active === index)); });
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }
  });
  input.addEventListener('blur', close);
  return { cancel, hintText };
}

let addressRefId = null;
const addressSearch = autocomplete({
  input: $('#address'), list: $('#address-results'), hint: $('#address-hint'), minLength: 3,
  search: async (query, signal) => (await api(`/api/distance/places?query=${encodeURIComponent(query)}`, { signal })).places || [],
  label: place => [place.display || place.address, place.isCompleteAddress ? 'Có số nhà và tên đường' : 'Chưa có đủ số nhà / tên đường'],
  onChange: () => { addressRefId = null; },
  select: place => {
    if (!place.isCompleteAddress) throw new Error('Địa chỉ này chưa đủ số nhà/tên đường. Hãy chọn gợi ý cụ thể hơn.');
    $('#address').value = place.resolvedAddress || place.address || place.display;
    addressRefId = place.refId;
    addressSearch.hintText('Đã chọn địa chỉ. Quãng đường sẽ được tính khi tạo hồ sơ.', 'selected');
  }
});

function renumber() {
  [...schools.keys()].forEach((card, i) => { card.querySelector('[data-number]').textContent = i + 1; card.querySelector('.remove').disabled = schools.size === 1; });
  [...workCards].forEach((card, i) => { card.querySelector('[data-number]').textContent = i + 1; });
  $('#no-experience').hidden = !!workCards.size;
  $('#add-education').disabled = schools.size >= 20;
  $('#add-experience').disabled = workCards.size >= 50;
}
function field(card, name) { return card.querySelector(`[data-field="${name}"]`); }
function addEducation() {
  if (schools.size >= 20) return;
  const card = $('#education-template').content.firstElementChild.cloneNode(true);
  $('#education-list').append(card);
  const item = { refId: null, institution: null, lookup: null };
  const input = field(card, 'institution');
  field(card, 'graduationYear').max = String(new Date().getFullYear());
  item.lookup = autocomplete({ input, list: card.querySelector('.suggestions'), hint: card.querySelector('.school-hint'), minLength: 2,
    search: async (name, signal) => (await api(`/api/employee-educations/institutions?name=${encodeURIComponent(name)}&educationLevel=${field(card, 'educationLevel').value}`, { signal })).data || [],
    label: school => [school.institution, [school.address || school.display, school.country, school.source].filter(Boolean).join(' · ')],
    onChange: () => { item.refId = null; item.institution = null; },
    select: school => {
      item.refId = school.id; item.institution = school.institution; input.value = school.institution; input.setCustomValidity('');
      item.lookup.hintText(school.levelWarning || `Đã chọn trường từ ${school.source}.`, school.levelWarning ? 'error' : 'selected');
    }
  });
  field(card, 'educationLevel').addEventListener('change', () => {
    item.lookup.cancel();
    if (item.refId) item.lookup.hintText('Đã chọn trường. Hệ thống sẽ đối chiếu bậc đào tạo khi lưu.', 'selected');
    else if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });
  card.querySelector('.remove').addEventListener('click', () => { if (schools.size <= 1) return; item.lookup.cancel(); schools.delete(card); card.remove(); renumber(); });
  schools.set(card, item); renumber();
}
function addExperience() {
  if (workCards.size >= 50) return;
  const card = $('#experience-template').content.firstElementChild.cloneNode(true);
  const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
  field(card, 'startDate').max = month; field(card, 'endDate').max = month;
  card.querySelector('.remove').addEventListener('click', () => { workCards.delete(card); card.remove(); renumber(); });
  $('#experience-list').append(card); workCards.add(card); renumber();
}
function resetEmployeeForm() {
  $('#employee-form').reset();
  for (const item of schools.values()) item.lookup.cancel();
  schools.clear(); workCards.clear(); $('#education-list').replaceChildren(); $('#experience-list').replaceChildren();
  addressSearch.cancel(); addressRefId = null;
  addressSearch.hintText('Chọn gợi ý có số nhà, hoặc nhập địa chỉ đầy đủ để hệ thống xác định.');
  state.positionRequest++; setPositionPlaceholder('Chọn phòng ban trước');
  $('#position-hint').textContent = 'Chọn một phòng ban để xem các vị trí đang hoạt động.';
  $('#department-summary').textContent = 'Chưa chọn phòng ban';
  $('#success-panel').hidden = true; $('#editor').hidden = false; $('#employee-fields').disabled = false;
  state.busy = false; $('#create-button').textContent = 'Tạo hồ sơ và tài khoản →'; notice(''); addEducation();
}
function signOut() {
  state.token = null; state.user = null; state.positionRequest++;
  resetEmployeeForm();
  $('#workspace').hidden = true; $('#auth-panel').hidden = false; $('#session').hidden = true;
  $('#login-form').reset(); $('#token-form').reset();
}
async function enterWorkspace(token) {
  state.token = token;
  try {
    const user = await api('/api/auth/me');
    if (user.role !== 'HR' || user.status !== 'ACTIVE') throw new Error('Màn hình này yêu cầu tài khoản HR đang ACTIVE.');
    state.user = user;
    resetEmployeeForm();
    const { data } = await api('/api/departments');
    state.departments = (data || []).filter(d => d.status === 'ACTIVE');
    $('#department').replaceChildren(option('', 'Chọn phòng ban'));
    state.departments.forEach(d => $('#department').append(option(d.id, `${d.name}${d.code ? ` · ${d.code}` : ''}`)));
    $('#department').disabled = !state.departments.length;
    $('#actor-name').textContent = user.fullName || user.email;
    $('#auth-panel').hidden = true; $('#workspace').hidden = false; $('#session').hidden = false;
    $('#login-form').reset(); $('#token-form').reset(); notice('', 'error', true);
    if (!state.departments.length) notice('Chưa có phòng ban ACTIVE. Vui lòng bổ sung phòng ban trước.', 'info');
  } catch (error) { state.token = null; state.user = null; throw error; }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Đang đăng nhập…'; notice('', 'error', true);
  try {
    const values = new FormData(event.target);
    const data = await api('/api/auth/login', { method: 'POST', publicRequest: true, body: { email: values.get('email').trim(), password: values.get('password') } });
    if (!data.accessToken) throw new Error('Tài khoản đang chờ kích hoạt. Hãy hoàn tất OTP và đặt mật khẩu qua luồng kích hoạt, rồi đăng nhập lại.');
    await enterWorkspace(data.accessToken);
  } catch (error) { notice(error.message, 'error', true); }
  finally { button.disabled = false; button.textContent = 'Đăng nhập'; }
});
$('#token-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await enterWorkspace(new FormData(event.target).get('token').trim().replace(/^Bearer\s+/i, '')); }
  catch (error) { notice(error.message, 'error', true); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', () => { signOut(); notice('', 'error', true); });
$('#department').addEventListener('change', loadPositions);
$('#add-education').addEventListener('click', addEducation);
$('#add-experience').addEventListener('click', addExperience);
$('#new-employee').addEventListener('click', () => { resetEmployeeForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

function collectEmployee() {
  const values = new FormData($('#employee-form'));
  const input = Object.fromEntries(values.entries());
  for (const name of ['departmentId', 'positionId', 'currentSalary']) input[name] = Number(input[name]);
  const position = state.positions.find(p => Number(p.id) === input.positionId);
  if (!position || Number(position.departmentId) !== input.departmentId) throw new Error('Hãy chọn vị trí thuộc phòng ban đã chọn.');
  if (addressRefId) input.addressRefId = addressRefId;
  input.educations = [...schools].map(([card, item], index) => {
    if (!item.refId || item.institution !== field(card, 'institution').value.trim()) {
      const element = field(card, 'institution'); element.setCustomValidity('Hãy chọn trường từ gợi ý.'); element.reportValidity();
      throw new Error(`Bằng cấp ${index + 1}: chọn một trường từ gợi ý trước khi lưu.`);
    }
    const year = field(card, 'graduationYear').value;
    const major = field(card, 'fieldOfStudy').value.trim();
    if (year && Number(year) < Number(input.dateOfBirth.slice(0, 4)) + 21) throw new Error(`Bằng cấp ${index + 1}: năm tốt nghiệp phải từ năm sinh + 21.`);
    return { educationLevel: Number(field(card, 'educationLevel').value), institution: item.institution, institutionRefId: item.refId,
      ...(major ? { fieldOfStudy: major } : {}), ...(year ? { graduationYear: Number(year) } : {}) };
  });
  input.workExperiences = [...workCards].map((card, index) => {
    const startDate = field(card, 'startDate').value, endDate = field(card, 'endDate').value;
    if (endDate && endDate < startDate) throw new Error(`Kinh nghiệm ${index + 1}: tháng kết thúc phải từ tháng bắt đầu trở đi.`);
    return { companyName: field(card, 'companyName').value.trim(), positionTitle: field(card, 'positionTitle').value.trim(), startDate, endDate: endDate || null };
  });
  return input;
}
function showCreated(data) {
  $('#editor').hidden = true; $('#success-panel').hidden = false;
  $('#success-description').textContent = `${data.fullName} · ${data.email}`;
  const summary = $('#success-summary'); summary.replaceChildren();
  const background = data;
  const rows = [['Mã nhân viên', data.employeeCode], ['Trạng thái tài khoản', data.account?.status], ['Quãng đường đến công ty', `${data.distanceFromHomeKm} km`],
    ['Bằng cấp / kinh nghiệm', `${background.educations?.length || 0} / ${background.workExperiences?.length || 0}${data.backgroundStatus === 'PENDING_ACTIVATION' ? ' · chờ kích hoạt' : ''}`]];
  for (const [title, value] of rows) {
    const wrapper = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = title; dd.textContent = value ?? '—'; wrapper.append(dt, dd); summary.append(wrapper);
  }
  const warnings = [];
  if (data.backgroundStatus === 'PENDING_ACTIVATION') warnings.push('Học vấn và kinh nghiệm đã được lưu với trạng thái IN_PROCESS. Các bản ghi này sẽ chuyển sang ACTIVE khi tài khoản hoàn tất kích hoạt qua email.');
  if (data.emailDelivery === 'FAILED') warnings.push('Hồ sơ đã được lưu nhưng gửi email thất bại. Không tạo lại hồ sơ này.');
  if (data.accountCreated === false) warnings.push('Đã liên kết hồ sơ với tài khoản HR có sẵn, giữ nguyên quyền và mật khẩu.');
  for (const education of background.educations || []) if (education.warning) warnings.push(education.warning);
  $('#success-warning').className = data.emailDelivery === 'FAILED' ? 'notice' : 'notice info';
  $('#success-warning').textContent = warnings.join('\n'); $('#success-warning').hidden = !warnings.length;
  $('#response-json').textContent = JSON.stringify(data, null, 2);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#employee-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  notice('');
  let input;
  try { input = collectEmployee(); }
  catch (error) { notice(error.message); return; }
  state.busy = true; $('#employee-fields').disabled = true; $('#create-button').textContent = 'Đang xác minh trường và tính quãng đường…';
  const token = state.token;
  try {
    const result = await api('/api/employees', { method: 'POST', body: input });
    if (state.token !== token) return;
    showCreated(result.data);
  } catch (error) { if (state.token === token) { notice(error.message); $('#status').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  finally {
    state.busy = false; $('#employee-fields').disabled = false; $('#create-button').textContent = 'Tạo hồ sơ và tài khoản →';
  }
});
