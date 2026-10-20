const ExcelJS = require('exceljs');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
const { validateCreateEmployeeInput, requiredEmployeeFields } = require('./employees.validation');

const fields = ['fullName','email','phone','dateOfBirth','gender','address','departmentId','positionId','hireDate','employmentType','currentSalary'];
const required = requiredEmployeeFields;
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
  if (sheets.length !== 1) throw new AppError(400, 'Workbook must contain exactly one non-empty worksheet.');
  const sheet = sheets[0];
  if (sheet.columnCount > fields.length || sheet.rowCount > 1000) throw new AppError(400, 'Workbook exceeds row or column limits.');
  const headers = sheet.getRow(1).values.slice(1).map(v => typeof v === 'string' ? v.trim() : '');
  if (!headers.length || headers.some(h => !fields.includes(h)) || new Set(headers).size !== headers.length || required.some(h => !headers.includes(h))) {
    throw new AppError(400, 'Invalid headers. Required: ' + required.join(', ') + '. Use exact employee field names; no duplicate or unsupported columns.');
  }
  const rows = [];
  const emails = new Set();
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
        input[field] = value;
      });
      input = validateCreateEmployeeInput(input);
      if (emails.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      emails.add(input.email);
      rows.push({ row: rowNumber, input });
    } catch (error) {
      rows.push({ row: rowNumber, status: 'FAILED', statusCode: error.statusCode || 400, message: error.message });
    }
  });
  if (!rows.length || rows.length > 200) throw new AppError(400, 'File must contain between 1 and 200 employee rows.');
  return rows;
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
