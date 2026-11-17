const {AppError}=require('../../common/errors/app-error');
const authored=require('./surveys.satisfaction-templates');
const validation=require('./surveys.dynamic.validation');
const SOURCE='ERIS_SURVEY_CATALOG';

function decode(row){
 const metadata=row.answer_config?.erisCatalog;
 const question=validation.question({questionText:row.question_text,categoryId:row.category_id,questionType:row.question_type,answerConfig:row.answer_config?.answerConfig??null,displayOrder:row.display_order});
 if(metadata.kind==='SATISFACTION'){
  if(question.questionType!=='RATING')throw new AppError(409,'A catalog satisfaction item must use RATING.');
  return {...question,templateCode:metadata.code,catalogQuestionId:row.id};
 }
 if(metadata.kind==='BANK')return {...question,bankCode:metadata.code,catalogQuestionId:row.id};
 throw new AppError(409,'Unsupported catalog item kind.');
}

async function readCatalog(client){
 const categories=(await client.query('SELECT id,name,description FROM survey_categories ORDER BY id')).rows;
 const rows=(await client.query(`SELECT id,category_id,question_text,question_type,answer_config,display_order
 FROM survey_questions WHERE survey_id IS NULL AND answer_config->'erisCatalog'->>'source'=$1
 ORDER BY display_order,id`,[SOURCE])).rows;
 const keys=new Set();
 for(const row of rows){const meta=row.answer_config.erisCatalog;if(typeof meta.code!=='string'||!meta.code)throw new AppError(409,'Catalog question code is missing.');const key=row.category_id+'|'+meta.kind+'|'+meta.code;if(keys.has(key))throw new AppError(409,'Duplicate catalog question code.');keys.add(key);}
 return categories.map(category=>{const items=rows.filter(row=>row.category_id===category.id),defaults=items.filter(row=>row.answer_config.erisCatalog.kind==='SATISFACTION'),bank=items.filter(row=>row.answer_config.erisCatalog.kind==='BANK');return {...category,defaultQuestions:defaults.length?defaults.map(decode):authored.templates(category),questionBank:bank.length?bank.map(decode):authored.bank(category)};});
}

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

// Caller owns the transaction. Only inserts new unassigned catalog records.
async function seedCatalog(client,{apply=false,expectedCategoryCount=null}={}){
 if(apply)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[SOURCE]);
 const categories=(await client.query('SELECT id,name,description FROM survey_categories ORDER BY id')).rows;
 if(expectedCategoryCount!==null&&categories.length!==expectedCategoryCount)throw Error('Category count changed; review before seeding.');
 const existing=(await client.query(`SELECT id,category_id,question_text,question_type,answer_config,display_order FROM survey_questions WHERE survey_id IS NULL AND answer_config->'erisCatalog'->>'source'=$1`,[SOURCE])).rows;
 let inserted=0,skipped=0;const report=[];
 for(const category of categories){const defaults=authored.templates(category),bank=authored.bank(category);if(defaults.length!==4||bank.length!==10)throw Error('Incomplete authored catalog: '+category.name);
  for(const [kind,items] of [['SATISFACTION',defaults],['BANK',bank]])for(const [index,item] of items.entries()){
   const code=kind==='SATISFACTION'?item.templateCode:item.bankCode;
   const config={erisCatalog:{source:SOURCE,kind,code,version:1},answerConfig:item.answerConfig};
   const matches=existing.filter(row=>row.category_id===category.id&&row.answer_config.erisCatalog.kind===kind&&row.answer_config.erisCatalog.code===code);
   if(matches.length>1)throw Error('Duplicate stored catalog code: '+code);
   if(matches.length){const row=matches[0];if(row.question_text!==item.questionText||row.question_type!==item.questionType||row.display_order!==index+1||!same(row.answer_config,config))throw Error('Stored catalog content differs; no overwrite performed: '+code);skipped++;continue;}
   if(apply)await client.query('INSERT INTO survey_questions(survey_id,category_id,question_text,question_type,answer_config,display_order) VALUES(NULL,$1,$2,$3,$4::jsonb,$5)',[category.id,item.questionText,item.questionType,JSON.stringify(config),index+1]);
   inserted++;
  }
  report.push({categoryId:category.id,name:category.name,defaultQuestions:defaults.length,bankQuestions:bank.length});
 }
 return {mode:apply?'APPLY':'PREVIEW',inserted,skipped,total:inserted+skipped,categories:report};
}

module.exports={SOURCE,readCatalog,seedCatalog};
