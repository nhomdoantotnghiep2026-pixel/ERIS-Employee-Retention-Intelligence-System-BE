const { AppError } = require('../../../common/errors/app-error');
const { validateCreateEmployeeInput, requiredEmployeeFields, validateEmployeeCode } = require('../employees.validation');
const { phoneKey } = require('./employee-phone');
const { readXlsx } = require('../../../common/utils/xlsx-reader');
const ExcelJS=require('exceljs');
const {normalizeShiftType}=require('../../../common/validation/shift-type');
const importProfileFields=requiredEmployeeFields.map(field=>field==='departmentId'?'departmentName':field==='positionId'?'positionName':field);

const idColumns = ['departmentId', 'positionId'];
const nameColumns = ['departmentName', 'positionName'];
const profileColumns = ['employee_code', ...requiredEmployeeFields.filter(field => !idColumns.includes(field))];
const levelColumns = ['job_level', 'positionLevel', 'jobLevel'];
const fields = [...profileColumns, ...idColumns, ...nameColumns, ...levelColumns, 'shift_type'];
const levelNames = ['Entry', 'Junior', 'Intermediate', 'Senior', 'Expert / Leadership'];
const educationFields = ['email', 'educationLevel', 'fieldOfStudy', 'institution', 'institutionRefId', 'graduationYear'];

function fieldError(statusCode, field, message) {
  return Object.assign(new AppError(statusCode, message), { field });
}

function columnLetter(index) {
  let label = '';
  for (let next = index + 1; next > 0; next = Math.floor((next - 1) / 26)) {
    label = String.fromCharCode(65 + (next - 1) % 26) + label;
  }
  return label || undefined;
}

function makeIssue(sheet, row, headers, field, message, index = headers.indexOf(field)) {
  const column = columnLetter(index);
  return { sheet, row, column, cell: column && row ? column + row : undefined, field, message };
}

function workbookError(message, issues = [{ message }]) {
  return Object.assign(new AppError(400, message), { issues });
}

function identifyField(error, headers) {
  const message = error.message;
  const field = error.field || message.match(/^([a-zA-Z_]+)\b/u)?.[1];
  if (headers.includes(field)) return field;
  if (/employee_?code/iu.test(message)) return 'employee_code';
  if (/email/iu.test(message)) return 'email';
  if (/phone|số điện thoại/iu.test(message)) return 'phone';
  if (/at least 18/iu.test(message)) return 'dateOfBirth';
  if (/department not found/iu.test(message)) return headers.includes('departmentName') ? 'departmentName' : 'departmentId';
  if (/position not found|vị trí công việc/iu.test(message)) return headers.includes('positionName') ? 'positionName' : 'positionId';
  if (field === 'job_level') return headers.find(header => levelColumns.includes(header)) || 'job_level';
  if (/institution ref|institutionRefId/iu.test(message)) return 'institutionRefId';
  if (/^Select an institution/iu.test(message)) return 'institution';
  if (/^Invalid graduationYear/iu.test(message)) return 'graduationYear';
  if (field === 'educations') return field;
  return undefined;
}

function previewCells(row,headers){
  return Object.fromEntries(headers.map((field,index)=>{
    const cell=row.getCell(index+1),value=cell.value;
    if(value instanceof Date)return[field,Number.isFinite(value.getTime())?value.toISOString().slice(0,10):cell.text];
    if(value&&typeof value==='object')return[field,value.formula?'='+value.formula:cell.text];
    if(field==='educations'&&typeof value==='string'){try{return[field,JSON.parse(value)];}catch{}}
    return[field,value??null];
  }));
}

function failedRow(row, error, source, previewData) {
  return { row, previewData, status: 'FAILED', statusCode: error.statusCode || 400, message: error.message,
    issue: makeIssue(source.sheet, source.row ?? row, source.headers, identifyField(error, source.headers), error.message) };
}

const normalizeName = value => typeof value === 'string'
  ? value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi') : '';

