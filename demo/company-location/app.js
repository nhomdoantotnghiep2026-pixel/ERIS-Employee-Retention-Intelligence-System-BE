(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = null, session = 0, map, marker, circle;
  let searchTimer, searchAbort, searchVersion = 0, suggestions = [], activeIndex = -1, positionReady = true;
  const api = '/api/v1/attendance/company-location';
  function message(text, bad = false) { $('message').hidden = false; $('message').dataset.error = String(bad); $('message').textContent = text; }
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
  }
  function clearSuggestions() {
    clearTimeout(searchTimer); searchAbort?.abort(); searchVersion++;
    suggestions = []; activeIndex = -1;
    $('suggestions').replaceChildren(); $('suggestions').hidden = true;
    $('address').setAttribute('aria-expanded', 'false');
    $('address').removeAttribute('aria-activedescendant');
  }
  function selectSuggestion(place) {
    clearSuggestions();
    $('address').value = place.display || place.resolvedAddress || place.address || place.name;
    point(place.latitude, place.longitude);
    $('searchState').textContent = 'Đã chọn gợi ý Vietmap. Có thể kéo ghim để chỉnh vị trí trước khi lưu.';
    $('address').focus();
  }
  async function searchAddress(query, version, currentSession) {
    searchAbort = new AbortController();
    try {
      const result = await request('/api/distance/places?query=' + encodeURIComponent(query), { signal: searchAbort.signal });
      if (version !== searchVersion || currentSession !== session) return;
      suggestions = (result.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).slice(0, 5);
      $('suggestions').replaceChildren();
      suggestions.forEach((place, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.id = 'place-' + index;
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
        button.textContent = place.display || place.resolvedAddress || place.address || place.name;
        button.addEventListener('mousedown', e => e.preventDefault());
        button.addEventListener('click', () => selectSuggestion(place));
        $('suggestions').append(button);
      });
      $('suggestions').hidden = suggestions.length === 0;
      $('address').setAttribute('aria-expanded', String(suggestions.length > 0));
      $('searchState').textContent = suggestions.length ? 'Chọn một gợi ý để đưa bản đồ đến vị trí đó.' : 'Không có gợi ý. Nhập địa chỉ và chọn điểm trực tiếp trên bản đồ.';
    } catch (error) {
      if (error.name !== 'AbortError' && version === searchVersion && currentSession === session) {
        $('searchState').textContent = 'Không tìm được gợi ý: ' + error.message + '. Bạn vẫn có thể chọn điểm trên bản đồ.';
      }
    }
  }
  $('address').addEventListener('keydown', e => {
    if (e.key === 'Escape') { clearSuggestions(); return; }
    if ($('suggestions').hidden || suggestions.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...$('suggestions').children].forEach((button, index) => button.setAttribute('aria-selected', String(index === activeIndex)));
      $('address').setAttribute('aria-activedescendant', 'place-' + activeIndex);
      $('suggestions').children[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectSuggestion(suggestions[activeIndex]); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.address-box')) clearSuggestions(); });
  function point(lat, lng, pan = true) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    positionReady = true;
    $('latitude').value = lat.toFixed(8); $('longitude').value = lng.toFixed(8); $('confirm').checked = false;
    if (!window.L) { message('Không tải được bản đồ. Bạn vẫn có thể nhập tọa độ hoặc lấy GPS.', true); return; }
    if (!map) {
      map = L.map('map').setView([lat, lng], 17);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      circle = L.circle([lat, lng], { radius: 100, color: '#1557b0' }).addTo(map);
      map.on('click', e => point(e.latlng.lat, e.latlng.lng, false));
      marker.on('dragend', () => { const p = marker.getLatLng(); point(p.lat, p.lng, false); });
    }
    marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], 17);
  }
  async function load() {
    clearSuggestions();
    const currentSession = session;
    const result = await request(api);
    if (currentSession !== session) return;
    const data = result.data;
    $('editor').hidden = false; $('loginPanel').hidden = true;
    $('address').value = data.address;
    point(data.latitude, data.longitude);
    $('savedInfo').textContent = data.source === 'redis' ? `Đã lưu: ${new Date(data.updatedAt).toLocaleString('vi-VN')}` : 'Chưa lưu vào Redis. Đang hiển thị cấu hình ban đầu.';
    if (map) setTimeout(() => map.invalidateSize(), 0);
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginButton').disabled = true;
    try {
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      $('password').value = '';
      if (!result.accessToken) throw new Error('Tài khoản cần hoàn tất kích hoạt trước khi sử dụng.');
      token = result.accessToken; session++;
      await load(); message('Chọn điểm công ty rồi lưu để áp dụng cho chấm công.');
    } catch (error) { token = null; message(error.message, true); }
    finally { $('loginButton').disabled = false; }
  });
  $('logout').onclick = () => { token = null; session++; clearSuggestions(); $('editor').hidden = true; $('loginPanel').hidden = false; $('locationForm').reset(); $('message').hidden = true; };
  $('reload').onclick = async () => { try { await load(); } catch (error) { message(error.message, true); } };
  for (const id of ['latitude', 'longitude']) $(id).addEventListener('input', () => { if ($('latitude').value !== '' && $('longitude').value !== '') point(Number($('latitude').value), Number($('longitude').value)); });
  $('address').addEventListener('input', () => {
    $('confirm').checked = false; positionReady = false; clearSuggestions();
    const query = $('address').value.trim();
    $('searchState').textContent = 'Chọn gợi ý hoặc chọn lại điểm trên bản đồ để khớp địa chỉ vừa nhập.';
    if (query.length < 3 || query.length > 300) return;
    const version = searchVersion, currentSession = session;
    $('searchState').textContent = 'Đang tìm địa chỉ…';
    searchTimer = setTimeout(() => searchAddress(query, version, currentSession), 400);
  });
  $('gps').onclick = () => {
    if (!navigator.geolocation) return message('Trình duyệt không hỗ trợ GPS.', true);
    const currentSession = session;
    $('gps').disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
      $('gps').disabled = false;
      if (currentSession !== session) return;
      point(position.coords.latitude, position.coords.longitude);
      message(`Đã lấy GPS, sai số khoảng ${Math.round(position.coords.accuracy)} m. Kiểm tra và chỉnh điểm ghim trước khi lưu.`);
    }, error => { $('gps').disabled = false; if (currentSession === session) message(`Không lấy được GPS: ${error.message}. Dùng localhost hoặc HTTPS và cho phép truy cập vị trí.`, true); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };
  $('locationForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!positionReady) return message('Địa chỉ đã thay đổi. Chọn gợi ý hoặc chọn lại điểm trên bản đồ trước khi lưu.', true);
    clearSuggestions();
    const currentSession = session;
    const body = { address: $('address').value.trim(), latitude: Number($('latitude').value), longitude: Number($('longitude').value) };
    $('fields').disabled = true; $('logout').disabled = true;
    if (map) { map.dragging.disable(); marker.dragging.disable(); }
    try {
      await request(api, { method: 'PUT', body: JSON.stringify(body) });
      if (currentSession === session) { await load(); message('Đã lưu. Check-in/check-out sử dụng vị trí mới ngay.'); }
    } catch (error) { if (currentSession === session) message(error.message, true); }
    finally { $('fields').disabled = false; $('logout').disabled = false; if (map) { map.dragging.enable(); marker.dragging.enable(); } }
  });
})();
