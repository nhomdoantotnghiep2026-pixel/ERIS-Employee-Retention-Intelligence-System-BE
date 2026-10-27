const { AppError } = require('../../common/errors/app-error');
const { prioritizeInstitutions } = require('./education-level-advice');
const rorPattern=/^https:\/\/ror\.org\/[a-z0-9]{9}$/;
const vietmapPattern=/^vietmap:(?:auto|geocode):[A-Za-z0-9_-]{1,512}$/;
const vietmapBase='https://maps.vietmap.vn/api';
const validText=(value,max)=>typeof value==='string'&&!!value.trim()&&[...value.trim()].length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const words=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().match(/[a-z0-9]+/g)||[];
function relevantSchool(school,query){
  const wanted=[...new Set(words(query).filter(word=>word.length>1))];
  if(!wanted.length)return false;
  const label=new Set(words(school.institution));
  return wanted.filter(word=>label.has(word)).length>=Math.ceil(wanted.length*0.75);
}
const schoolLike=name=>/(?:cao dang|dai hoc|hoc vien|university|college|polytechnic)/.test(words(name).join(' '));
function normalizeRor(item){
  if(!item||item.status!=='active'||!item.types?.includes('education')||!rorPattern.test(item.id||''))return null;
  const names=Array.isArray(item.names)?item.names:[];
  const selected=names.find(n=>n.lang==='vi'&&n.types?.includes('label'))||names.find(n=>n.types?.includes('ror_display'))||names.find(n=>n.types?.includes('label'));
  if(!validText(selected?.value,150))return null;
  const location=item.locations?.[0]?.geonames_details;
  return{id:item.id,institution:selected.value.trim(),country:location?.country_name||null,countryCode:location?.country_code||null,website:item.links?.find(l=>l.type==='website'&&/^https?:\/\//.test(l.value||''))?.value||null,source:'ROR'};
}
function normalizeVietmap(item){
  if(!item||!validText(item.name,150)||!validText(item.display,300)||!schoolLike(item.name)||!vietmapPattern.test('vietmap:'+item.ref_id))return null;
  return{id:'vietmap:'+item.ref_id,institution:item.name.trim(),address:validText(item.address,250)?item.address.trim():null,display:item.display.trim(),country:'Việt Nam',countryCode:'VN',website:null,source:'VIETMAP'};
}
async function request(url,fetchImpl,{detail=false,vietmap=false}={}){
  try{
    const headers={Accept:'application/json'};
    if(!vietmap&&process.env.ROR_CLIENT_ID)headers['Client-Id']=process.env.ROR_CLIENT_ID;
    const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(8000)});
    if(detail&&response.status===404)throw new AppError(400,'Selected institution no longer exists in its directory.');
    if(!response.ok)throw Error('Institution provider unavailable');
    return await response.json();
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(503,'Institution directory is temporarily unavailable. Please try again later.');}
}
function createInstitutionResolver(fetchImpl=fetch,vietmapKey=process.env.VIETMAP_API_KEY){
  return async refId=>{
    if(rorPattern.test(refId)){
      const item=await request(new URL('https://api.ror.org/v2/organizations/'+refId.slice(-9)),fetchImpl,{detail:true});
      const school=normalizeRor(item);
      if(!school||school.id!==refId)throw new AppError(400,'Selected institution must be an active education organization in ROR.');
      return school;
    }
    if(vietmapPattern.test(refId)){
      if(!vietmapKey)throw new AppError(503,'VIETMAP_API_KEY is not configured. Cannot verify this institution.');
      const url=new URL(vietmapBase+'/place/v4');url.searchParams.set('apikey',vietmapKey);url.searchParams.set('refid',refId.slice(8));
      const item=await request(url,fetchImpl,{detail:true,vietmap:true});
      if(!validText(item?.name,150)||!schoolLike(item.name)||!Number.isFinite(item.lat)||!Number.isFinite(item.lng)||Math.abs(item.lat)>90||Math.abs(item.lng)>180)throw new AppError(400,'Selected Vietmap result is not a verifiable school place.');
      return{id:refId,institution:item.name.trim(),country:'Việt Nam',countryCode:'VN',website:null,source:'VIETMAP'};
    }
    throw new AppError(400,'Select a valid institutionRefId from ROR or Vietmap suggestions.');
  };
}
function createInstitutionSearch(fetchImpl=fetch,vietmapKey=process.env.VIETMAP_API_KEY){
  const cache=new Map();
  const store=(key,result)=>{if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{value:result,expires:Date.now()+3600000});return result;};
  return async({name,educationLevel})=>{
    const key=name.toLowerCase()+'|'+(educationLevel||''),cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.value;
    const rorUrl=new URL('https://api.ror.org/v2/organizations');
    rorUrl.searchParams.set('query',name.replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g,' '));rorUrl.searchParams.set('filter','types:education');
    let firstFailure=null,fallback=null;
    try{
      const payload=await request(rorUrl,fetchImpl);
      if(!Array.isArray(payload.items))throw new AppError(503,'Invalid ROR institution response.');
      const data=[],seen=new Set();for(const item of payload.items){const school=normalizeRor(item);if(!school||seen.has(school.id)||!relevantSchool(school,name))continue;data.push(school);seen.add(school.id);if(data.length===10)break;}
      if(data.length){const ranked=prioritizeInstitutions(data,educationLevel);const result={data:ranked,source:'ROR',manualEntryAllowed:false};if(!educationLevel||ranked[0].levelFit==='MATCH')return store(key,result);fallback=result;}
    }catch(error){firstFailure=error;}
    if(vietmapKey){
      try{
        const url=new URL(vietmapBase+'/search/v4');url.searchParams.set('apikey',vietmapKey);const explicitLevel=/(?:cao dang|college|polytechnic|dai hoc|university|hoc vien|academy)/.test(words(name).join(' '));
        url.searchParams.set('text',educationLevel===1&&!explicitLevel?'cao đẳng '+name:name);url.searchParams.set('display_type','5');
        const payload=await request(url,fetchImpl,{vietmap:true});
        if(!Array.isArray(payload))throw new AppError(503,'Invalid Vietmap search response.');
        const data=[],seen=new Set();for(const item of payload){const school=normalizeVietmap(item);if(!school||seen.has(school.id)||!relevantSchool(school,name))continue;data.push(school);seen.add(school.id);if(data.length===10)break;}
        if(data.length){const ranked=prioritizeInstitutions(data,educationLevel);const result={data:ranked,source:'VIETMAP',manualEntryAllowed:false};if(!fallback||ranked[0].levelFit==='MATCH')return store(key,result);}
      }catch(error){firstFailure??=error;}
    }
    if(fallback)return store(key,fallback);
    if(firstFailure)throw firstFailure;
    return{data:[],source:'NONE',manualEntryAllowed:false,fallbackAvailable:!!vietmapKey};
  };
}
module.exports={createInstitutionSearch,createInstitutionResolver,normalizeInstitution:normalizeRor,normalizeVietmap};
