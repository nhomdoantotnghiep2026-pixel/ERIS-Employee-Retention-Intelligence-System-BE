// Starts the existing local model image and backend without writing credentials to .env.
const {spawn,execFileSync}=require('node:child_process');
const {randomBytes,randomUUID}=require('node:crypto');
const path=require('node:path');
const name='eris-ai-review-'+randomUUID().slice(0,8);
const secret=randomBytes(32).toString('hex');
const dockerEnv={...process.env,ERIS_SERVICE_API_KEY:secret};
const docker=(...args)=>execFileSync('docker',args,{env:dockerEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let child,started=false,closing=false;
function cleanup(){if(closing)return;closing=true;if(child)child.kill();if(started){try{docker('stop',name);}catch{}}}
process.on('SIGINT',()=>{cleanup();process.exit(0);});process.on('SIGTERM',()=>{cleanup();process.exit(0);});
(async()=>{
  try{
    docker('image','inspect','eris-model-review:local');
    docker('run','-d','--rm','--name',name,'-p','127.0.0.1::8000','--read-only','--tmpfs','/tmp:rw,noexec,nosuid',
      '--cap-drop','ALL','--security-opt','no-new-privileges:true','-e','ERIS_SERVICE_API_KEY','eris-model-review:local');started=true;
    const base='http://127.0.0.1:'+docker('port',name,'8000/tcp').split(':').pop();
    console.log('Đang nạp model...');let ready=false;
    for(let i=0;i<90&&!closing;i++){try{const r=await fetch(base+'/v1/models',{headers:{'X-ERIS-Service-Key':secret},signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).models.some(x=>x.ready)){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
    if(!ready)throw new Error('MODEL_NOT_READY');
    const port=process.env.REVIEW_AI_PORT||'3100';
    if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('INVALID_PORT');
    console.log('Mở http://localhost:'+port+'/ai-review-demo · Ctrl+C để dừng cả backend và model.');
    child=spawn(process.execPath,['src/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:port,AI_MODEL_BASE_URL:base,AI_MODEL_SERVICE_KEY:secret},stdio:'inherit'});
    child.on('exit',code=>{cleanup();process.exitCode=code||0;});child.on('error',()=>{cleanup();process.exitCode=1;});
  }catch{cleanup();console.error('Không khởi động được demo. Kiểm tra Docker Desktop, image eris-model-review:local và cổng backend. Xem AI-REVIEW.md.');process.exitCode=1;}
})();
