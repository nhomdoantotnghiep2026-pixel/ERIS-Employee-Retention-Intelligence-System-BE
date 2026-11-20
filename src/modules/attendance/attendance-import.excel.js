const ExcelJS = require('exceljs');
const {readXlsx}=require('../../common/utils/xlsx-reader');
const { date, timestamp, fail } = require('./attendance-import.rules');
const HEADERS = ['employee_code','employee_name','shift_type','work_date','check_in','check_out'];
const REQUIRED = HEADERS.filter(h => !['employee_name','work_date'].includes(h));
function text(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new Error('Only text or numeric identifiers are accepted.');
  return String(v).trim();
}
function datetime(cell,baseDate=null) {
  if (cell.value == null || cell.value === '') return null;
  // ExcelJS decodes both date systems into UTC components representing Excel wall time.
  if (cell.value instanceof Date) {
    if (!Number.isFinite(cell.value.getTime())) throw new Error('Invalid Excel date.');
    return timestamp(cell.value.toISOString().slice(0,19).replace('T',' '));
  }
  if (typeof cell.value !== 'string') throw new Error('Use a Date/Time cell or YYYY-MM-DD HH:mm:ss text; formulas are not accepted.');
  const value=cell.value.trim();
  if(baseDate&&/^\d{2}:\d{2}:\d{2}$/.test(value))return timestamp(baseDate+' '+value);
  return timestamp(value);
}
function workDate(cell) {
  if (cell.value == null || cell.value === '') return null;
  return date(cell.value instanceof Date ? cell.value.toISOString().slice(0,10) : text(cell));
}
async function parseWorkbook(file) {
  if (!file || !/\.xlsx$/i.test(file.originalname) || !Buffer.isBuffer(file.buffer) || file.buffer.length > 10*1024*1024) fail('ATT-001','A valid .xlsx file of at most 10 MiB is required.');
  let book;
  try { book=await readXlsx(file.buffer); } catch { fail('ATT-001','Unable to read .xlsx workbook. The file may be damaged, encrypted or use an unsupported structure.'); }
  const sheet = book.worksheets[0];
  if (!sheet) fail('ATT-002','Workbook has no worksheet.');
  if (sheet.rowCount > 10001 || sheet.columnCount > 100) fail('ATT-001','Limit: 10,000 data rows and 100 columns.');
  const columns = {}, seen = new Set();
  sheet.getRow(1).eachCell((cell,index) => {
    let name; try { name = text(cell); } catch { fail('ATT-002','Header cells must be text.'); }
    if (seen.has(name)) fail('ATT-002',`Duplicate column: ${name}`);
    seen.add(name); if (HEADERS.includes(name)) columns[name] = index;
  });
  if (REQUIRED.some(h => !columns[h])) fail('ATT-002',`Required columns: ${REQUIRED.join(', ')}`);
  const rows = [];
  for (let n=2; n<=sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    if (!HEADERS.some(h => columns[h] && row.getCell(columns[h]).value != null && row.getCell(columns[h]).value !== '')) continue;
    const output = { excel_row:n, employee_code:'', employee_name:'', shift_type:'', check_in:null, check_out:null, parse_issues:[] };
    for (const name of HEADERS) {
      if (!columns[name]) continue;
      try {
        const cell = row.getCell(columns[name]);
        output[name] = name.startsWith('check_') ? datetime(cell,columns.work_date?workDate(row.getCell(columns.work_date)):null) : name === 'work_date' ? workDate(cell) : text(cell);
      }
      catch (e) { output.parse_issues.push({ code:name.startsWith('check_')?'ATT-005':'ATT-002', severity:'ERROR', field:name, message:e.message }); }
    }
    rows.push(output);
  }
  if (!rows.length) fail('ATT-002','Workbook has no data rows.');
  return rows;
}
async function errorsWorkbook(rows) {
  const book = new ExcelJS.Workbook(), sheet=book.addWorksheet('Errors');
  sheet.columns = ['excel_row',...HEADERS,'validation_status','issues'].map(key => ({header:key,key,width:24}));
  for (const row of rows.filter(r => r.validation_status !== 'VALID')) sheet.addRow({ ...row, issues:row.issues.map(i=>`${i.code}: ${i.message}`).join('; ') });
  return book.xlsx.writeBuffer();
}
module.exports = { parseWorkbook, errorsWorkbook };
