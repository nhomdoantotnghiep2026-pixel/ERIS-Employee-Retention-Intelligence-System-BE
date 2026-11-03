const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../docs');
const titles = { auth: 'Xác thực tài khoản', users: 'Quản lý tài khoản', departments: 'Phòng ban', positions: 'Vị trí công việc', employees: 'Nhân viên', surveys: 'Khảo sát', education: 'Bằng cấp', 'work-experiences': 'Kinh nghiệm làm việc', 'job-histories': 'Lịch sử công việc', 'audit-logs': 'Nhật ký hoạt động', attendance: 'Chấm công', distance: 'Tìm kiếm địa điểm' };
const labels = {
  'Login missing fields': 'Không nhập email hoặc mật khẩu',
  'Login wrong password': 'Nhập sai mật khẩu',
  'Admin login': 'Admin đăng nhập đúng email và mật khẩu',
  'Me without token': 'Không gửi access token',
  'Me invalid token': 'Gửi token không hợp lệ',
  'Me admin': 'Xem thông tin admin bằng access token hợp lệ',
  'Refresh without cookie': 'Không gửi cookie refresh token',
  'Refresh rotates session': 'Làm mới phiên bằng cookie hợp lệ',
  'Refresh old cookie': 'Dùng lại cookie cũ sau khi đã làm mới phiên',
  'Logout valid session': 'Đăng xuất phiên hợp lệ',
  'Refresh after logout': 'Làm mới phiên đã đăng xuất',
  'Logout without cookie': 'Đăng xuất khi không có cookie',
  'Register without token': 'Tạo HR nhưng không gửi access token',
  'Register rejects password field': 'Gửi thêm trường password khi tạo HR',
  'Register invalid email': 'Nhập email sai định dạng',
  'Admin creates requested HR': 'Admin tạo tài khoản HR hợp lệ',
  'Duplicate HR email': 'Tạo HR bằng email đã tồn tại',
  'HR login with requested password': 'HR đăng nhập lần đầu khi chưa kích hoạt',
  'Setup token cannot access me': 'Dùng token thiết lập mật khẩu để xem thông tin tài khoản',
  'Setup rejects malformed OTP': 'Nhập OTP sai định dạng khi thiết lập mật khẩu',
  'HR setup with delivered OTP': 'Kích hoạt HR bằng OTP vừa gửi qua email',
  'Active HR login': 'HR đã kích hoạt đăng nhập thành công',
  'Me HR active': 'Xem thông tin HR đã kích hoạt',
  'HR cannot register HR': 'HR tự tạo thêm tài khoản HR',
  'Change OTP without token': 'Yêu cầu OTP đổi mật khẩu nhưng không có token',
  'Request change OTP': 'Yêu cầu gửi OTP đổi mật khẩu bằng token hợp lệ',
  'Wrong current password': 'Nhập sai mật khẩu hiện tại khi đổi mật khẩu',
  'Change password delivered OTP': 'Đổi mật khẩu bằng mật khẩu hiện tại và OTP đúng',
  'Refresh revoked after password change': 'Dùng refresh token cũ sau khi đổi mật khẩu',
  'Forgot invalid email': 'Quên mật khẩu nhưng nhập email sai định dạng',
  'Forgot unknown email hides existence': 'Yêu cầu quên mật khẩu với email không tồn tại',
  'Forgot active HR': 'Yêu cầu quên mật khẩu với HR đang hoạt động',
  'Reset delivered OTP': 'Đặt lại mật khẩu bằng OTP đúng',
  'Reset reused OTP': 'Dùng lại OTP đã được sử dụng',
  'Final HR login': 'Đăng nhập lại HR sau khi đổi và đặt lại mật khẩu',
  'List authorized': 'Lấy danh sách bằng tài khoản có quyền',
  'List without token': 'Lấy danh sách nhưng không có token',
  'HR cannot list accounts': 'HR truy cập danh sách tài khoản dành cho admin',
  'Without token': 'Gọi API nhưng không gửi token',
  'HR without employee profile': 'HR chưa có hồ sơ nhân viên gọi API chấm công',
  'Admin forbidden': 'Admin truy cập API không thuộc quyền của mình',
  'Create missing fields': 'Tạo mới nhưng thiếu trường bắt buộc',
  'Update invalid ID': 'Cập nhật bằng ID sai định dạng',
  'Update missing record': 'Cập nhật bản ghi không tồn tại',
  'Create valid record': 'Tạo mới với dữ liệu đúng theo API hiện tại',
  'Update created record': 'Cập nhật bản ghi vừa tạo',
  'Read created record': 'Xem chi tiết bản ghi vừa tạo',
  'Deactivate created record': 'Ngừng hoạt động bản ghi vừa tạo',
  'Deactivate already inactive': 'Ngừng hoạt động bản ghi đã ngừng trước đó',
  'Invalid department filter': 'Lọc theo departmentId sai định dạng',
  'Filter by absent department': 'Lọc theo phòng ban không tồn tại',
  'Admin cannot list employees': 'Admin truy cập danh sách nhân viên dành cho HR',
  'Read missing employee': 'Xem nhân viên không tồn tại',
  'Read invalid ID': 'Xem chi tiết bằng ID sai định dạng',
  'HR without own employee profile': 'HR xem hồ sơ cá nhân khi chưa có hồ sơ nhân viên',
  'Reject immutable email update': 'Cập nhật trường email không được phép thay đổi',
  'Get own HR as admin': 'Admin xem chi tiết tài khoản HR',
  'Missing user': 'Xem tài khoản không tồn tại',
  'Invalid user ID': 'Truyền ID tài khoản sai định dạng',
  'HR cannot change status': 'HR đổi trạng thái tài khoản khi không có quyền admin',
  'Invalid status': 'Gửi trạng thái không hợp lệ',
  'Admin cannot list surveys': 'Admin truy cập danh sách khảo sát dành cho HR',
  'Create missing title': 'Tạo khảo sát nhưng thiếu tiêu đề',
  'Create invalid date range': 'Ngày kết thúc khảo sát trước ngày bắt đầu',
  'Create draft with default questions': 'Tạo khảo sát nháp kèm câu hỏi mặc định',
  'Missing survey participants': 'Xem người tham gia khảo sát không tồn tại',
  'Invalid survey ID': 'Truyền ID khảo sát sai định dạng',
  'Submit malformed answers': 'Gửi câu trả lời có điểm ngoài khoảng 1 đến 4',
  'Missing employee': 'Truyền ID nhân viên không tồn tại',
  'Invalid employee ID': 'Truyền ID nhân viên sai định dạng',
  'List active employee options': 'Lấy danh sách nhân viên đang hoạt động để chọn',
  'Invalid institution query': 'Tìm trường học bằng tham số query không được hỗ trợ',
  'HR forbidden': 'HR truy cập nhật ký chỉ dành cho admin',
  'Invalid log ID': 'Truyền ID nhật ký sai định dạng',
  'Missing log': 'Xem nhật ký không tồn tại',
  'Audit records after CRUD': 'Lấy nhật ký sau khi tạo và cập nhật dữ liệu',
  'Read audit detail': 'Xem chi tiết một nhật ký hợp lệ',
  'Query too short': 'Tìm địa điểm bằng từ khóa quá ngắn',
  'Search actual provider': 'Tìm địa điểm bằng dịch vụ bản đồ thật'
};
const reasons = {
  positions: 'Database bắt buộc department_id nhưng API hiện tại không nhận và không ghi trường này.',
  surveys: 'Code dùng survey_questions.dimension_code nhưng database mới không có cột này.',
  education: 'Code dùng employee_educations.status nhưng database mới không có cột này.',
  'work-experiences': 'Database mới không có bảng public.employee_work_experiences.',
  'job-histories': 'Code dùng employee_job_histories.manager_id nhưng database mới không có cột này.'
};
const json = value => '```json\n' + JSON.stringify(value, null, 2) + '\n```\n';
function authRequest(row) {
  const email = '<email tài khoản>', password = '<mật khẩu>';
  switch (row.url) {
    case '/api/auth/login': return row.label === 'Login missing fields' ? {} : { email, password: row.label === 'Login wrong password' ? '<mật khẩu sai>' : password };
    case '/api/auth/user_register': return { email: row.label === 'Register invalid email' ? 'invalid' : '<email HR>', ...(row.label === 'Register rejects password field' ? { password } : {}) };
    case '/api/auth/change-password': return { ...(row.label.includes('current password') || row.label === 'Change password delivered OTP' ? { currentPassword: row.label === 'Wrong current password' ? '<mật khẩu hiện tại sai>' : password } : {}), otp: row.label === 'Setup rejects malformed OTP' ? 'abc' : '<OTP 6 chữ số>', newPassword: '<mật khẩu mới>' };
    case '/api/auth/forgot-password': return { email: row.label === 'Forgot invalid email' ? 'invalid' : row.label === 'Forgot unknown email hides existence' ? 'missing-api-test@example.invalid' : email };
    case '/api/auth/reset-password': return { email, otp: '<OTP 6 chữ số>', newPassword: '<mật khẩu mới>' };
    default: return undefined;
  }
}
function successExample(row) {
  const message = row.message === 'Response shape verified' ? undefined : row.message;
  if (row.module === 'auth') {
    if (row.url.endsWith('/login')) return row.label === 'HR login with requested password'
      ? { message, passwordChangeToken: '<JWT thiết lập mật khẩu>' }
      : { message, accessToken: '<JWT truy cập>', user: { id: '<ID tài khoản>', email: '<email>', fullName: '<tên hoặc null>', roleId: '<ID vai trò>', status: 'ACTIVE' } };
    if (row.url.endsWith('/me')) return { id: '<ID tài khoản>', email: '<email>', status: 'ACTIVE', role: row.label === 'Me admin' ? 'ADMIN' : 'HR', fullName: '<tên hoặc null>' };
    if (row.url.endsWith('/refresh')) return { accessToken: '<JWT truy cập mới>' };
    if (row.url.endsWith('/user_register')) return { message, data: { id: '<ID HR>', email: '<email HR>', fullName: null, roleId: '<ID role HR>', status: 'IN_PROCESS', employeeId: null, createdAt: '<thời điểm tạo>', role: 'HR', emailDelivery: 'SENT' } };
    return { message };
  }
  if (row.module === 'distance') return { places: [] };
  const list = row.label.includes('List') || row.label.includes('list') || row.label === 'Filter by absent department' || row.label === 'Audit records after CRUD';
  return { ...(message ? { message } : {}), data: list ? [] : { id: '<ID bản ghi>', ...(row.label === 'Deactivate created record' ? { status: 'INACTIVE' } : {}) } };
}
function render() {
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'api-test-results.json'), 'utf8'));
  for (const module of new Set(report.results.map(r => r.module))) {
    if (module === 'auth' && fs.existsSync(path.join(dir, 'auth-comprehensive-test-results.md'))) {
      fs.copyFileSync(path.join(dir, 'auth-comprehensive-test-results.md'), path.join(dir, 'auth-api-test-results.md'));
      continue;
    }
    const rows = report.results.filter(r => r.module === module);
    let output = `# ${titles[module]} — API đã kiểm thử\n\nNgày test: 03/11/2026.\n\nKết quả: ${rows.filter(r => r.passed).length}/${rows.length} trường hợp đạt yêu cầu.\n\nCác mã HTTP và thông báo lỗi dưới đây lấy từ kết quả test đã lưu. JSON thành công là minh họa cấu trúc theo code, có thể rút gọn; không phải toàn bộ phản hồi đã lưu của lần test. Dấu <...> là giá trị thay thế. Danh sách [] minh họa kiểu dữ liệu mảng, không khẳng định kết quả test là danh sách rỗng.\n\n`;
    const groups = new Map();
    for (const row of rows) {
      const endpoint = row.method + ' ' + row.url.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace('/abc', '/:id');
      if (!groups.has(endpoint)) groups.set(endpoint, []);
      groups.get(endpoint).push(row);
    }
    for (const [endpoint, cases] of groups) {
      output += `## ${endpoint}\n\n`;
      output += module === 'auth' ? (endpoint.endsWith('/refresh') || endpoint.endsWith('/logout') ? 'Phiên đăng nhập dùng cookie `eris_refresh`.\n\n' : endpoint.endsWith('/user_register') ? 'Cần access token của ADMIN đang hoạt động.\n\n' : endpoint.endsWith('/me') || endpoint.endsWith('/change-password/otp') ? 'Cần header `Authorization: Bearer <accessToken>`.\n\n' : endpoint.endsWith('/change-password') ? 'Dùng access token khi đổi mật khẩu, hoặc passwordChangeToken khi thiết lập lần đầu.\n\n' : 'Gửi dữ liệu JSON, không cần access token.\n\n') : 'Gửi header `Authorization: Bearer <accessToken>` của tài khoản có quyền. Những case thiếu token hoặc sai vai trò được ghi riêng bên dưới.\n\n';
      for (const row of cases) {
        output += `### ${labels[row.label] || row.label}\n\n`;
        output += `Đã gọi: \`${row.method} ${row.url}\`.\n\n`;
        const request = row.request === undefined && module === 'auth' ? authRequest(row) : row.request;
        if (request !== undefined) output += (module === 'auth' ? 'Dữ liệu gửi minh họa cho case đã test:\n\n' : 'Dữ liệu đã gửi:\n\n') + json(request) + '\n';
        output += `HTTP trả về: **${row.actual}**.\n\n`;
        if (row.actual >= 400) output += 'Nội dung trả về:\n\n' + json({ message: row.message }) + '\n';
        else output += 'Ví dụ cấu trúc trả về:\n\n' + json(successExample(row)) + '\n';
        if (row.module === 'auth' && row.actual === 200 && row.url.endsWith('/login') && row.label !== 'HR login with requested password') output += 'Kèm cookie HttpOnly `eris_refresh` để làm mới phiên.\n\n';
        if (row.module === 'auth' && row.actual === 200 && row.url.endsWith('/refresh')) output += 'Kèm cookie refresh mới; cookie cũ bị thu hồi.\n\n';
        if (row.passed) output += 'Kết luận: **Đạt yêu cầu**.\n\n';
        else output += `Kết luận: **Chưa đạt**. Mong đợi HTTP ${row.expected}, thực tế HTTP ${row.actual}.\n\nNguyên nhân đã kiểm tra: ${reasons[module] || 'Xem tài liệu đối chiếu schema.'}\n\n`;
      }
    }
    output += '## Ghi chú\n\nChỉ những trường hợp ghi ở trên đã được kiểm thử. Xem [tổng hợp](./api-test-index.md) và [lỗi tương thích database](./schema-compatibility-findings.md).\n';
    if (module === 'auth') output += '\nHR yêu cầu đã ACTIVE và đăng nhập được. SMTP thật đã chấp nhận email; OTP chỉ giữ trong bộ nhớ test. Mật khẩu cuối giữ đúng yêu cầu, không ghi vào tài liệu. Chưa test hết hạn JWT/OTP, vượt số lần thử OTP và yêu cầu đồng thời.\n';
    fs.writeFileSync(path.join(dir, `${module}-api-test-results.md`), output);
  }
  // Convert the schema findings table to a numbered list as well.
  const findings = path.join(dir, 'schema-compatibility-findings.md');
  if (fs.existsSync(findings)) {
    const lines = fs.readFileSync(findings, 'utf8').split('\n');
    let count = 0;
    const output = lines.flatMap(line => {
      if (!line.startsWith('|')) return [line];
      const cells = line.split('|').slice(1, -1).map(s => s.trim());
      if (cells[0] === 'Module' || cells.every(s => /^[-:]+$/.test(s))) return [];
      count++;
      return [`### ${count}. ${cells[0]}`, '', `API: \`${cells[1]}\`.`, '', `HTTP thực tế: **${cells[2]}**.`, '', `Nguyên nhân: ${cells[3]}`, '', 'Nội dung trả về:', '', json({ message: 'Internal server error.' }), ''];
    }).join('\n');
    fs.writeFileSync(findings, output);
  }
}
if (require.main === module) render();
module.exports = { render };
