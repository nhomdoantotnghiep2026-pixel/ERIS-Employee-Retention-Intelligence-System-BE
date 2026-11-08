const {AppError}=require('../../common/errors/app-error');
class DefaultScheduleStore {
 constructor({redisClient,ensureRedisConnection,key}){this.redis=redisClient;this.connect=ensureRedisConnection;this.key=key;}
 async run(work){try{await this.connect();return await work();}catch(error){if(error instanceof AppError)throw error;throw new AppError(503,'Không truy cập được lệnh đổi lịch mặc định trong Redis.');}}
 get(){return this.run(async()=>{const raw=await this.redis.get(this.key);return raw?JSON.parse(raw):null;});}
 put(value){return this.run(async()=>{const result=await this.redis.set(this.key,JSON.stringify(value),'NX');if(result!=='OK')throw new AppError(409,'Đã có một lịch mặc định đang chờ áp dụng.');});}
 clear(requestId){return this.run(()=>this.redis.eval("local v=redis.call('GET',KEYS[1]); if v and cjson.decode(v).requestId==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,this.key,requestId));}
}
module.exports={DefaultScheduleStore};
