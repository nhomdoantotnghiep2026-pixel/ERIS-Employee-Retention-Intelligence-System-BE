// Real HTTP/JWT, real repositories on PostgreSQL TEMP tables, real Redis in a unique namespace.
// SMTP is controlled in memory so negative tests never send messages or change real accounts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const { databasePool } = require('../src/config/database');
const { redisClient, ensureRedisConnection } = require('../src/config/redis');
const { AuthRepository } = require('../src/modules/auth/auth.repository');
const { AuthService } = require('../src/modules/auth/auth.service');
const { AuthController } = require('../src/modules/auth/auth.controller');
const { createAuthRouter } = require('../src/modules/auth/auth.routes');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { hashPassword } = require('../src/common/utils/password');
const { hashOtp } = require('../src/common/utils/otp');
const results = [], messages = new Map();
const prefix = `auth-test:${crypto.randomUUID()}:`;
const keys = new Set();
let client, server, base, service, actors, mailMode = 'ok', redisDown = false, barrier;
const initial = crypto.randomBytes(16).toString('hex');
const changed = crypto.randomBytes(16).toString('hex');
const reset = crypto.randomBytes(16).toString('hex');
function key(k) { const value = prefix + k; keys.add(value); return value; }
const redis = {
  async get(k) {
    const value = await redisClient.get(key(k));
    if (barrier?.key === k) { const b = barrier; if (++b.count === 2) b.resolve(); await b.ready; }
    return value;
  },
  set: (k, ...args) => redisClient.set(key(k), ...args),
  del: (...ks) => redisClient.del(...ks.map(key)),
  smembers: k => redisClient.smembers(key(k)),
  multi() {
    const transaction = redisClient.multi();
    const wrapper = {};
    for (const method of ['del', 'srem', 'set', 'sadd', 'expire']) wrapper[method] = (k, ...args) => { transaction[method](key(k), ...args); return wrapper; };
    wrapper.exec = () => transaction.exec(); return wrapper;
  }
};
const mail = { async sendMail(message) {
  if (mailMode === 'throw') throw new Error('Simulated SMTP outage');
  if (mailMode === 'reject') return { accepted: [], rejected: [message.to] };
  const otp = message.text.match(/Your ERIS OTP is (\d{6})/)?.[1];
  if (otp) messages.set(message.to, otp);
  return { accepted: [message.to], rejected: [] };
} };
function token(actor, type = 'ACCESS', extra = {}, options = {}) {
  return jwt.sign({ type, roleId: actor.roleId, status: actor.status, ...extra }, env.auth.jwtSecret,
    { subject: String(actor.id), expiresIn: 300, ...options });
}
function redact(value, name = '') {
  if (/password|token|cookie|otp/i.test(name)) return '<đã ẩn>';
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, redact(v,k)]));
  return value;
}
async function check(label, method, endpoint, expected, options = {}) {
  // Existing registration cases require a valid name unless they test full_name itself.
  if (endpoint === '/user_register' && options.body && !Array.isArray(options.body) && !label.startsWith('full_name')) {
    options.body = { full_name: 'Nguyễn Văn HR', ...options.body };
  }
  const headers = { ...(options.body !== undefined || options.raw ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers };
  const response = await fetch(base + endpoint, { method, headers, body: options.raw || (options.body !== undefined ? JSON.stringify(options.body) : undefined), signal: AbortSignal.timeout(20000) });
  let data; const text = await response.text(); try { data = JSON.parse(text); } catch { data = { text }; }
  const cookie = response.headers.get('set-cookie');
  const passed = response.status === expected && (!options.message || data.message === options.message) && (!options.verify || await options.verify(data, cookie));
  results.push({ label, method, endpoint, expected, actual: response.status, passed, request: options.body === undefined ? undefined : redact(options.body), rawRequest: options.raw, response: redact(data), cookie: cookie ? redact(cookie, 'cookie') : undefined, expectedMessage: options.message, note: options.note });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label} (${response.status}/${expected})`);
  return { data, cookie: cookie?.split(';')[0], rawCookie: cookie, passed };
}
function assertion(label, passed, note) { results.push({ label, method: 'CHECK', endpoint: 'invariant', expected: true, actual: passed, passed, note }); console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); }
const bodyLogin = actor => ({ email: actor.email, password: initial });
const login = (actor, label = 'Đăng nhập tài khoản ACTIVE') => check(label, 'POST', '/login', 200, { body: bodyLogin(actor), verify: d => Boolean(d.accessToken && !d.passwordChangeToken && !d.user.password) });
const otpKey = (purpose, actor) => `auth:otp:${purpose}:${actor.id}`;
async function seedOtp(actor, purpose = 'CHANGE_PASSWORD', otp = '123456') { await redis.set(otpKey(purpose, actor), JSON.stringify({ hash: hashOtp(otp), attempts: 0 }), 'EX', 120); return otp; }
async function setStatus(actor, status) { await client.query('UPDATE users SET status=$2 WHERE id=$1', [actor.id, status]); }
async function setup() {
  client = await databasePool.connect();
  await client.query(`CREATE TEMP TABLE role (LIKE public.role INCLUDING ALL);
    CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL);
    CREATE TEMP TABLE employees (LIKE public.employees INCLUDING ALL);
    SET search_path TO pg_temp, public;
    INSERT INTO role (name) VALUES ('ADMIN'),('HR'),('EMPLOYEE');`);
  const roles = (await client.query('SELECT id,name FROM role')).rows;
  const password = await hashPassword(initial);
  actors = {};
  for (const [name, role, status] of [['admin','ADMIN','ACTIVE'],['hr','HR','ACTIVE'],['employee','EMPLOYEE','ACTIVE'],['inactive','HR','INACTIVE'],['pending','HR','IN_PROCESS']]) {
    const roleId = roles.find(r => r.name === role).id;
    const { rows } = await client.query('INSERT INTO users(email,password,role_id,status) VALUES($1,$2,$3,$4) RETURNING id,email,status,role_id AS "roleId"', [`${name}@auth-test.invalid`,password,roleId,status]);
    actors[name] = rows[0];
  }
  // Block schema-qualified access to persistent user/employee tables in this fixture.
  const pool = { query: (...args) => client.query(...args), connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
  service = new AuthService({ authRepository: new AuthRepository(pool), mailTransporter: mail, redisClient: redis,
    ensureRedisConnection: async () => { if (redisDown) throw new Error('Simulated Redis outage'); return ensureRedisConnection(); }, initialPassword: initial });
  const app = express(); app.use(express.json()); app.use('/api/auth', createAuthRouter(new AuthController(service))); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/auth`;
}
async function run() {
  await setup();
  const { admin, hr, employee, inactive, pending } = actors;
  const adminToken = token(admin), hrToken = token(hr), employeeToken = token(employee), inactiveToken = token(inactive);
  // LOGIN
  for (const [label, body] of [['Thiếu body đăng nhập', undefined],['Body đăng nhập rỗng',{}],['Email đăng nhập sai định dạng',{email:'invalid',password:initial}],['Mật khẩu đăng nhập là số',{email:hr.email,password:12345678}],['Email đăng nhập là số',{email:123,password:initial}],['Mật khẩu đăng nhập rỗng',{email:hr.email,password:''}],['Body đăng nhập là mảng',[]]]) await check(label,'POST','/login',400,{body,message:'Email and password are required.'});
  await check('Nhập sai mật khẩu','POST','/login',401,{body:{email:hr.email,password:'wrong-password'},message:'Invalid email or password.'});
  await check('Email không tồn tại','POST','/login',401,{body:{email:'unknown@auth-test.invalid',password:initial},message:'Invalid email or password.'});
  await check('Tài khoản INACTIVE không được đăng nhập','POST','/login',403,{body:bodyLogin(inactive),message:'This user is not allowed to sign in.'});
  const active = await login(hr);
  assertion('Cookie login có HttpOnly, Path, SameSite và cờ Secure đúng cấu hình', /HttpOnly/i.test(active.rawCookie || '') && /Path=\/api\/auth/i.test(active.rawCookie || '') && active.rawCookie.toLowerCase().includes(`samesite=${env.auth.cookieSameSite}`) && /; Secure/i.test(active.rawCookie) === env.auth.cookieSecure);
  await check('Email được trim và không phân biệt hoa thường','POST','/login',200,{body:{email:`  ${hr.email.toUpperCase()}  `,password:initial},verify:d=>Boolean(d.accessToken)});
  const setupLogin = await check('Đăng nhập IN_PROCESS trả riêng token thiết lập và gửi OTP','POST','/login',200,{body:bodyLogin(pending),verify:(d,c)=>Boolean(d.passwordChangeToken && !d.accessToken && !c && messages.get(pending.email))});
  const setupToken = setupLogin.data.passwordChangeToken;
  await check('Đăng nhập IN_PROCESS lần hai tạo lại OTP','POST','/login',200,{body:bodyLogin(pending)});
  assertion('Redis lưu hash OTP và TTL dương, không lưu OTP rõ', (await redis.get(otpKey('CHANGE_PASSWORD',pending))).includes(hashOtp(messages.get(pending.email))) && !(await redis.get(otpKey('CHANGE_PASSWORD',pending))).includes(messages.get(pending.email)) && await redisClient.ttl(key(otpKey('CHANGE_PASSWORD',pending))) > 0);
  mailMode='throw'; await check('SMTP lỗi khi đăng nhập IN_PROCESS','POST','/login',500,{body:bodyLogin(pending),message:'Internal server error.'}); mailMode='ok';
  assertion('SMTP ném lỗi thì OTP vừa tạo bị xóa',await redis.get(otpKey('CHANGE_PASSWORD',pending))===null);
  redisDown=true; await check('Redis lỗi khi đăng nhập ACTIVE','POST','/login',500,{body:bodyLogin(hr),message:'Internal server error.'}); redisDown=false;
  // ME and bearer validation
  for (const [label,t,headers] of [['Thiếu access token',null],['Token rác','invalid'],['Token sai chữ ký',jwt.sign({type:'ACCESS'},'wrong-secret',{subject:String(hr.id)})],['Access token hết hạn',token(hr,'ACCESS',{}, {expiresIn:-1})],['Refresh token không được dùng làm access token',token(hr,'REFRESH',{sessionId:'fake'})],['Token thiết lập không được xem me',setupToken],['Token thiếu subject',jwt.sign({type:'ACCESS'},env.auth.jwtSecret)],['Sai scheme Authorization',null,{Authorization:`Basic ${hrToken}`}]] ) await check(label,'GET','/me',401,{token:t,headers,message:'A valid access token is required.'});
  await check('Xem me bằng token admin','GET','/me',200,{token:adminToken,verify:d=>d.role==='ADMIN' && d.status==='ACTIVE' && !('password' in d)});
  await check('Xem me bằng token HR','GET','/me',200,{token:hrToken,verify:d=>d.role==='HR'});
  await check('Xem me bằng token EMPLOYEE','GET','/me',200,{token:employeeToken,verify:d=>d.role==='EMPLOYEE'});
  await check('Me kiểm tra trạng thái DB khi tài khoản bị khóa','GET','/me',401,{token:inactiveToken});
  await check('Me với tài khoản không tồn tại','GET','/me',401,{token:token({...hr,id:2147483647})});
  // REGISTER
  const register = '/user_register';
  for (const [label, value] of [['thiếu trường', undefined], ['null', null], ['rỗng', ''], ['chỉ khoảng trắng', ' \t\n '], ['kiểu số', 123], ['kiểu boolean', true], ['kiểu mảng', ['HR']], ['kiểu object', {}], ['hơn 150 ký tự', 'a'.repeat(151)]]) {
    await check(`full_name ${label} bị từ chối`, 'POST', register, 400, { token: adminToken, body: { email: 'name-validation@auth-test.invalid', ...(value !== undefined ? { full_name: value } : {}) }, message: 'full_name is required and must be a non-empty string of at most 150 characters.' });
  }
  await check('full_name được trim và lưu đúng tên tiếng Việt', 'POST', register, 201, { token: adminToken, body: { email: 'vietnamese-name@auth-test.invalid', full_name: '  Nguyễn Quốc Khánh  ' }, verify: async d => d.data?.fullName === 'Nguyễn Quốc Khánh' && (await client.query('SELECT full_name FROM users WHERE id=$1', [d.data.id])).rows[0]?.full_name === 'Nguyễn Quốc Khánh' });
  await check('full_name đúng 150 ký tự được chấp nhận', 'POST', register, 201, { token: adminToken, body: { email: 'max-name@auth-test.invalid', full_name: 'a'.repeat(150) }, verify: d => d.data?.fullName === 'a'.repeat(150) });
  await check('full_name một ký tự được chấp nhận', 'POST', register, 201, { token: adminToken, body: { email: 'single-name@auth-test.invalid', full_name: 'Á' }, verify: d => d.data?.fullName === 'Á' });
  for (const [label,body] of [['Tạo HR thiếu email',{}],['Tạo HR email sai',{email:'invalid'}],['Tạo HR email quá 255 ký tự',{email:'x'.repeat(250)+'@example.invalid'}],['Tạo HR không nhận password',{email:'new@auth-test.invalid',password:'ignored'}],['Tạo HR không nhận fullName',{email:'new@auth-test.invalid',fullName:'HR'}],['Tạo HR roleId là chuỗi',{email:'new@auth-test.invalid',roleId:'2'}],['Tạo HR roleId âm',{email:'new@auth-test.invalid',roleId:-1}],['Tạo HR roleId không phải HR',{email:'new@auth-test.invalid',roleId:admin.roleId}],['Tạo HR body là mảng',[]]]) await check(label,'POST',register,400,{token:adminToken,body});
  await check('Tạo HR thiếu token','POST',register,401,{body:{email:'new@auth-test.invalid'}});
  for (const [name,t] of [['HR',hrToken],['EMPLOYEE',employeeToken],['admin INACTIVE',token({...admin,status:'INACTIVE'})]]) {
    if(name==='admin INACTIVE') await setStatus(admin,'INACTIVE');
    await check(`${name} không được tạo HR`,'POST',register,403,{token:t,body:{email:'new@auth-test.invalid'}});
    if(name==='admin INACTIVE') await setStatus(admin,'ACTIVE');
  }
  await check('Admin tạo HR với roleId HR đúng','POST',register,201,{token:adminToken,body:{email:' NEW@auth-test.invalid ',roleId:hr.roleId},verify:d=>d.data?.role==='HR' && d.data?.status==='IN_PROCESS' && d.data?.email==='new@auth-test.invalid' && !d.data?.password && d.data?.emailDelivery==='SENT'});
  await check('Admin tạo HR không truyền roleId','POST',register,201,{token:adminToken,body:{email:'auto-role@auth-test.invalid'},verify:d=>d.data?.roleId===hr.roleId && d.data?.role==='HR'});
  await client.query("UPDATE role SET name='HR_UNAVAILABLE' WHERE id=$1",[hr.roleId]);
  await check('Tạo HR khi database chưa cấu hình role HR','POST',register,503,{token:adminToken,body:{email:'no-role@auth-test.invalid'},message:'HR role is not configured.'});
  await client.query("UPDATE role SET name='HR' WHERE id=$1",[hr.roleId]);
  await check('Tạo HR trùng email khác hoa thường','POST',register,409,{token:adminToken,body:{email:'NEW@auth-test.invalid'},message:'Email is already in use.'});
  const savedInitial=service.initialPassword; service.initialPassword='short'; await check('Mật khẩu khởi tạo cấu hình quá ngắn','POST',register,503,{token:adminToken,body:{email:'bad-config@auth-test.invalid'}}); service.initialPassword='x'.repeat(73); await check('Mật khẩu khởi tạo cấu hình quá 72 byte','POST',register,503,{token:adminToken,body:{email:'bad-config@auth-test.invalid'}}); service.initialPassword=savedInitial;
  mailMode='throw'; await check('Tạo HR khi SMTP lỗi vẫn lưu và cảnh báo','POST',register,201,{token:adminToken,body:{email:'mail-failure@auth-test.invalid'},verify:d=>d.data?.status==='IN_PROCESS' && d.data?.emailDelivery==='FAILED' && Boolean(d.data.warning)}); mailMode='ok';
  await check('Không tạo lại HR đã lưu dù gửi thư thất bại','POST',register,409,{token:adminToken,body:{email:'mail-failure@auth-test.invalid'}});
  const savedMail=service.mailTransporter; service.mailTransporter=null; await check('Tạo HR thiếu cấu hình SMTP','POST',register,503,{token:adminToken,body:{email:'no-mail@auth-test.invalid'}}); service.mailTransporter=savedMail;
  // REFRESH / LOGOUT
  const refreshToken = active.cookie?.slice('eris_refresh='.length);
  for (const [label,cookie] of [['Refresh không có cookie',undefined],['Refresh cookie rác','eris_refresh=invalid'],['Refresh cookie mã hóa lỗi','eris_refresh=%E0%A4%A'],['Refresh sai tên cookie',`other=${refreshToken}`],['Refresh bằng access token',`eris_refresh=${hrToken}`],['Refresh token hết hạn',`eris_refresh=${token(hr,'REFRESH',{sessionId:'old'},{expiresIn:-1})}`],['Refresh session không tồn tại',`eris_refresh=${token(hr,'REFRESH',{sessionId:'missing'})}`]]) await check(label,'POST','/refresh',401,{cookie,message:'Refresh token is invalid or expired.'});
  const rotated=await check('Refresh hợp lệ tạo token và cookie mới','POST','/refresh',200,{cookie:active.cookie,verify:(d,c)=>Boolean(d.accessToken && c && c.split(';')[0]!==active.cookie)});
  await check('Refresh cookie trước rotation bị từ chối','POST','/refresh',401,{cookie:active.cookie});
  const mismatchId=crypto.randomUUID(); await redis.set(`auth:refresh:${mismatchId}`,String(admin.id),'EX',120);
  await check('Refresh session thuộc người dùng khác bị chặn','POST','/refresh',401,{cookie:`eris_refresh=${token(hr,'REFRESH',{sessionId:mismatchId})}`});
  const missingId=crypto.randomUUID(); await redis.set(`auth:refresh:${missingId}`,'2147483647','EX',120);
  await check('Refresh tài khoản đã bị xóa bị chặn','POST','/refresh',401,{cookie:`eris_refresh=${token({...hr,id:2147483647},'REFRESH',{sessionId:missingId})}`});
  const disabled=await login(hr,'Tạo phiên trước khi khóa tài khoản'); await setStatus(hr,'INACTIVE');
  await check('Refresh bị chặn khi tài khoản vừa bị khóa','POST','/refresh',401,{cookie:disabled.cookie}); await setStatus(hr,'ACTIVE');
  for (const [label,cookie] of [['Logout không cookie',undefined],['Logout token rác','eris_refresh=invalid'],['Logout cookie encoding lỗi','eris_refresh=%E0%A4%A'],['Logout phiên hợp lệ',rotated.cookie],['Logout lại cùng phiên',rotated.cookie]]) await check(label,'POST','/logout',200,{cookie,message:'Logout successful.',verify:(_d,c)=>Boolean(c && /Expires=Thu, 01 Jan 1970/i.test(c))});
  await check('Refresh phiên đã logout bị từ chối','POST','/refresh',401,{cookie:rotated.cookie});
  // CHANGE PASSWORD OTP
  for (const [label,t,expected] of [['Xin OTP không token',null,401],['Xin OTP bằng setup token',setupToken,401],['Xin OTP tài khoản INACTIVE',inactiveToken,403],['Xin OTP tài khoản không tồn tại',token({...hr,id:2147483647}),403]]) await check(label,'POST','/change-password/otp',expected,{token:t});
  await check('Xin OTP bằng access token ACTIVE','POST','/change-password/otp',200,{token:hrToken,message:'OTP has been sent to your email.'});
  mailMode='throw'; await check('Xin OTP khi SMTP ném lỗi','POST','/change-password/otp',500,{token:hrToken}); mailMode='ok';
  assertion('OTP bị xóa sau khi gửi mail ném lỗi',await redis.get(otpKey('CHANGE_PASSWORD',hr))===null);
  mailMode='reject'; await check('SMTP từ chối người nhận phải báo gửi OTP thất bại','POST','/change-password/otp',503,{token:hrToken,note:'SMTP fixture trả accepted=[] và rejected=[email]. Không được báo đã gửi OTP thành công.'}); mailMode='ok';
  // CHANGE PASSWORD validation, OTP limits, activation
  const validChange={currentPassword:initial,otp:'123456',newPassword:changed};
  for (const [label,body] of [['Đổi mật khẩu thiếu OTP',{newPassword:changed}],['Đổi mật khẩu OTP 5 chữ số',{...validChange,otp:'12345'}],['Đổi mật khẩu OTP kiểu số',{...validChange,otp:123456}],['Đổi mật khẩu mới ngắn hơn 8 ký tự',{...validChange,newPassword:'short'}],['Đổi mật khẩu mới không phải chuỗi',{...validChange,newPassword:12345678}]]) await check(label,'PATCH','/change-password',400,{token:hrToken,body});
  for(const [label,t] of [['Đổi mật khẩu không token',null],['Đổi mật khẩu token hết hạn',token(hr,'ACCESS',{}, {expiresIn:-1})],['Đổi mật khẩu bằng refresh token',token(hr,'REFRESH',{sessionId:'fake'})]]) await check(label,'PATCH','/change-password',401,{token:t,body:validChange});
  await check('Đổi mật khẩu thiếu mật khẩu hiện tại','PATCH','/change-password',400,{token:hrToken,body:{otp:'123456',newPassword:changed},message:'Current password is required.'});
  await seedOtp(hr);
  await check('Đổi mật khẩu hiện tại sai','PATCH','/change-password',401,{token:hrToken,body:{...validChange,currentPassword:'wrong'},message:'Current password is incorrect.'});
  for(let i=1;i<=env.auth.otpMaxAttempts;i++) await check(`OTP đổi mật khẩu sai lần ${i}`,'PATCH','/change-password',400,{token:hrToken,body:{...validChange,otp:'654321'},message:'OTP is invalid or expired.'});
  assertion('OTP bị xóa khi vượt số lần thử cấu hình',await redis.get(otpKey('CHANGE_PASSWORD',hr))===null);
  await check('OTP đúng sau khi đã khóa số lần thử vẫn bị chặn','PATCH','/change-password',400,{token:hrToken,body:validChange});
  await seedOtp(hr); await redisClient.pexpire(key(otpKey('CHANGE_PASSWORD',hr)),1); await new Promise(r=>setTimeout(r,15));
  await check('OTP đổi mật khẩu hết hạn thật trong Redis','PATCH','/change-password',400,{token:hrToken,body:validChange});
  await seedOtp(hr,'RESET_PASSWORD');
  await check('OTP reset không dùng được cho đổi mật khẩu','PATCH','/change-password',400,{token:hrToken,body:validChange});
  await seedOtp(pending);
  await check('Thiết lập lần đầu bằng passwordChangeToken và OTP đúng','PATCH','/change-password',200,{token:setupToken,body:{otp:'123456',newPassword:changed},message:'Password changed successfully. Please sign in again.'});
  await check('Setup token cũ không dùng được sau khi đã ACTIVE','PATCH','/change-password',401,{token:setupToken,body:{otp:'123456',newPassword:changed}});
  await check('Mật khẩu khởi tạo cũ không còn đăng nhập được','POST','/login',401,{body:bodyLogin(pending)});
  await check('Mật khẩu mới đăng nhập được sau setup','POST','/login',200,{body:{email:pending.email,password:changed},verify:d=>Boolean(d.accessToken)});
  const sessionA=await login(hr,'Tạo phiên A trước đổi mật khẩu'), sessionB=await login(hr,'Tạo phiên B trước đổi mật khẩu');
  await seedOtp(hr);
  await check('Đổi mật khẩu thành công bằng OTP đúng','PATCH','/change-password',200,{token:hrToken,body:validChange});
  await check('Đổi mật khẩu xong OTP không dùng lại được','PATCH','/change-password',400,{token:hrToken,body:{...validChange,currentPassword:changed}});
  await check('Phiên A bị thu hồi sau đổi mật khẩu','POST','/refresh',401,{cookie:sessionA.cookie});
  await check('Phiên B bị thu hồi sau đổi mật khẩu','POST','/refresh',401,{cookie:sessionB.cookie});
  await check('Mật khẩu cũ bị từ chối sau đổi','POST','/login',401,{body:bodyLogin(hr)});
  const afterChange=await check('Đăng nhập được với mật khẩu đã đổi','POST','/login',200,{body:{email:hr.email,password:changed},verify:d=>Boolean(d.accessToken)});
  // FORGOT / RESET
  for(const [label,body] of [['Quên mật khẩu thiếu email',{}],['Quên mật khẩu email sai',{email:'invalid'}],['Quên mật khẩu email là số',{email:123}]]) await check(label,'POST','/forgot-password',400,{body,message:'A valid email is required.'});
  for(const actor of [inactive,{email:'unknown@auth-test.invalid'}]) await check(`Quên mật khẩu không tiết lộ tài khoản ${actor===inactive?'INACTIVE':'không tồn tại'}`,'POST','/forgot-password',200,{body:{email:actor.email},message:'If the email exists, an OTP has been sent.'});
  await setStatus(pending,'IN_PROCESS'); await check('Quên mật khẩu IN_PROCESS không phát OTP reset','POST','/forgot-password',200,{body:{email:pending.email},verify:async()=>await redis.get(otpKey('RESET_PASSWORD',pending))===null}); await setStatus(pending,'ACTIVE');
  await check('Quên mật khẩu ACTIVE tạo OTP reset','POST','/forgot-password',200,{body:{email:hr.email},verify:async()=>Boolean(await redis.get(otpKey('RESET_PASSWORD',hr)))});
  mailMode='throw'; await check('Quên mật khẩu che thông tin khi SMTP lỗi','POST','/forgot-password',200,{body:{email:hr.email},message:'If the email exists, an OTP has been sent.'}); mailMode='ok';
  const validReset={email:hr.email,otp:'123456',newPassword:reset};
  for(const [label,body] of [['Reset thiếu email',{otp:'123456',newPassword:reset}],['Reset email sai',{...validReset,email:'invalid'}],['Reset OTP sai định dạng',{...validReset,otp:'abc'}],['Reset mật khẩu quá ngắn',{...validReset,newPassword:'short'}],['Reset tài khoản không tồn tại',{...validReset,email:'unknown@auth-test.invalid'}],['Reset tài khoản INACTIVE',{...validReset,email:inactive.email}]]) await check(label,'POST','/reset-password',400,{body});
  await redis.del(otpKey('RESET_PASSWORD',hr)); await seedOtp(hr,'CHANGE_PASSWORD');
  await check('OTP đổi mật khẩu không dùng để reset','POST','/reset-password',400,{body:validReset});
  await setStatus(pending,'IN_PROCESS');
  await check('Reset không dùng cho tài khoản IN_PROCESS','POST','/reset-password',400,{body:{...validReset,email:pending.email}});
  await setStatus(pending,'ACTIVE');
  await seedOtp(hr,'RESET_PASSWORD'); await redisClient.pexpire(key(otpKey('RESET_PASSWORD',hr)),1); await new Promise(r=>setTimeout(r,15));
  await check('OTP reset đã hết hạn thật trong Redis','POST','/reset-password',400,{body:validReset});
  await seedOtp(hr,'RESET_PASSWORD');
  for(let i=1;i<=env.auth.otpMaxAttempts;i++) await check(`OTP reset sai lần ${i}`,'POST','/reset-password',400,{body:{...validReset,otp:'654321'},message:'OTP is invalid or expired.'});
  assertion('OTP reset bị xóa khi đủ số lần thử sai',await redis.get(otpKey('RESET_PASSWORD',hr))===null);
  await check('OTP reset đúng cũng bị chặn sau khi hết lượt','POST','/reset-password',400,{body:validReset});
  await seedOtp(hr,'RESET_PASSWORD');
  await check('Reset nhập sai OTP','POST','/reset-password',400,{body:{...validReset,otp:'654321'}});
  await check('Reset bằng OTP đúng không cần access token','POST','/reset-password',200,{body:validReset,message:'Password reset successfully. Please sign in again.'});
  await check('OTP reset đã dùng không được dùng lại','POST','/reset-password',400,{body:validReset,message:'OTP is invalid or expired.'});
  await check('Refresh bị thu hồi sau reset','POST','/refresh',401,{cookie:afterChange.cookie});
  await check('Mật khẩu trước reset bị từ chối','POST','/login',401,{body:{email:hr.email,password:changed}});
  const final=await check('Mật khẩu sau reset đăng nhập thành công','POST','/login',200,{body:{email:hr.email,password:reset},verify:d=>Boolean(d.accessToken)});
  // Security boundaries: expected failures remain FAIL rather than weakening the assertions.
  await seedOtp(hr);
  const oversize=await check('Mật khẩu mới hơn 72 byte phải được từ chối','PATCH','/change-password',400,{token:final.data.accessToken,body:{currentPassword:reset,otp:'123456',newPassword:'x'.repeat(73)},note:'bcrypt chỉ dùng 72 byte đầu. Cần validation chặn mật khẩu vượt giới hạn để tránh cắt ngầm.'});
  if(oversize.data.message==='Password changed successfully. Please sign in again.') await check('Mật khẩu khác ký tự sau byte 72 không được đăng nhập','POST','/login',401,{body:{email:hr.email,password:'x'.repeat(72)+'y'},note:'Mật khẩu đã đặt kết thúc bằng x nhưng mật khẩu test kết thúc bằng y. Nếu vẫn login 200 thì bcrypt đã cắt ngầm.'});
  const raceLogin=await check('Tạo phiên cho test refresh đồng thời','POST','/login',200,{body:{email:employee.email,password:initial}});
  const decoded=jwt.decode(raceLogin.cookie.slice('eris_refresh='.length));
  let resolve; const ready=new Promise(r=>resolve=r); barrier={key:`auth:refresh:${decoded.sessionId}`,count:0,ready,resolve};
  const concurrent = await Promise.all([fetch(base+'/refresh',{method:'POST',headers:{Cookie:raceLogin.cookie}}),fetch(base+'/refresh',{method:'POST',headers:{Cookie:raceLogin.cookie}})]); barrier=null;
  const statuses=concurrent.map(r=>r.status).sort();
  assertion('Hai refresh đồng thời cùng cookie chỉ một yêu cầu được thành công',statuses.join(',')==='200,401',`HTTP thực tế: ${statuses.join(', ')}. Barrier đồng bộ hai lần GET để tái hiện cạnh tranh một cách xác định.`);
  await seedOtp(employee,'RESET_PASSWORD');
  let resolveOtp; const readyOtp=new Promise(r=>resolveOtp=r); barrier={key:otpKey('RESET_PASSWORD',employee),count:0,ready:readyOtp,resolve:resolveOtp};
  const otpRace=await Promise.allSettled([service.verifyOtp(employee.id,'RESET_PASSWORD','123456'),service.verifyOtp(employee.id,'RESET_PASSWORD','123456')]); barrier=null;
  assertion('OTP chỉ được tiêu thụ một lần khi xác minh đồng thời',otpRace.filter(r=>r.status==='fulfilled').length===1,`Kiểm thử trực tiếp AuthService.verifyOtp với Redis thật: ${otpRace.filter(r=>r.status==='fulfilled').length}/2 lần xác minh thành công. Không phải hai request HTTP.`);
  await check('JSON đăng nhập hỏng phải trả lỗi client','POST','/login',400,{raw:'{"email":',note:'Body JSON không hợp lệ phải là 400, không phải lỗi server.'});
}
function report(error) {
  const dir=path.join(__dirname,'../docs'); fs.mkdirSync(dir,{recursive:true});
  const report={date:'2026-11-03', environment:'HTTP/JWT thật, PostgreSQL TEMP LIKE schema hiện tại, Redis thật với namespace riêng; SMTP giả lập có kiểm soát',error:error?.message,results};
  fs.writeFileSync(path.join(dir,'auth-comprehensive-results.json'),JSON.stringify(report,null,2));
  const http=results.filter(r=>r.method!=='CHECK'), invariants=results.filter(r=>r.method==='CHECK');
  let text=`# Auth — Kiểm thử chi tiết tất cả API\n\nNgày: 03/11/2026.\n\n${results.filter(r=>r.passed).length}/${results.length} kiểm tra đạt yêu cầu. Gồm ${http.length} ca HTTP và ${invariants.length} kiểm tra cookie, trạng thái Redis hoặc cạnh tranh đồng thời.\n\n## Môi trường\n\nGọi HTTP thật qua router, controller, middleware và service auth hiện tại; dùng JWT thật. Repository chạy trên bảng PostgreSQL TEMP sao chép cấu trúc database mới. Redis thật dùng namespace ngẫu nhiên và được dọn sau test. SMTP được giả lập để test gửi thư thành công, bị từ chối và mất kết nối. Không gửi email và không đổi tài khoản admin/HR thật trong lần test này.\n\nPhản hồi JSON bên dưới lấy từ lần chạy thực tế; password, OTP và token đã được che. Test SMTP thật của lần trước nằm trong lịch sử kiểm thử, không được tính thành gửi thư thật trong lần này.\n\n`;
  const failures=results.filter(r=>!r.passed);
  text+='## Những lỗi phát hiện\n\n'+(failures.length?failures.map(r=>`- ${r.label}: mong đợi ${r.expected}, thực tế ${r.actual}. ${r.note||''}`).join('\n'):'Không có kiểm tra thất bại.')+'\n\n';
  const endpoints=[...new Set(http.map(r=>r.method+' /api/auth'+r.endpoint))];
  for(const endpoint of endpoints) {
    text+=`## ${endpoint}\n\n`;
    for(const row of http.filter(r=>r.method+' /api/auth'+r.endpoint===endpoint)) {
      text+=`### ${row.label}\n\n`;
      if(row.request!==undefined) text+='Dữ liệu gửi lên (đã che thông tin xác thực):\n\n```json\n'+JSON.stringify(row.request,null,2)+'\n```\n\n';
      if(row.rawRequest) text+='Body gửi lên là JSON hỏng: `'+row.rawRequest+'`.\n\n';
      text+=`HTTP trả về: **${row.actual}**.\n\nNội dung trả về thực tế:\n\n\`\`\`json\n${JSON.stringify(row.response,null,2)}\n\`\`\`\n\nKết luận: **${row.passed?'Đạt yêu cầu':'Chưa đạt'}**${row.passed?'.':`; mong đợi HTTP ${row.expected}.`}\n\n`;
      if(row.note) text+=row.note+'\n\n';
    }
  }
  text+='## Kiểm tra bổ sung\n\n'+invariants.map(r=>`### ${r.label}\n\nKết luận: **${r.passed?'Đạt yêu cầu':'Chưa đạt'}**.\n\n${r.note||''}\n`).join('\n');
  text+='\n## Giới hạn\n\nChưa kiểm thử account EMPLOYEE có hồ sơ liên kết khi kích hoạt (phụ thuộc schema education/work experience/job history đang lỗi), tải lớn, brute force kéo dài hoặc sự cố DB ở giữa commit. Các ca mất Redis/SMTP dùng lỗi giả lập có chủ đích. Race được đồng bộ bằng barrier để tái hiện cùng thời điểm đọc; không phải đo tỷ lệ lỗi ngẫu nhiên dưới tải.\n\nChạy lại: `node test/auth-comprehensive.cjs` từ thư mục backend. Không cần cung cấp credential tài khoản thật.\n';
  if(error) text+='\nLần chạy dừng: '+error.message+'\n';
  fs.writeFileSync(path.join(dir,'auth-comprehensive-test-results.md'),text);
  fs.writeFileSync(path.join(dir,'auth-api-test-results.md'),text);
}
let fatalError;
run().catch(error=>{console.error(error);process.exitCode=1;fatalError=error;}).finally(async()=>{
  report(fatalError);
  if(server)await new Promise(resolve=>server.close(resolve));
  if(keys.size)await redisClient.del(...keys).catch(()=>{});
  if(client)client.release(); await databasePool.end(); redisClient.disconnect();
  if(results.some(r=>!r.passed))process.exitCode=1;
  console.log(`RESULT ${results.filter(r=>r.passed).length}/${results.length} PASS`);
});
