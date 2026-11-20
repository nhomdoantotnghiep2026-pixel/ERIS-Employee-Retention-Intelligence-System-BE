const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
const { validateCreateEmployeeInput, requiredEmployeeFields } = require('./employees.validation');
const { phoneKey } = require('./employee-phone');
const {normalizeShiftType}=require('../../common/validation/shift-type');
const {readXlsx}=require('../../common/utils/xlsx-reader');
const {prepareImportInstitutions,parseInstitutionChoices,institutionPreview}=require('./import-institutions');

const importProfileFields=requiredEmployeeFields.map(field=>field==='departmentId'?'departmentName':field==='positionId'?'positionName':field);
const fields = [...importProfileFields, 'employee_code', 'shift_type', 'job_level', 'educations'];
function validateImportEmployee(input) {
  if(Object.hasOwn(input,'work_schedule_id'))throw new AppError(400,'Use shift_type only; work_schedule_id is resolved internally and is not an import field.');
  if(Object.hasOwn(input,'departmentId')||Object.hasOwn(input,'positionId'))throw new AppError(400,'Use departmentName and positionName in employee imports, not IDs.');
  const { employee_code, shift_type, departmentName, positionName, job_level, ...profile } = input;
  for(const [field,value] of Object.entries({departmentName,positionName}))if(typeof value!=='string'||!value.trim()||value.trim().length>150)throw new AppError(400,field+' is required and must be a name of at most 150 characters.');
  const levels={entry:1,junior:2,intermediate:3,senior:4,'expert / leadership':5,expert:5,leadership:5};
  const jobLevel=job_level==null||job_level===''?null:typeof job_level==='number'?job_level:levels[String(job_level).trim().toLowerCase()]??Number(job_level);
  if(jobLevel!==null&&(!Number.isInteger(jobLevel)||jobLevel<1||jobLevel>5))throw new AppError(400,'job_level must be Entry, Junior, Intermediate, Senior, Expert / Leadership or 1–5.');
  const employee = {...validateCreateEmployeeInput({...profile,departmentId:1,positionId:1},{allowUnverifiedInstitution:true}),departmentName:departmentName.trim(),positionName:positionName.trim(),jobLevel,shiftType:normalizeShiftType(shift_type)};
  delete employee.departmentId;delete employee.positionId;

  if (employee_code === undefined || employee_code === null || employee_code === '') return employee;
  if (typeof employee_code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(employee_code.trim())) {
    throw new AppError(400, 'employee_code must be 1-50 letters, digits, underscores or hyphens; start with a letter or digit. Use a Text cell.');
  }
  return { ...employee, employeeCode: employee_code.trim().toUpperCase() };
}
function checkImportCode(employee, seen) {
  if (!employee.employeeCode) return;
  if (seen.has(employee.employeeCode)) throw new AppError(409, 'Duplicate employee_code within workbook.');
  seen.add(employee.employeeCode);
}
const required = [...importProfileFields, 'shift_type', 'educations'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 131072, parts: 2 },
  fileFilter: (_req, file, cb) => cb(/\.xlsx$/i.test(file.originalname) ? null : new AppError(400, 'Only .xlsx files are supported.'), /\.xlsx$/i.test(file.originalname))
}).single('file');

async function parseWorkbook(buffer) {
  let workbook;
  try { workbook=await readXlsx(buffer); }
  catch { throw new AppError(400, 'Invalid or unreadable Excel workbook.'); }
  const sheets = workbook.worksheets.filter(s => s.actualRowCount > 0);
  if (sheets.length !== 1) return parseRelatedSheets(sheets);
  const sheet = sheets[0];
  if (sheet.columnCount > fields.length || sheet.rowCount > 1000) throw new AppError(400, 'Workbook exceeds row or column limits.');
  const headers = sheet.getRow(1).values.slice(1).map(v => typeof v === 'string' ? v.trim() : '');
  if (!headers.length || headers.some(h => !fields.includes(h)) || new Set(headers).size !== headers.length || required.some(h => !headers.includes(h))) {
    throw new AppError(400, 'Invalid headers. Required: ' + required.join(', ') + '. Use exact employee field names; no duplicate or unsupported columns.');
  }
  const rows = [];
  const emails = new Set();
  const phones = new Set();
  const codes = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (!row.values.slice(1).some(v => v !== null && v !== undefined && v !== '')) return;
    let input = {};
    try {
      headers.forEach((field, index) => {
        let value = row.getCell(index + 1).value;
        if (value === null || value === undefined || value === '') return;
        if (value instanceof Date) {
          if (!['dateOfBirth','hireDate'].includes(field) || !Number.isFinite(value.getTime())) throw new AppError(400, 'Invalid date cell.');
          value = value.toISOString().slice(0,10);
        } else if (typeof value === 'object') {

          throw new AppError(400, `Use plain values, not formulas or objects, in ${field}.`);
        }
        if (['departmentId','positionId','currentSalary'].includes(field) && typeof value === 'string' && value.trim()) value = Number(value);
        if (field === 'educations') {
          if (typeof value !== 'string') throw new AppError(400, `${field} phải là mảng JSON trong ô Text.`);
          try { value = JSON.parse(value); }
          catch { throw new AppError(400, `${field} không phải JSON hợp lệ.`); }
        }
        input[field] = value;
      });
      input = validateImportEmployee(input);
      if (emails.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (phones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
      checkImportCode(input, codes);
      emails.add(input.email);
      phones.add(phoneKey(input.phone));
      rows.push({ row: rowNumber, input });
    } catch (error) {
      rows.push({ row: rowNumber, status: 'FAILED', statusCode: error.statusCode || 400, message: error.message });
    }
  });
  if (!rows.length || rows.length > 200) throw new AppError(400, 'File must contain between 1 and 200 employee rows.');
  return rows;
}