function createAssignmentResolver(catalog) {
  return ({ departmentName, positionName, positionLevel, jobLevel }) => {
    const department = normalizeName(departmentName);
    const position = normalizeName(positionName);
    if (!department) throw fieldError(400, 'departmentName', 'Nhập tên phòng ban theo danh mục ERIS. / Enter a department name from ERIS.');
    if (!position) throw fieldError(400, 'positionName', 'Nhập tên chức danh trong phòng ban đã chọn. / Enter a position from the selected department.');
    const departments = catalog.filter(item => normalizeName(item.departmentName) === department);
    if (!departments.length) throw fieldError(404, 'departmentName', `Không tìm thấy phòng ban đang hoạt động / Active department not found: "${departmentName}".`);
    if (new Set(departments.map(item => item.departmentId)).size > 1) {
      throw fieldError(409, 'departmentName', `Tên phòng ban bị trùng / Ambiguous department name: "${departmentName}".`);
    }
    const positions = departments.filter(item => item.positionId != null && normalizeName(item.positionName) === position);
    if (!positions.length) throw fieldError(404, 'positionName', `Chức danh không có trong phòng ban / Position not found in department: "${positionName}" (${departmentName}).`);

    const namedLevel = normalizeName(positionLevel);
    const hasNamedLevel = Boolean(namedLevel) || (positionLevel !== undefined && typeof positionLevel !== 'string');
    const hasLevel = hasNamedLevel || jobLevel !== undefined;
    const level = hasNamedLevel
      ? levelNames.findIndex(name => normalizeName(name) === namedLevel) + 1
      : (typeof jobLevel === 'number' || typeof jobLevel === 'string' ? Number(jobLevel) : NaN);
    if (hasLevel && (!Number.isInteger(level) || !levelNames[level - 1])) {
      throw fieldError(400, 'job_level', 'Chọn tên cấp độ trong danh sách / Choose a level from the list: ' + levelNames.join(', ') + '.');
    }
    const matches = hasLevel ? positions.filter(item => Number(item.jobLevel) === level) : positions;
    if (!matches.length) throw fieldError(404, 'job_level', `Chức danh "${positionName}" không có cấp độ ${levelNames[level - 1]}. / No matching position at ${levelNames[level - 1]} level.`);
    if (matches.length > 1) {
      const levels = [...new Set(matches.map(item => levelNames[Number(item.jobLevel) - 1]))].join(', ');
      throw fieldError(409, 'job_level', hasLevel
        ? `Chức danh "${positionName}" bị trùng ở cấp ${levelNames[level - 1]}. / Multiple positions share this name and level.`
        : `Chức danh "${positionName}" có nhiều cấp. Hãy chọn ${levels}. / Select a level: ${levels}.`);
    }
    const { departmentId, positionId } = matches[0];
    return { departmentId, positionId, departmentName:matches[0].departmentName,positionName:matches[0].positionName,jobLevel:Number(matches[0].jobLevel) };
  };
}

