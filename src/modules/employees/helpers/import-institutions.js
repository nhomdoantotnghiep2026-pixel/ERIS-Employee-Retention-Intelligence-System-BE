const {AppError}=require('../../../common/errors/app-error');
const nameKey=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi');
function parseInstitutionChoices(raw,rows){
 if(raw===undefined)return new Map();
 let choices;try{choices=JSON.parse(raw);}catch{throw new AppError(400,'Invalid institution choices JSON.');}
 if(!Array.isArray(choices)||choices.length>4000)throw new AppError(400,'Invalid institution choices.');
 const result=new Map();
 for(const choice of choices){
  if(!choice||Object.keys(choice).some(k=>!['row','educationIndex','institutionRefId'].includes(k))||!Number.isInteger(choice.row)||!Number.isInteger(choice.educationIndex)||typeof choice.institutionRefId!=='string'||choice.institutionRefId.length>528)throw new AppError(400,'Invalid institution choice.');
  const row=rows.find(r=>r.row===choice.row),key=choice.row+':'+choice.educationIndex;
  if(!row?.input?.educations[choice.educationIndex]||result.has(key))throw new AppError(400,'Unknown or duplicate institution choice.');
  result.set(key,choice.institutionRefId);
 }
 return result;
}
async function prepareImportInstitutions(rows,educationService,choices=new Map()){
 const cache=new Map();
 const lookup=(data)=>{
  const key=JSON.stringify([nameKey(data.institution),data.educationLevel]);
  if(!cache.has(key))cache.set(key,educationService.searchInstitutions({name:data.institution,educationLevel:data.educationLevel}));
  return cache.get(key);
 };
 let next=0;const output=new Array(rows.length);
 async function worker(){while(next<rows.length){const index=next++,row=rows[index];if(!row.input){output[index]=row;continue;}
  const input={...row.input,educations:row.input.educations.map(e=>({...e}))},institutions=[];
  try{
   for(const [educationIndex,record] of input.educations.entries()){
    const originalName=record.institution;
    let candidates=[],unavailable=false;
    try{candidates=(await lookup(record)).data||[];}catch(error){if(error.statusCode!==503)throw error;unavailable=true;}
    const supplied=choices.get(row.row+':'+educationIndex)||record.institutionRefId;
    const exact=candidates.filter(c=>nameKey(c.institution)===nameKey(originalName));
    const selected=supplied?candidates.find(c=>c.id===supplied):exact.length===1?exact[0]:null;
    if(supplied&&!selected)throw new AppError(400,'Lựa chọn trường đã thay đổi hoặc không thuộc kết quả đối chiếu. Vui lòng xem trước lại.');
    if(selected){record.institution=selected.institution;record.institutionRefId=selected.id;}
    else delete record.institutionRefId;
    const status=selected?'MATCHED':candidates.length?'NEEDS_SELECTION':unavailable?'UNAVAILABLE':'NOT_FOUND';
    institutions.push({educationIndex,originalName,status,selectedId:selected?.id||null,candidates,
     warning:status==='NOT_FOUND'?'Không tìm thấy trường phù hợp. Sẽ lưu tên đã nhập, chưa đối chiếu danh mục.':status==='UNAVAILABLE'?'Dịch vụ tra cứu tạm thời không khả dụng. Sẽ lưu tên đã nhập, chưa đối chiếu danh mục.':null});
   }
   const educationKeys=new Set();
   for(const record of input.educations){
    const key=JSON.stringify([record.educationLevel,nameKey(record.institution),record.fieldOfStudy?.toLowerCase(),record.graduationYear]);
    if(educationKeys.has(key))throw new AppError(400,'Bằng cấp bị trùng sau khi đối chiếu tên trường.');
    educationKeys.add(key);
   }
   output[index]={...row,input,institutions,needsSelection:institutions.some(i=>i.status==='NEEDS_SELECTION')};
  }catch(error){output[index]={row:row.row,previewData:row.previewData??row.input,status:'FAILED',statusCode:error.statusCode||400,message:error.message};}
 }}
 await Promise.all(Array.from({length:Math.min(rows.length,3)},worker));return output;
}
function institutionPreview(rows){
 const results=rows.map(r=>({row:r.row,email:r.input?.email??r.previewData?.email,employee:r.previewData??r.input??{},status:!r.input?'FAILED':r.needsSelection?'NEEDS_REVIEW':'VALID',message:r.message,issue:r.issue,institutions:r.institutions||[]}));
 return{total:results.length,valid:results.filter(r=>r.status==='VALID').length,failed:results.filter(r=>r.status==='FAILED').length,pending:results.filter(r=>r.status==='NEEDS_REVIEW').length,results};
}
module.exports={prepareImportInstitutions,parseInstitutionChoices,institutionPreview};
