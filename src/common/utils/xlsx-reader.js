const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const {SaxesParser}=require('saxes');
const SPREADSHEET='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS='http://schemas.openxmlformats.org/package/2006/relationships';
const posix=require('node:path').posix;
const LIMIT=64*1024*1024;
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r/g,'&#13;');
function normalizeSpreadsheetXml(xml,{relationshipsBase=null}={}){
 let changed=false;const output=[],names=[],parser=new SaxesParser({xmlns:true});
 parser.on('doctype',()=>{throw Error('DOCTYPE is not supported in XLSX parts.');});
 parser.on('error',error=>{throw error;});
 parser.on('opentag',tag=>{
  const name=[SPREADSHEET,PACKAGE_RELATIONSHIPS].includes(tag.uri)?tag.local:tag.name;if(name!==tag.name)changed=true;names.push(name);
  const attrs=Object.values(tag.attributes).map(attr=>{
   const name=attr.uri===RELATIONSHIPS?'r:'+attr.local:attr.name;if(name!==attr.name)changed=true;
   let value=attr.value;
   if(relationshipsBase!==null&&tag.uri===PACKAGE_RELATIONSHIPS&&tag.local==='Relationship'&&attr.name==='Target'&&value.startsWith('/')&&!Object.values(tag.attributes).some(a=>a.name==='TargetMode'&&a.value==='External')){value=posix.relative(relationshipsBase,value.slice(1));changed=true;}
   return name+'="'+escape(value)+'"';
  });
  // Preserve namespace meaning when replacing the spreadsheet element prefix.
  if(names.length===1){if(tag.uri===SPREADSHEET&&!Object.values(tag.attributes).some(a=>a.name==='xmlns'))attrs.push('xmlns="'+SPREADSHEET+'"');if(!Object.values(tag.attributes).some(a=>a.name==='xmlns:r'))attrs.push('xmlns:r="'+RELATIONSHIPS+'"');}
  output.push('<'+name+(attrs.length?' '+attrs.join(' '):'')+'>');
 });
 parser.on('closetag',()=>output.push('</'+names.pop()+'>'));
 parser.on('text',text=>output.push(escape(text)));
 parser.on('cdata',text=>output.push(escape(text)));
 parser.write(xml).close();return {changed,xml:output.join('')};
}
async function normalizePrefixedSpreadsheet(buffer){
 const zip=await JSZip.loadAsync(buffer);const files=Object.values(zip.files).filter(f=>!f.dir);
 if(files.length>2048)throw Error('Too many XLSX archive entries.');
 let total=0,changed=false;
 for(const file of files){total+=file._data?.uncompressedSize??0;if(total>LIMIT)throw Error('XLSX expanded size limit exceeded.');}
 for(const file of files){
  if(!/^xl\/.*\.xml$/i.test(file.name)&&!file.name.endsWith('.rels'))continue;
  const bytes=await file.async('nodebuffer');if(bytes.length>LIMIT)throw Error('XLSX part too large.');
  const relationshipsBase=file.name.endsWith('.rels')?posix.dirname(file.name).replace(/(?:^|\/)_rels$/,''):null;
  const result=normalizeSpreadsheetXml(bytes.toString('utf8'),{relationshipsBase});
  if(result.changed){zip.file(file.name,result.xml);changed=true;}
 }
 if(!changed)throw Error('No supported XLSX namespace compatibility conversion found.');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function readXlsx(buffer){
 try{const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);return book;}
 catch(original){try{const normalized=await normalizePrefixedSpreadsheet(buffer);const book=new ExcelJS.Workbook();await book.xlsx.load(normalized);return book;}catch{throw original;}}
}
module.exports={readXlsx,normalizeSpreadsheetXml};