function validateImportEmployee(input, resolveAssignment) {
  if(Object.hasOwn(input,'work_schedule_id'))throw new AppError(400,'Use shift_type only; work_schedule_id is resolved internally.');
  const { employee_code, departmentName, positionName, shift_type, job_level, positionLevel, jobLevel, ...profile } = input;
  const shiftType=normalizeShiftType(shift_type);
  if (employee_code == null || (typeof employee_code === 'string' && !employee_code.trim())) {
    throw new AppError(400, 'Thiếu mã nhân viên (employee_code). / Employee code is required.');
  }
  let employeeCode;
  try {
    employeeCode = validateEmployeeCode(employee_code);
  } catch (error) {
    throw new AppError(400, error.message.replace('employeeCode', 'employee_code') + ' Use a Text cell.');
  }
  let assignment={};
  if(resolveAssignment)assignment=resolveAssignment({departmentName,positionName,positionLevel:job_level??positionLevel,jobLevel});
  else if(departmentName!==undefined||positionName!==undefined){
    for(const [field,value] of Object.entries({departmentName,positionName}))if(typeof value!=='string'||!value.trim()||value.trim().length>150)throw fieldError(400,field,field+' is required.');
    const level=job_level??positionLevel??jobLevel;
    const names={entry:1,junior:2,intermediate:3,senior:4,expert:5,leadership:5,'expert / leadership':5};
    const parsed=level==null||level===''?null:names[String(level).trim().toLowerCase()]??Number(level);
    if(parsed!==null&&(!Number.isInteger(parsed)||parsed<1||parsed>5))throw fieldError(400,'job_level','Invalid job_level.');
    assignment={departmentName:departmentName.trim(),positionName:positionName.trim(),jobLevel:parsed};
  }
  const employee=validateCreateEmployeeInput({...profile,departmentId:assignment.departmentId??profile.departmentId??1,positionId:assignment.positionId??profile.positionId??1,employeeCode},{allowUnverifiedInstitution:true});
  if(assignment.departmentName!==undefined&&!assignment.departmentId){delete employee.departmentId;delete employee.positionId;}
  return {...employee,...assignment,shiftType};
}
function checkImportCode(employee, seen) {
  if (seen.has(employee.employeeCode)) throw new AppError(409, 'Duplicate employee_code within workbook.');
  seen.add(employee.employeeCode);
}
function readHeaders(sheet, allowed, requiredHeaders) {
  const row = sheet.getRow(1);
  const headers = Array.from({ length: sheet.columnCount }, (_, index) => {
    const value = row.getCell(index + 1).value;
    return typeof value === 'string' ? value.trim() : '';
  });
  const missing = requiredHeaders.filter(field => !headers.includes(field));
  const unknown = [...new Set(headers.filter(field => field && !allowed.includes(field)))];
  const duplicates = [...new Set(headers.filter((field, index) => field && headers.indexOf(field) !== index))];
  const empty = headers.flatMap((field, index) => field ? [] : [index + 1]);
  const issues = [
    missing.length && 'Missing columns: ' + missing.join(', '),
    unknown.length && 'Unsupported columns: ' + unknown.join(', '),
    duplicates.length && 'Duplicate columns: ' + duplicates.join(', '),
    empty.length && 'Empty headers at columns: ' + empty.join(', '),
  ].filter(Boolean);
  if (issues.length) {
    const details = missing.map(field => makeIssue(sheet.name, 1, headers, field, 'Thiếu tiêu đề cột. Thêm cột với đúng tên trường. / Add this required column header.'));
    for (const [index, field] of headers.entries()) {
      let message;
      if (!field) message = 'Tiêu đề trống. Điền tiêu đề đúng hoặc bỏ cột thừa. / Name or remove this column.';
      else if (unknown.includes(field)) message = 'Tên cột không có trong mẫu. Kiểm tra lại tên hoặc bỏ cột. / Correct or remove this unsupported header.';
      else if (headers.indexOf(field) !== index) message = 'Tiêu đề bị trùng. Giữ một cột cho trường này. / Keep one column for this field.';
      if (message) details.push(makeIssue(sheet.name, 1, headers, field || undefined, message, index));
    }
    throw workbookError(sheet.name + ': ' + issues.join('. '), details);
  }
  return headers;
}

async function getAssignmentResolver(headers, loadCatalog, sheet) {
  const usesIds = headers.some(field => idColumns.includes(field));
  const usesNames = headers.some(field => nameColumns.includes(field) || levelColumns.includes(field));
  if (usesIds && usesNames) throw new AppError(400, 'Dùng cột departmentName và positionName cùng nhau. / Do not mix department and position names with ID columns.');
  if (levelColumns.filter(field => headers.includes(field)).length > 1) {
    throw new AppError(400, 'Chỉ dùng một cột cấp độ / Use one position level column: job_level.');
  }
  const required = usesIds ? idColumns : nameColumns;
  const missing = required.filter(field => !headers.includes(field));
  if (missing.length) throw workbookError(sheet + ': Missing columns: ' + missing.join(', '),
    missing.map(field => makeIssue(sheet, 1, headers, field, 'Thêm cột với đúng tên trường. / Add this required column header.')));
  if (usesIds) return undefined;
  return loadCatalog?createAssignmentResolver(await loadCatalog()):undefined;
}

