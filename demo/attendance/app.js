(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = '/api/v1/attendance';
  let token = '', today = null, busy = false, generation = 0, todayRequest = 0, accountId = null, mode = 'check-in';
  const message = text => { $('notice').textContent = text; };
  const gpsMessage = (text, kind = '') => { $('gpsStatus').textContent = text; $('gpsStatus').dataset.kind = kind; };
  function reset() {
    generation++; todayRequest++; token = ''; today = null; accountId = null; mode = 'check-in'; 
    if ($('checkDialog').open) $('checkDialog').close();
    $('loginPanel').hidden = false; $('dashboard').hidden = true; $('logout').hidden = true;
    $('password').value = ''; $('openCheck').disabled = true; $('loginButton').disabled = false; busy = false;
    for (const id of ['welcome','day','checkTime','checkoutTime','locationStatus','working','overtime','stateTitle','stateDetail']) $(id).textContent = '';
    $('openCheck').textContent = 'Check-in'; gpsMessage('');
  }
  async function api(url, options = {}) {
    const requestGeneration = generation;
    const access = token;
    const response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin', headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(access ? { Authorization: 'Bearer ' + access } : {})
    } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && access && requestGeneration === generation && access === token) { reset(); message('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
      const error = new Error(data.message || 'Không thể xử lý yêu cầu. Vui lòng thử lại.'); error.status = response.status; throw error;
    }
    return data;
  }
  function popup(nextMode) {
    if (!token || busy) return;
    mode = nextMode;
    $('dialogTitle').textContent = mode === 'check-in' ? 'Check-in hôm nay' : 'Check-out hôm nay';
    $('gpsButton').textContent = mode === 'check-in' ? 'Lấy GPS và check-in' : 'Lấy GPS và check-out';
    $('gpsButton').disabled = false; $('later').disabled = false; gpsMessage('');
    if (!$('checkDialog').open) $('checkDialog').showModal();
  }
  function render(state, showPrompt = false) {
    today = state; $('day').textContent = state.date; $('checkTime').textContent = state.checkedInAtLocal || 'Chưa check-in';
    $('checkoutTime').textContent = state.checkedOutAtLocal || 'Chưa check-out';
    $('working').textContent = (state.attendance?.workingMinutes ?? 0) + ' phút';
    $('overtime').textContent = (state.attendance?.overtimeMinutes ?? 0) + ' phút';
    $('locationStatus').textContent = ({ PRESENT:'Có đi làm', LATE:'Đi làm trễ', ABSENT:'Vắng mặt', ON_LEAVE:'Nghỉ phép', HOLIDAY:'Ngày nghỉ lễ' })[state.attendance?.attendanceStatus] || 'Chưa ghi nhận';
    $('stateTitle').textContent = state.checkedOut ? 'Đã hoàn tất chấm công hôm nay' : !state.workday ? 'Hôm nay không phải ngày làm việc' : state.checkedIn ? 'Bạn đã check-in hôm nay' : 'Bạn chưa check-in hôm nay';
    $('stateDetail').textContent = state.checkedOut ? 'Thời gian làm việc đã trừ nghỉ trưa 12:00–13:00. Tăng ca tính sau 17:00.' : state.checkedIn ? 'Khi kết thúc làm việc, bấm check-out để ghi nhận thời gian.' : 'Xác nhận GPS trong bán kính 100 m để bắt đầu ngày làm việc.';
    $('openCheck').disabled = !state.workday || state.checkedOut;
    $('openCheck').textContent = state.checkedOut ? 'Đã check-out' : state.checkedIn ? 'Check-out' : 'Check-in';
    if (showPrompt && state.showCheckInPrompt) popup('check-in');
  }
  async function loadToday(showPrompt = false) {
    const current = generation, request = ++todayRequest;
    const state = await api(base + '/today');
    if (current !== generation || !token || request !== todayRequest) return false;
    if (accountId != null && state.user?.id != null && String(accountId) !== String(state.user.id)) {
      reset(); throw new Error('Trạng thái chấm công không khớp tài khoản. Vui lòng đăng nhập lại.');
    }
    render(state, showPrompt); $('dashboard').hidden = false; return true;
  }
  $('login').addEventListener('submit', async event => {
    event.preventDefault(); if ($('loginButton').disabled) return;
    reset(); $('loginButton').disabled = true; message(''); const current = generation;
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      if (current !== generation) return;
      $('password').value = '';
      if (!result.accessToken) throw new Error('Tài khoản chưa kích hoạt. Hãy hoàn tất xác minh OTP và đặt mật khẩu trước khi dùng màn hình này.');
      token = result.accessToken; accountId = result.user?.id ?? null;
      $('welcome').textContent = result.user?.fullName || result.user?.email || $('email').value.trim();
      $('loginPanel').hidden = true; $('dashboard').hidden = true; $('logout').hidden = false;
      await loadToday(true);
    } catch (error) {
      if (current !== generation) return;
      reset();
      message(error.status === 403 ? 'Tài khoản chưa có hồ sơ nhân viên đang hoạt động. Hãy nhờ HR kiểm tra hồ sơ.' : error.message);
    } finally { if (current === generation) $('loginButton').disabled = false; }
  });
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext || !navigator.geolocation) return reject(new Error('GPS cần mở trang bằng localhost hoặc HTTPS trên trình duyệt hỗ trợ vị trí.'));
      navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(({
        1: 'Bạn chưa cho phép truy cập vị trí. Mở quyền Vị trí của trang trong trình duyệt rồi thử lại.',
        2: 'Chưa xác định được vị trí. Hãy bật dịch vụ vị trí/GPS trên thiết bị rồi thử lại.',
        3: 'Lấy GPS quá thời gian. Hãy thử lại ở nơi có tín hiệu tốt hơn.'
      })[error.code] || 'Không lấy được vị trí.')), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    });
  }
  $('gpsButton').addEventListener('click', async () => {
    if (busy || !token) return;
    busy = true; const current = generation;
    $('gpsButton').disabled = true; $('later').disabled = true;
    gpsMessage('Đang lấy vị trí GPS… Hãy cho phép truy cập vị trí khi trình duyệt hỏi.');
    try {
      const position = await getLocation();
      if (current !== generation || !token) return;
      gpsMessage('Đã lấy GPS. Đang gửi xác nhận…');
      const result = await api(base + '/' + mode, { method: 'POST', body: JSON.stringify({
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString()
      }) });
      if (current !== generation) return;
      const detail = 'Cách công ty ' + result.distanceMeters + ' m · Sai số GPS ' + Math.round(result.accuracyMeters) + ' m.';
      if (result.status === 'INSIDE' && result.persisted) {
        $('checkDialog').close(); message((mode === 'check-in' ? 'Check-in thành công. ' : 'Check-out thành công. ') + detail);
      } else {
        gpsMessage((result.status === 'LOW_ACCURACY' ? 'GPS chưa đủ chính xác. Hãy lấy lại vị trí ở nơi thoáng hơn. ' : 'Bạn đang ngoài bán kính 100 m. Hãy đến gần công ty và thử lại. ') + detail, 'error');
      }
      await loadToday();
    } catch (error) {
      if (current !== generation) return;
      gpsMessage(error.message, 'error');
      if (error.status === 409) {
        try { await loadToday(); if ((today?.checkedIn && mode === 'check-in') || (today?.checkedOut && mode === 'check-out')) { $('checkDialog').close(); message(mode === 'check-in' ? 'Bạn đã check-in hôm nay.' : 'Bạn đã check-out hôm nay.'); } } catch { /* Keep original error. */ }
      }
    } finally {
      if (current === generation) { busy = false; $('gpsButton').disabled = false; $('later').disabled = false; }
    }
  });
  $('later').addEventListener('click', () => { if (!busy) $('checkDialog').close(); });
  $('checkDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('openCheck').addEventListener('click', () => { if (today?.workday && !today.checkedOut) popup(today.checkedIn ? 'check-out' : 'check-in'); });
  $('refresh').addEventListener('click', async () => { message(''); try { await loadToday(true); } catch (error) { message(error.message); } });
  $('logout').addEventListener('click', async () => {
    if (busy) return; reset(); message('');
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { message('Đã thoát màn hình. Nếu cần, thử đăng xuất lại để đóng phiên trên server.'); }
  });
})();
