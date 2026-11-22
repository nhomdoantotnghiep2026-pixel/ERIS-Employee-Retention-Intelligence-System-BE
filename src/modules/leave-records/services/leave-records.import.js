const ExcelJS=require('exceljs');
const {createHash}=require('node:crypto');
const V=require('../leave-records.validation');
const HEADERS=['employee_code','leave_type','start_date','end_date','reason'];
async function parse(file){
 if(!file||!Buffer.isBuffer(file.buffer)||file.buffer.length>10*1024*1024||! /\.(xlsx|csv)$/i.test(file.originalname))V.fail('INVALID_FILE','Upload .xlsx or .csv, at most 10 MiB.');
 const book=new ExcelJS.Workbook();let sheet;
 try{if(/\.csv$/i.test(file.originalname)){const {Readable}=require('node:stream');sheet=await book.csv.read(Readable.from([file.buffer]),{map:v=>v});}else{await book.xlsx.load(file.buffer);sheet=book.worksheets[0];}}catch{V.fail('INVALID_FILE','Unable to read file.');}
 if(!sheet||sheet.rowCount<2||sheet.rowCount>10001||sheet.columnCount>20)V.fail('INVALID_FILE','Expected 1–10,000 data rows and at most 20 columns.');
 const columns={};sheet.getRow(1).eachCell((c,i)=>{const h=String(c.value||'').replace(/^\uFEFF/,'').trim();if(!HEADERS.includes(h)||columns[h])V.fail('INVALID_HEADERS','Unexpected or duplicate column: '+h);columns[h]=i;});
 if(HEADERS.slice(0,4).some(h=>!columns[h]))V.fail('INVALID_HEADERS','Required: '+HEADERS.slice(0,4).join(', '));
 const rows=[];for(let n=2;n<=sheet.rowCount;n++){const row={row:n};let invalid=false;for(const h of HEADERS){let v=columns[h]?sheet.getRow(n).getCell(columns[h]).value:null;if(v instanceof Date&&h.endsWith('_date'))v=Number.isFinite(v.getTime())?v.toISOString().slice(0,10):'INVALID';if(v!==null&&typeof v!=='string'&&typeof v!=='number'){invalid=true;v='';}row[h]=v==null?'':String(v).trim();}if(invalid)row.parse_error='Formula and complex cells are unsupported.';if(invalid||HEADERS.some(h=>row[h]))rows.push(row);}
 if(!rows.length)V.fail('INVALID_FILE','File has no data rows.');return {rows,fingerprint:createHash('sha256').update(file.buffer).digest('hex')};
}
module.exports={parse,HEADERS};