async function parseWorkbook(buffer, loadCatalog) {
  let workbook;
  try { workbook = await readXlsx(buffer); }
  catch {
    throw workbookError('Không đọc được cấu trúc tệp Excel. Mở tệp, lưu lại dưới dạng Excel Workbook (.xlsx), rồi chọn lại. / Open the file and save a new copy as Excel Workbook (.xlsx), then select it again.');
  }
  const sheets = workbook.worksheets.filter(s => s.actualRowCount > 0);
  if (sheets.length !== 1) return parseRelatedSheets(sheets, loadCatalog);
  const sheet = sheets[0];
  if (sheet.rowCount > 1000) throw new AppError(400, 'Workbook exceeds row limits.');
  const headers = readHeaders(sheet, [...fields, 'educations'], [...profileColumns, 'shift_type', 'educations']);
  const source = { sheet: sheet.name, headers };
  const resolveAssignment = await getAssignmentResolver(headers, loadCatalog, sheet.name);
  const rows = [];
  const emails = new Set();
  const phones = new Set();
  const codes = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (!row.values.slice(1).some(v => v !== null && v !== undefined && v !== '')) return;
    let input = {};
    const previewData=previewCells(row,headers);
    try {
      headers.forEach((field, index) => {
        let value = row.getCell(index + 1).value;
        if (value === null || value === undefined || value === '') return;
        if (value instanceof Date) {
          if (!['dateOfBirth','hireDate'].includes(field) || !Number.isFinite(value.getTime())) throw fieldError(400, field, 'Invalid date cell. Enter a plain value in the expected format.');
          value = value.toISOString().slice(0,10);
        } else if (typeof value === 'object') {

          throw fieldError(400, field, `Use plain values, not formulas or objects, in ${field}.`);
        }
        if (['departmentId','positionId','currentSalary'].includes(field) && typeof value === 'string' && value.trim()) value = Number(value);
        if (field === 'educations') {
          if (typeof value !== 'string') throw new AppError(400, `${field} phải là mảng JSON trong ô Text.`);
          try { value = JSON.parse(value); }
          catch { throw new AppError(400, `${field} không phải JSON hợp lệ.`); }
        }
        input[field] = value;
      });
      input = validateImportEmployee(input, resolveAssignment);
      if (emails.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (phones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
      checkImportCode(input, codes);
      emails.add(input.email);
      phones.add(phoneKey(input.phone));
      rows.push({ row: rowNumber, input, source, previewData });
    } catch (error) {
      rows.push(failedRow(rowNumber, error, source, previewData));
    }
  });
  if (!rows.length || rows.length > 200) throw new AppError(400, 'File must contain between 1 and 200 employee rows.');
  return rows;
}

function readRelatedSheet(sheet, allowed, requiredHeaders, maxRows) {
  if (!sheet || sheet.rowCount > maxRows + 1) throw new AppError(400, 'Thiếu sheet hoặc vượt giới hạn dòng.');
  const headers = readHeaders(sheet, allowed, requiredHeaders);
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
          if (!['dateOfBirth', 'hireDate', 'startDate', 'endDate'].includes(field) || !Number.isFinite(value.getTime())) throw fieldError(400, field, 'Ô ngày không hợp lệ. / Invalid date cell.');
          value = value.toISOString().slice(0, 10);
        } else if (typeof value === 'object') throw fieldError(400, field, 'Nhập giá trị trực tiếp, bỏ công thức hoặc liên kết. / Replace formulas and links with plain values.');
        if (['departmentId', 'positionId', 'currentSalary', 'graduationYear'].includes(field) && typeof value === 'string' && value.trim()) value = Number(value);
        input[field] = value;
      }
    } catch (caught) { error = caught; }
    records.push({ row: number, input, error, previewData:previewCells(row,headers) });
  });
  return { headers, records };
}