function readRelatedSheet(sheet, allowed, requiredHeaders, maxRows) {
  if (!sheet || sheet.rowCount > maxRows + 1 || sheet.columnCount > allowed.length) throw new AppError(400, 'Thiếu sheet hoặc vượt giới hạn dòng/cột.');
  const headers = sheet.getRow(1).values.slice(1).map(v => typeof v === 'string' ? v.trim() : '');
  if (!headers.length || headers.some(h => !allowed.includes(h)) || new Set(headers).size !== headers.length || requiredHeaders.some(h => !headers.includes(h))) {
    throw new AppError(400, `${sheet.name}: header không hợp lệ. Bắt buộc: ${requiredHeaders.join(', ')}.`);
  }
  const records = [];
  sheet.eachRow((row, number) => {
    if (number === 1 || !row.values.slice(1).some(v => v !== null && v !== undefined && v !== '')) return;
    const input = {};
    let error;
    try {
      for (const [index, field] of headers.entries()) {
        let value = row.getCell(index + 1).value;
        if (value === null || value === undefined || value === '') continue;
        if (value instanceof Date) {
          if (!['dateOfBirth', 'hireDate', 'startDate', 'endDate'].includes(field) || !Number.isFinite(value.getTime())) throw new AppError(400, 'Ô ngày không hợp lệ.');
          value = value.toISOString().slice(0, 10);
        } else if (typeof value === 'object') throw new AppError(400, `Không dùng công thức, hyperlink hoặc object ở ${field}.`);
        if (['departmentId', 'positionId', 'currentSalary', 'graduationYear'].includes(field) && typeof value === 'string' && value.trim()) value = Number(value);
        input[field] = value;
      }
    } catch (caught) { error = caught; }
    records.push({ row: number, input, error });
  });
  return records;
}

