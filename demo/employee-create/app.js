(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = '', selected = null, suggestions = [], active = -1, timer, controller, version = 0, busy = false;
  const notice = message => { $('notice').textContent = message || ''; };
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401 && token) logout(); throw new Error(data.message || 'Không thể xử lý yêu cầu.'); }
    return data;
  }
  function closeSuggestions() { $('suggestions').hidden = true; $('address').setAttribute('aria-expanded', 'false'); $('address').removeAttribute('aria-activedescendant'); active = -1; }
  function cancelSearch() { clearTimeout(timer); if (controller) controller.abort(); version++; closeSuggestions(); }
  function logout() { cancelSearch(); token = ''; selected = null; $('loginPanel').hidden = false; $('employee').hidden = true; $('logout').hidden = true; $('selected').hidden = true; $('resultPanel').hidden = true; $('employee').reset(); }
  $('logout').onclick = logout;
  function loadSelect(name, rows) {
    const select = $('employee').elements[name]; select.replaceChildren(new Option('Chọn ' + (name === 'departmentId' ? 'phòng ban' : 'vị trí'), ''));
    rows.filter(row => row.status === 'ACTIVE').forEach(row => select.add(new Option(row.name, row.id)));
  }
  $('login').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; notice('');
    try {
      const form = new FormData(event.target);
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      if (!result.accessToken) throw new Error('Tài khoản cần kích hoạt và đặt mật khẩu trước khi dùng trang này.');
      token = result.accessToken;
      const [departments, positions] = await Promise.all([api('/api/departments'), api('/api/positions')]);
      loadSelect('departmentId', departments.data); loadSelect('positionId', positions.data);
      $('loginPanel').hidden = true; $('employee').hidden = false; $('logout').hidden = false; event.target.reset();
      $('employee').elements.hireDate.value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    } catch (error) { token = ''; notice(error.message); } finally { button.disabled = false; }
  };
  function pick(index) {
    const place = suggestions[index]; if (!place) return;
    cancelSearch(); selected = place.isCompleteAddress === false ? null : place;
    $('address').value = place.resolvedAddress || place.display;
    $('selectedLabel').textContent = place.display; $('coordinates').textContent = 'Vĩ độ: ' + place.latitude + ' · Kinh độ: ' + place.longitude;
    $('mapLink').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.latitude + ',' + place.longitude);
    $('selected').hidden = false; $('searchStatus').textContent = 'Địa chỉ và tọa độ đã chọn sẽ được gửi để tạo hồ sơ.';
  }
  $('address').addEventListener('input', () => {
    cancelSearch(); selected = null; $('selected').hidden = true;
    const query = $('address').value.trim(), current = version;
    if (query.length < 3) { $('searchStatus').textContent = 'Gõ từ 3 ký tự để xem gợi ý từ Vietmap.'; return; }
    $('searchStatus').textContent = 'Đang tìm địa chỉ…';
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const data = await api('/api/distance/places?query=' + encodeURIComponent(query), { signal: controller.signal });
        if (current !== version) return;
        suggestions = data.places; $('suggestions').replaceChildren();
        suggestions.forEach((place, index) => { const li = document.createElement('li'); li.id = 'place-' + index; li.setAttribute('role', 'option'); li.textContent = place.display; li.addEventListener('pointerdown', event => { event.preventDefault(); pick(index); }); $('suggestions').append(li); });
        $('suggestions').hidden = !suggestions.length; $('address').setAttribute('aria-expanded', String(!!suggestions.length));
        $('searchStatus').textContent = suggestions.length ? 'Chọn một địa chỉ trong danh sách, hoặc tiếp tục nhập.' : 'Chưa có gợi ý. Hãy thêm tên đường và tỉnh/thành phố.';
      } catch (error) { if (error.name !== 'AbortError' && current === version) $('searchStatus').textContent = error.message; }
    }, 450);
  });
  $('address').addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); return; }
    if ($('suggestions').hidden) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...$('suggestions').children].forEach((li, i) => { li.classList.toggle('active', i === active); li.setAttribute('aria-selected', String(i === active)); });
      $('address').setAttribute('aria-activedescendant', 'place-' + active); $('suggestions').children[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') { event.preventDefault(); if (active >= 0) pick(active); }
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.autocomplete')) closeSuggestions(); });
  $('employee').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; cancelSearch(); notice(''); $('create').disabled = true; $('create').textContent = 'Đang tạo hồ sơ…';
    const payload = {};
    for (const [key, value] of new FormData(event.target)) if (value.trim()) payload[key] = ['departmentId', 'positionId', 'currentSalary'].includes(key) ? Number(value) : value.trim();
    if (selected) payload.addressRefId = selected.refId;
    try {
      const result = await api('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
      $('resultTitle').textContent = 'Đã tạo ' + result.data.fullName;
      $('resultSummary').textContent = 'Mã: ' + result.data.employeeCode + ' · Tài khoản: ' + result.data.account.status + ' · Khoảng cách: ' + (result.data.distanceFromHomeKm == null ? 'chưa tính được (' + result.data.distanceCalculation.reason + ')' : result.data.distanceFromHomeKm + ' km') + ' · Email: ' + result.data.emailDelivery;
      $('result').textContent = JSON.stringify(result, null, 2); $('resultPanel').hidden = false; $('employee').hidden = true; $('resultPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (error) { notice(error.message); } finally { busy = false; $('create').disabled = false; $('create').textContent = 'Tạo hồ sơ và tài khoản'; }
  };
  $('newEmployee').onclick = () => { $('employee').reset(); selected = null; $('selected').hidden = true; $('resultPanel').hidden = true; $('employee').hidden = false; $('searchStatus').textContent = 'Gõ từ 3 ký tự để xem gợi ý từ Vietmap.'; notice(''); };
})();
