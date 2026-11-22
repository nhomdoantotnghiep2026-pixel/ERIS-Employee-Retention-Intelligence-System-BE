const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {parse}=require('../src/modules/leave-records/services/leave-records.import');
const V=require('../src/modules/leave-records/leave-records.validation');
test('strict whole-date input rejects hourly fields, spoofed creator, impossible dates and reversed dates',()=>{
 const base={employee_id:1,leave_type_id:1,start_date:'2026-11-16',end_date:'2026-11-16'};
 for(const patch of [{start_time:'10:00'},{recorded_by:2},{start_date:'2026-02-30'},{end_date:'2026-11-15'},{employee_id:0}])assert.throws(()=>V.input({...base,...patch}),e=>e.statusCode===400);
 assert.equal(V.input(base).start_date,'2026-11-16');
});
test('CSV handles quoted comma/newline, Unicode and preserves dates',async()=>{
 const file={originalname:'leave.csv',buffer:Buffer.from('employee_code,leave_type,start_date,end_date,reason\r\nEMP009,LT001,2026-11-16,2026-11-16,"Nghỉ, cá nhân\nCó việc"')};
 const parsed=await parse(file);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].reason,'Nghỉ, cá nhân\nCó việc');assert.equal(parsed.rows[0].start_date,'2026-11-16');assert.equal(parsed.fingerprint.length,64);
});
test('XLSX date cells accepted; formulas reported per row',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Leave');sheet.addRow(['employee_code','leave_type','start_date','end_date']);sheet.addRow(['EMP009','LT001',new Date('2026-11-16Z'),new Date('2026-11-16Z')]);sheet.addRow([{formula:'1+1'},'LT001','2026-11-16','2026-11-16']);
 const result=await parse({originalname:'leave.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer())});assert.equal(result.rows[0].start_date,'2026-11-16');assert.ok(result.rows[1].parse_error);
});
