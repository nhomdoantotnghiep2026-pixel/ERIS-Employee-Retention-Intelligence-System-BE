const {test}=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const R=require('../src/modules/attendance/attendance-import.rules');
const {parseWorkbook}=require('../src/modules/attendance/attendance-import.excel');
const hc={id:1,shift_type:'HC',status:'ACTIVE',start_time:'08:00:00',end_time:'17:00:00',break_start:'12:00:00',break_end:'13:00:00',working_days:[1,2,3,4,5]};
const night={...hc,id:2,shift_type:'NIGHT',start_time:'22:00:00',end_time:'06:00:00',break_start:'02:00:00',break_end:'03:00:00'};
for(const [name,s,d,a,b,working,late,early] of [
  ['TC01',hc,'2026-11-16','2026-11-16 08:00:00','2026-11-16 17:00:00',480,0,0],
  ['TC02/TC18',hc,'2026-11-16','2026-11-16 08:15:00','2026-11-16 17:15:00',480,15,0],
  ['TC03',hc,'2026-11-16','2026-11-16 08:00:00','2026-11-16 16:30:00',450,0,30],
  ['TC04',night,'2026-11-16','2026-11-16 22:15:00','2026-11-17 06:10:00',415,15,0],
  ['TC05',night,'2026-11-16','2026-11-17 00:15:00','2026-11-17 06:00:00',285,135,0],
  ['TC06',night,'2026-11-16','2026-11-16 22:00:00','2026-11-16 23:30:00',90,0,390],
  ['early arrival',hc,'2026-11-16','2026-11-16 07:45:00','2026-11-16 17:00:00',495,0,0],
  ['clock early vs working deficit',hc,'2026-11-16','2026-11-16 08:00:00','2026-11-16 12:00:00',240,0,300],
])test(name,()=>{
  const start=R.timestamp(a),end=R.timestamp(b),metrics=R.calculate(d,start,end,s);
  assert.deepEqual([metrics.working_minutes,metrics.late_mins,metrics.early_mins,metrics.overtime_minutes],[working,late,early,name==='TC02/TC18'?15:name==='TC04'?10:0]);
  assert.deepEqual(R.candidates(start,end,s),[d]);assert.equal(metrics.attendance_status,'PRESENT');
});
test('break overlap and invalid break configuration',()=>{
  assert.equal(R.calculate('2026-11-16',R.timestamp('2026-11-16 12:30:00'),R.timestamp('2026-11-16 14:00:00'),hc).working_minutes,60);
  assert.throws(()=>R.timeline('2026-11-16',{...night,break_end:'02:00:00'}));
  assert.throws(()=>R.timeline('2026-11-16',{...night,break_end:null}));
  assert.throws(()=>R.timeline('2026-11-16',{...hc,break_start:'07:00:00'}));
  assert.equal(R.calculate('2026-11-16',R.timestamp('2026-11-16 08:00:00'),R.timestamp('2026-11-16 17:00:00'),{...hc,break_start:null,break_end:null}).working_minutes,540);
});
test('strict dates and policy; ambiguous candidates remain ambiguous',()=>{
  for(const value of ['2026-02-30 08:00:00','16/11/2026 08:00:00','2026-11-16 24:00:00','2026-11-16T08:00:00Z'])assert.throws(()=>R.timestamp(value));
  assert.throws(()=>R.policy({late_arrival_minutes:-1}));
  assert.throws(()=>R.calculate('2026-11-16',R.timestamp('2026-11-16 17:00:00'),R.timestamp('2026-11-16 08:00:00'),hc));
  assert.ok(R.candidates(R.timestamp('2026-11-16 08:00:00'),R.timestamp('2026-11-16 17:00:00'),{...hc,attendance_policy:{early_arrival_minutes:1440,late_arrival_minutes:1440,early_departure_minutes:1440,late_departure_minutes:1440}}).length>1);
  assert.equal(R.id('9223372036854775807'),'9223372036854775807');assert.throws(()=>R.id('9223372036854775808'));assert.throws(()=>R.id(undefined));
});
test('Excel date cells in both date systems preserve Vietnam wall time; formula and locale strings rejected',async()=>{
  for(const date1904 of [false,true]){
    const b=new ExcelJS.Workbook();b.properties.date1904=date1904;const s=b.addWorksheet('Attendance');
    s.addRow(['employee_code','shift_type','check_in','check_out']);
    s.addRow(['EMP001','HC',new Date('2026-11-16T08:15:00Z'),new Date('2026-11-16T17:00:00Z')]);
    s.addRow(['EMP001','HC',{formula:'NOW()',result:123},'16/11/2026 17:00']);
    const rows=await parseWorkbook({originalname:'attendance.xlsx',buffer:Buffer.from(await b.xlsx.writeBuffer())});
    assert.equal(rows[0].check_in,'2026-11-16T08:15:00+07:00');assert.equal(rows[0].check_out,'2026-11-16T17:00:00+07:00');
    assert.equal(rows[1].parse_issues.length,2);
  }
});
test('invalid file and missing or duplicate headers rejected',async()=>{
  await assert.rejects(parseWorkbook({originalname:'bad.xlsx',buffer:Buffer.from('not xlsx')}),{code:'ATT-001'});
  for(const headers of [['employee_code'],['employee_code','employee_code','shift_type','check_in','check_out']]){
    const b=new ExcelJS.Workbook();b.addWorksheet('x').addRow(headers);
    await assert.rejects(parseWorkbook({originalname:'x.xlsx',buffer:Buffer.from(await b.xlsx.writeBuffer())}),{code:'ATT-002'});
  }
});