async function parseRelatedSheets(sheets, loadCatalog) {
  const names = ['Employees', 'Educations'];
  if (sheets.length !== 2 || sheets.some(sheet => !names.includes(sheet.name))) {
    throw workbookError('Dùng một sheet có cột educations dạng JSON, hoặc đúng 2 sheet Employees, Educations. / Use the sheet names from the Excel template.');
  }
  const sheet = name => sheets.find(s => s.name === name);
  const { headers, records: employees } = readRelatedSheet(sheet('Employees'), fields, [...profileColumns,'shift_type'], 200);
  if (!employees.length) throw new AppError(400, 'Employees phải có từ 1 đến 200 nhân viên.');
  const { headers: educationHeaders, records: educations } = readRelatedSheet(sheet('Educations'), educationFields, ['email', 'educationLevel', 'institution'], 4000);
  const resolveAssignment = await getAssignmentResolver(headers, loadCatalog, 'Employees');
  const source = { sheet: 'Employees', headers };
  const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const knownEmails = new Set(employees.map(row => emailKey(row.input.email)).filter(Boolean));
  const backgrounds = new Map([...knownEmails].map(email => [email, { educations: [], educationRows: [], rawEducations: [], errors: [] }]));
  for (const [sheetName, key, rows] of [['Educations', 'educations', educations]]) {
    for (const row of rows) {
      const email = emailKey(row.input.email);
      if (!email || !knownEmails.has(email)) {
        const message = 'Điền email trùng với hồ sơ tương ứng ở sheet Employees. / Use the same email as the corresponding Employees row.';
        throw workbookError(`${sheetName} dòng ${row.row}: email không có trong sheet Employees.`,
          [makeIssue(sheetName, row.row, educationHeaders, 'email', message)]);
      }
      const background = backgrounds.get(email);
      const {email:_originalEmail,...originalEducation}=row.previewData;
      background.rawEducations.push(originalEducation);
      if (row.error) background.errors.push(row);
      else {
        const { email: _email, ...data } = row.input;
        background[key].push(data);
        background.educationRows.push(row.row);
      }
    }
  }
  const seen = new Set();
  const seenPhones = new Set();
  const seenCodes = new Set();
  return employees.map(row => {
    const background = backgrounds.get(emailKey(row.input.email));
    const previewData={...row.previewData,educations:background?.rawEducations??[]};
    try {
      if (row.error) throw row.error;
      if (background?.errors.length) {
        const invalidEducation = background.errors[0];
        return failedRow(row.row, invalidEducation.error, { sheet: 'Educations', row: invalidEducation.row, headers: educationHeaders },previewData);
      }
      const input = validateImportEmployee({ ...row.input, educations: background?.educations ?? [] }, resolveAssignment);
      if (seen.has(input.email)) throw new AppError(409, 'Duplicate email within workbook.');
      if (seenPhones.has(phoneKey(input.phone))) throw new AppError(409, 'Số điện thoại bị trùng trong cùng file Excel.');
      checkImportCode(input, seenCodes);
      seen.add(input.email);
      seenPhones.add(phoneKey(input.phone));
      return { row: row.row, input, source, previewData };
    } catch (error) {
      const education = error.message.match(/^educations\[(\d+)\]:\s*(.*)/u);
      const educationRow = education && background?.educationRows[Number(education[1])];
      if (educationRow) {
        const detail = new AppError(error.statusCode || 400, education[2]);
        const result = failedRow(row.row, detail, { sheet: 'Educations', row: educationRow, headers: educationHeaders },previewData);
        return { ...result, message: `Educations, row ${educationRow}: ${detail.message}` };
      }
      return failedRow(row.row, error, source, previewData);
    }
  });
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

module.exports={parseWorkbook,validateImportEmployee,employeeImportTemplate,failedRow};
