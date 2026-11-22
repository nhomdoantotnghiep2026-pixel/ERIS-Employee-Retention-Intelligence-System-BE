const {parseWorkbook,validateImportEmployee,employeeImportTemplate,failedRow}=require('../helpers/employees-workbook');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { AppError } = require('../../../common/errors/app-error');
const {prepareImportInstitutions,parseInstitutionChoices,institutionPreview}=require('../helpers/import-institutions');
const upload = multer({
  storage: multer.memoryStorage(),
  // Busboy emits the parts limit on reaching it, including the accepted file.
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 131072, parts: 3 },
  fileFilter: (_req, file, cb) => cb(/\.xlsx$/i.test(file.originalname) ? null : new AppError(400, 'Only .xlsx files are supported.'), /\.xlsx$/i.test(file.originalname))
}).single('file');

async function mapEmployeeRows(rows, handle, concurrency, fallbackMessage) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new AppError(400, 'Import concurrency must be between 1 and 3.');
  const results = new Array(rows.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++, row = rows[index];
      if (!row.input) { results[index] = row; continue; }
      try {
        results[index] = await handle(row);
      } catch (error) {
        const failure = error.statusCode ? error : new AppError(500, fallbackMessage);
        results[index] = row.source ? failedRow(row.row, failure, row.source,row.previewData)
          : { row: row.row, previewData:row.previewData, status: 'FAILED', statusCode: failure.statusCode, message: failure.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}

async function processEmployeeRows(rows, service, actorId, concurrency = 3, importId = randomUUID()) {
  const distanceCache = new Map();
  return mapEmployeeRows(rows, async row => {
    if(!row.input.shiftType)throw new AppError(400,'Provide shift_type in the employee import row.');
    const data = await service.createEmployee({ actorId, employee: row.input, distanceCache, auditContext: { source: 'IMPORT', importId, row: row.row } });
    return { row: row.row, status: 'CREATED', data, warnings:(row.institutions||[]).filter(i=>i.warning).map(i=>i.warning) };
  }, concurrency, 'Unable to create employee.');
}

function registerEmployeeImport(router, authenticate, service) {
  router.get('/import/template',authenticate,async(req,res,next)=>{try{await service.assertHr(req.auth.userId);const buffer=await employeeImportTemplate();res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.attachment('ERIS_Employee_Import_Template.xlsx');res.send(Buffer.from(buffer));}catch(error){next(error);}});
  const receiveWorkbook = (handle, preview = false) => async (req, res, next) => {
    try { await service.assertHr(req.auth.userId); }
    catch (error) { return next(error); }
    upload(req, res, async error => {
      if (error) return next(error instanceof multer.MulterError ? new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Invalid upload: ' + error.code) : error);
      try {
        if (!req.file) throw new AppError(400, 'Upload an Excel file using the file field.');
        let rows;
        try { rows = await parseWorkbook(req.file.buffer, service.employeesRepository.listActiveImportAssignments?() => service.employeesRepository.listActiveImportAssignments():undefined); }
        catch (error) {
          if (preview && error instanceof AppError && error.statusCode === 400) {
            return res.json({ total: 0, valid: 0, failed: 0, results: [], fileIssues: error.issues || [{ message: error.message }] });
          }
          throw error;
        }
        const choices=parseInstitutionChoices(req.body?.institutionChoices,rows);
        rows=await prepareImportInstitutions(rows,service.educationService,choices);
        if(!preview&&rows.some(r=>r.needsSelection))throw new AppError(409,'Cần chọn trường trong bước xem trước trước khi nhập hồ sơ.');
        await handle(rows, req.auth.userId, res);
      } catch (error) { next(error); }
    });
  };

  router.post('/import/preview', authenticate, receiveWorkbook(async (rows, actorId, res) => {
    const checked=await mapEmployeeRows(rows,async row=>{
      if(service.checkCreateEligibility)await service.checkCreateEligibility(actorId,row.input,{profileOnly:true});
      return row;
    },3,'Unable to validate employee.');
    res.set('Cache-Control','no-store');res.json(institutionPreview(checked));
  }, true));

  router.post('/import', authenticate, receiveWorkbook(async (rows, actorId, res) => {
    const importId = randomUUID();
    const results = await processEmployeeRows(rows, service, actorId, 3, importId);
    const created = results.filter(r => r.status === 'CREATED').length;
    let auditWarning;
    try {
      await service.employeesRepository.recordImportAudit(actorId, {
        importId, total: results.length, created, failed: results.length - created,
        rows: results.map(row => ({ row: row.row, status: row.status, ...(row.status === 'CREATED' ? { employeeId: row.data.id } : {}) }))
      });
    } catch { auditWarning = 'Đã xử lý import, nhưng chưa lưu được log tổng kết. Log tạo từng hồ sơ thành công đã được lưu; không import lại các dòng thành công.'; }
    res.status(200).json({ importId, ...(auditWarning ? { auditWarning } : {}), total: results.length, created, failed: results.length - created, results });
  }));
}
module.exports = { parseWorkbook, registerEmployeeImport, processEmployeeRows,validateImportEmployee,employeeImportTemplate };
