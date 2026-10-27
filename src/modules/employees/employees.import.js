const ExcelJS = require('exceljs');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
const { validateCreateEmployeeInput, requiredEmployeeFields } = require('./employees.validation');
const { phoneKey } = require('./employee-phone');

const fields = [...requiredEmployeeFields, 'educations', 'workExperiences'];
const required = [...requiredEmployeeFields, 'educations', 'workExperiences'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, cb) => cb(/\.xlsx$/i.test(file.originalname) ? null : new AppError(400, 'Only .xlsx files are supported.'), /\.xlsx$/i.test(file.originalname))
}).single('file');

async function parseWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
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
        if (['educations','workExperiences'].includes(field)) {
          if (typeof value !== 'string') throw new AppError(400, `${field} phải là mảng JSON trong ô Text.`);
          try { value = JSON.parse(value); }
          catch { throw new AppError(400, `${field} không phải JSON hợp lệ.`); }
        }
        input[field] = value;
      });
      input = validateCreateEmployeeInput(input);
      if (emails.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (phones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
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
        if (['departmentId', 'positionId', 'currentSalary', 'educationLevel', 'graduationYear'].includes(field) && typeof value === 'string' && value.trim()) value = Number(value);
        input[field] = value;
      }
    } catch (caught) { error = caught; }
    records.push({ row: number, input, error });
  });
  return records;
}

function parseRelatedSheets(sheets) {
  const names = ['Employees', 'Educations', 'WorkExperiences'];
  if (sheets.length !== 3 || sheets.some(sheet => !names.includes(sheet.name))) {
    throw new AppError(400, 'Dùng một sheet có cột educations/workExperiences dạng JSON, hoặc đúng 3 sheet Employees, Educations, WorkExperiences.');
  }
  const sheet = name => sheets.find(s => s.name === name);
  const employees = readRelatedSheet(sheet('Employees'), requiredEmployeeFields, requiredEmployeeFields, 200);
  if (!employees.length) throw new AppError(400, 'Employees phải có từ 1 đến 200 nhân viên.');
  const educationFields = ['email', 'educationLevel', 'fieldOfStudy', 'institution', 'institutionRefId', 'graduationYear'];
  const workFields = ['email', 'companyName', 'positionTitle', 'startDate', 'endDate'];
  const educations = readRelatedSheet(sheet('Educations'), educationFields, ['email', 'educationLevel', 'institution', 'institutionRefId'], 4000);
  const experiences = readRelatedSheet(sheet('WorkExperiences'), workFields, ['email', 'companyName', 'positionTitle', 'startDate'], 10000);
  const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const knownEmails = new Set(employees.map(row => emailKey(row.input.email)).filter(Boolean));
  const backgrounds = new Map([...knownEmails].map(email => [email, { educations: [], workExperiences: [], errors: [] }]));
  for (const [sheetName, key, rows] of [['Educations', 'educations', educations], ['WorkExperiences', 'workExperiences', experiences]]) {
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
  return employees.map(row => {
    try {
      if (row.error) throw row.error;
      const email = emailKey(row.input.email);
      const background = backgrounds.get(email) || { educations: [], workExperiences: [], errors: [] };
      if (background.errors.length) throw new AppError(400, background.errors.join('; '));
      const input = validateCreateEmployeeInput({ ...row.input, educations: background.educations, workExperiences: background.workExperiences });
      if (seen.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (seenPhones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
      seen.add(input.email);
      seenPhones.add(phoneKey(input.phone));
      return { row: row.row, input };
    } catch (error) { return { row: row.row, status: 'FAILED', statusCode: error.statusCode || 400, message: error.message }; }
  });
}

async function processEmployeeRows(rows, service, actorId, concurrency = 3) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new AppError(400, 'Import concurrency must be between 1 and 3.');
  const results = new Array(rows.length);
  const distanceCache = new Map();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++, row = rows[index];
      if (!row.input) { results[index] = row; continue; }
      try {
        const data = await service.createEmployee({ actorId, employee: row.input, distanceCache });
        results[index] = { row: row.row, status: 'CREATED', data };
      } catch (error) {
        results[index] = { row: row.row, status: 'FAILED', statusCode: error.statusCode || 500,
          message: error.statusCode ? error.message : 'Unable to create employee.' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}

function registerEmployeeImport(router, authenticate, service) {
  router.post('/import', authenticate, async (req, res, next) => {
    try { await service.assertHr(req.auth.userId); }
    catch (error) { return next(error); }
    upload(req, res, async error => {
      if (error) return next(error instanceof multer.MulterError ? new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Invalid upload: ' + error.code) : error);
      try {
        if (!req.file) throw new AppError(400, 'Upload an Excel file using the file field.');
        const rows = await parseWorkbook(req.file.buffer);
        const results = await processEmployeeRows(rows, service, req.auth.userId);
        const created = results.filter(r => r.status === 'CREATED').length;
        res.status(200).json({ total: results.length, created, failed: results.length - created, results });
      } catch (error) { next(error); }
    });
  });
}
module.exports = { parseWorkbook, registerEmployeeImport, processEmployeeRows };
