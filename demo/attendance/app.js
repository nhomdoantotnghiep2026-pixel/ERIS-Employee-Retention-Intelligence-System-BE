(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = '/api/v1/attendance';
  let token = null, session = 0, profile = null, today = null, busy = false, action = 'check-in';
  const names = { PRESENT: 'Có đi làm', LATE: 'Đi làm trễ', ABSENT: 'Vắng mặt', ON_LEAVE: 'Nghỉ phép', HOLIDAY: 'Ngày nghỉ lễ', EARLY_LEAVE: 'Về sớm', LATE_EARLY_LEAVE: 'Đi trễ và về sớm' };
  function notice(text, bad = false) { $('notice').hidden = false; $('notice').dataset.bad = String(bad); $('notice').textContent = text; }
  function showResponse(data) { $('response').textContent = JSON.stringify(data, null, 2); }
  async function request(path, options = {}) {
    const response = await fetch(path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.message || `HTTP ${response.status}`); error.code = data.code; throw error; }
    return data;
  }
  function date(value) { return value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : 'Chưa ghi nhận'; }
  function render() {
    $('checkInButton').hidden = !today || !today.workday || today.checkedIn || today.checkedOut;
    $('checkOutButton').hidden = !today || !today.workday || !today.checkedIn || today.checkedOut;
    for (const id of ['checkInButton', 'checkOutButton', 'reload', 'logout', 'confirm', 'cancel']) $(id).disabled = busy;
    if (!today) {
      for (const id of ['workDate', 'checkIn', 'checkOut', 'status', 'working', 'overtime']) $(id).textContent = '—';
      $('stateTitle').textContent = 'Chưa tải được trạng thái chấm công';
      return;
    }
    $('name').textContent = profile?.fullName || profile?.email || 'Nhân viên';
    $('identity').textContent = `Mã hồ sơ: ${today.user.employeeId}`;
    $('workDate').textContent = today.date;
    $('checkIn').textContent = date(today.attendance?.checkIn || today.checkedInAt);
    $('checkOut').textContent = date(today.attendance?.checkOut || today.checkedOutAt);
    $('status').textContent = names[today.attendance?.attendanceStatus] || 'Chưa chấm công';
    $('working').textContent = `${today.attendance?.workingMinutes ?? 0} phút`;
    $('overtime').textContent = `${today.attendance?.overtimeMinutes ?? 0} phút`;
    $('stateTitle').textContent = today.attendance?.attendanceStatus==='ON_LEAVE' ? 'Bạn nghỉ phép hôm nay' : today.checkedOut ? 'Bạn đã hoàn tất chấm công hôm nay' : today.checkedIn ? 'Bạn đã check-in hôm nay' : today.workday ? 'Bạn chưa check-in hôm nay' : 'Hôm nay không cần chấm công';
  }
  async function load() {
    const current = session;
    const data = await request(base + '/today');
    const config = await request(base + '/config');
    if (current !== session || !token) return;
    today = data;
    $('scheduleDescription').textContent =
      `${config.workStart}–${config.workEnd} · Nghỉ trưa ${config.lunchStart}–${config.lunchEnd} · Ngày làm (1=T2, 7=CN): ${config.schedule.workingDays.join(', ')} · ${config.schedule.name}`;
    $('companyAddress').textContent = config.companyLocation.address || 'Vị trí công ty';
    $('companyCoordinates').textContent = `${config.companyLocation.latitude}, ${config.companyLocation.longitude} · Bán kính ${config.allowedRadiusMeters} m · GPS sai số tối đa ${config.maximumAccuracyMeters} m`;
    render();
  }
  function openPrompt(nextAction) {
    action = nextAction;
    $('promptTitle').textContent = action === 'check-in' ? 'Check-in hôm nay' : 'Check-out kết thúc ngày làm việc';
    $('confirm').textContent = action === 'check-in' ? 'Lấy GPS và check-in' : 'Lấy GPS và check-out';
    $('progress').textContent = '';
    $('prompt').showModal();
  }
  function gps() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Trình duyệt không hỗ trợ GPS.'));
      navigator.geolocation.getCurrentPosition(position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }), error => reject(new Error(({ 1: 'Bạn chưa cho phép truy cập vị trí.', 2: 'Không xác định được vị trí thiết bị.', 3: 'Lấy GPS quá lâu. Hãy thử lại.' })[error.code] || error.message)), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginButton').disabled = true;
    // Reset all account-dependent data before accepting another login.
    session++; token = null; today = null; profile = null;
    try {
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      $('password').value = '';
      if (!result.accessToken) throw new Error('Tài khoản chưa hoàn tất kích hoạt email và đặt mật khẩu.');
      token = result.accessToken; profile = result.user;
      await load();
      $('loginPanel').hidden = true; $('attendancePanel').hidden = false;
      notice('Đã tải trạng thái chấm công của tài khoản đang đăng nhập.');
      if (today.showCheckInPrompt) openPrompt('check-in');
    } catch (error) { token = null; today = null; profile = null; notice(error.message, true); }
    finally { $('loginButton').disabled = false; }
  });
  $('logout').onclick = async () => {
    // Logout uses the auth refresh cookie. Never reuse attendance state across accounts.
    $('loginButton').disabled = true;
    session++; token = null; today = null; profile = null;
    $('prompt').close(); $('attendancePanel').hidden = true; $('loginPanel').hidden = false;
    $('loginForm').reset(); $('response').textContent = ''; $('notice').hidden = true; render();
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    catch { /* The local access token is already cleared. */ }
    finally { $('loginButton').disabled = false; }
  };
  $('reload').onclick = async () => {
    if (busy) return; busy = true; render();
    try { await load(); notice('Đã tải lại trạng thái từ máy chủ.'); }
    catch (error) { today = null; notice(error.message, true); }
    finally { busy = false; render(); }
  };
  $('checkInButton').onclick = () => openPrompt('check-in');
  $('checkOutButton').onclick = () => openPrompt('check-out');
  $('cancel').onclick = () => $('prompt').close();
  $('prompt').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('confirm').onclick = async () => {
    if (busy || !token) return;
    const current = session, selectedAction = action;
    busy = true; render(); $('progress').textContent = 'Đang lấy GPS…';
    try {
      const position = await gps();
      if (current !== session) return;
      $('progress').textContent = 'Đang gửi chấm công…';
      const result = await request(base + '/' + selectedAction, { method: 'POST', body: JSON.stringify(position) });
      if (current !== session) return;
      showResponse(result); $('prompt').close();
      if (result.persisted === true) {
        notice(`${selectedAction === 'check-in' ? 'Check-in' : 'Check-out'} thành công, đã lưu database. Cách công ty ${result.distanceMeters} m · Sai số GPS ${Math.round(result.accuracyMeters)} m.`);
      } else {
        notice(result.status === 'LOW_ACCURACY' ? `Chưa ghi nhận: sai số GPS ${Math.round(result.accuracyMeters)} m quá lớn.` : `Chưa ghi nhận: bạn cách công ty ${result.distanceMeters} m, ngoài bán kính ${result.allowedRadiusMeters} m.`, true);
      }
      await load();
    } catch (error) {
      if (current !== session) return;
      $('prompt').close(); notice(error.message + ' Kiểm tra trạng thái trước khi thử lại.', true);
      try { await load(); } catch { today = null; }
    } finally { busy = false; $('progress').textContent = ''; render(); }
  };
})();