function parseRelatedSheets(sheets) {
  const names = ['Employees', 'Educations'];
  if (sheets.length !== 2 || sheets.some(sheet => !names.includes(sheet.name))) {
    throw new AppError(400, 'Dùng một sheet có cột educations dạng JSON, hoặc đúng 2 sheet Employees, Educations.');
  }
  const sheet = name => sheets.find(s => s.name === name);
  const employees = readRelatedSheet(sheet('Employees'), [...importProfileFields, 'employee_code', 'shift_type','job_level'], [...importProfileFields,'shift_type'], 200);
  if (!employees.length) throw new AppError(400, 'Employees phải có từ 1 đến 200 nhân viên.');
  const educationFields = ['email', 'educationLevel', 'fieldOfStudy', 'institution', 'institutionRefId', 'graduationYear'];
  const educations = readRelatedSheet(sheet('Educations'), educationFields, ['email', 'educationLevel', 'institution'], 4000);
  const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const knownEmails = new Set(employees.map(row => emailKey(row.input.email)).filter(Boolean));
  const backgrounds = new Map([...knownEmails].map(email => [email, { educations: [], errors: [] }]));
  for (const [sheetName, key, rows] of [['Educations', 'educations', educations]]) {
    for (const row of rows) {
      const email = emailKey(row.input.email);
      if (!email || !knownEmails.has(email)) throw new AppError(400, `${sheetName} dòng ${row.row}: email không có trong sheet Employees.`);
      const background = backgrounds.get(email);
      if (row.error) background.errors.push(`${sheetName} dòng ${row.row}: ${row.error.message}`);
      else {
        const { email: _email, ...data } = row.input;
        background[key].push(data);
      }
    }
  }
  const seen = new Set();
  const seenPhones = new Set();
  const seenCodes = new Set();
  return employees.map(row => {
    try {
      if (row.error) throw row.error;
      const email = emailKey(row.input.email);
      const background = backgrounds.get(email) || { educations: [], errors: [] };
      if (background.errors.length) throw new AppError(400, background.errors.join('; '));
      const input = validateImportEmployee({ ...row.input, educations: background.educations });
      if (seen.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (seenPhones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
      checkImportCode(input, seenCodes);
      seen.add(input.email);
      seenPhones.add(phoneKey(input.phone));
      return { row: row.row, input };
    } catch (error) { return { row: row.row, status: 'FAILED', statusCode: error.statusCode || 400, message: error.message }; }
  });
}

async function processEmployeeRows(rows, service, actorId, concurrency = 3, importId = randomUUID()) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new AppError(400, 'Import concurrency must be between 1 and 3.');
  const results = new Array(rows.length);
  const distanceCache = new Map();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++, row = rows[index];
      if (!row.input) { results[index] = row; continue; }
      try {
        if(!row.input.shiftType)throw new AppError(400,'Provide shift_type in the employee import row.');
        const data = await service.createEmployee({ actorId, employee: row.input, distanceCache, auditContext: { source: 'IMPORT', importId, row: row.row } });
        results[index] = { row: row.row, status: 'CREATED', data, warnings:(row.institutions||[]).filter(i=>i.warning).map(i=>i.warning) };
      } catch (error) {
        results[index] = { row: row.row, status: 'FAILED', statusCode: error.statusCode || 500,
          message: error.statusCode ? error.message : 'Unable to create employee.' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}

async function employeeImportTemplate() {
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Employees');
  sheet.columns=['employee_code',...importProfileFields,'job_level','shift_type','educations'].map(key=>({header:key,key,width:['address','educations'].includes(key)?60:24}));
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};
  sheet.getCell(1,importProfileFields.length+3).note='Nhập mã ca đã có trong work_schedules, ví dụ GENERAL. Không phân biệt hoa/thường. Bắt buộc shift_type; hệ thống tự tra ID ca.';
  sheet.getCell(1,importProfileFields.length+4).note='Mảng JSON bằng cấp bắt buộc, gồm educationLevel, institution, fieldOfStudy, graduationYear.';
  sheet.getCell(1,8).note='Tên phòng ban ACTIVE trong ERIS; không nhập ID.';
  sheet.getCell(1,9).note='Tên chức danh ACTIVE thuộc phòng ban đã nhập; không nhập ID.';
  sheet.getCell(1,importProfileFields.length+2).note='Nếu chức danh có nhiều cấp, nhập Entry, Junior, Intermediate, Senior, Expert / Leadership hoặc 1–5.';
  return workbook.xlsx.writeBuffer();
}
function registerEmployeeImport(router, authenticate, service) {
  router.get('/import/template',authenticate,async(req,res,next)=>{try{await service.assertHr(req.auth.userId);const buffer=await employeeImportTemplate();res.set('Cache-Control','no-store');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.attachment('ERIS_Employee_Import_Template.xlsx');res.send(Buffer.from(buffer));}catch(error){next(error);}});

  router.post('/import/preview',authenticate,async(req,res,next)=>{
    try{await service.assertHr(req.auth.userId);}catch(error){return next(error);}
    upload(req,res,async error=>{
      if(error)return next(error instanceof multer.MulterError?new AppError(400,'Invalid upload: '+error.code):error);
      try{
        if(!req.file)throw new AppError(400,'Upload an Excel file using the file field.');
        const rows=await parseWorkbook(req.file.buffer);
        const choices=parseInstitutionChoices(req.body?.institutionChoices,rows);
        const prepared=await prepareImportInstitutions(rows,service.educationService,choices);
        res.set('Cache-Control','no-store');res.json(institutionPreview(prepared));
      }catch(error){next(error);}
    });
  });

  router.post('/import', authenticate, async (req, res, next) => {
    try { await service.assertHr(req.auth.userId); }
    catch (error) { return next(error); }
    upload(req, res, async error => {
      if (error) return next(error instanceof multer.MulterError ? new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Invalid upload: ' + error.code) : error);
      try {
        if (!req.file) throw new AppError(400, 'Upload an Excel file using the file field.');
        const parsed = await parseWorkbook(req.file.buffer);
        const choices=parseInstitutionChoices(req.body?.institutionChoices,parsed);
        const rows=await prepareImportInstitutions(parsed,service.educationService,choices);
        if(rows.some(r=>r.needsSelection))throw new AppError(409,'Cần chọn trường trong bước xem trước trước khi nhập hồ sơ.');
        const importId = randomUUID();
        const results = await processEmployeeRows(rows, service, req.auth.userId, 3, importId);
        const created = results.filter(r => r.status === 'CREATED').length;
        let auditWarning;
        try {
          await service.employeesRepository.recordImportAudit(req.auth.userId, {
            importId, total: results.length, created, failed: results.length - created,
            rows: results.map(row => ({ row: row.row, status: row.status, ...(row.status === 'CREATED' ? { employeeId: row.data.id } : {}) }))
          });
        } catch { auditWarning = 'Đã xử lý import, nhưng chưa lưu được log tổng kết. Log tạo từng hồ sơ thành công đã được lưu; không import lại các dòng thành công.'; }
        res.status(200).json({ importId, ...(auditWarning ? { auditWarning } : {}), total: results.length, created, failed: results.length - created, results });
      } catch (error) { next(error); }
    });
  });
}
module.exports = { parseWorkbook, registerEmployeeImport, processEmployeeRows, validateImportEmployee, employeeImportTemplate };
