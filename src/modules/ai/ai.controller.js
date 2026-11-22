const {demoData,runDemo}=require('./data/ai-demo-fixture');
const {AppError}=require('../../common/errors/app-error');
const {id}=require('../ai_input/helpers/ai-input.features');
class AiController {
  constructor({service,repository,unified,demo,policyRepository}) {
    this.handle=fn=>async(req,res,next)=>{try{res.json({data:await fn(req)});}catch(error){if(error instanceof AppError&&error.details)return res.status(error.statusCode).json({message:error.message,details:error.details});next(error);}};
    this.configuration = this.handle(async req=>{await repository.assertHr(req.auth.userId);const providers={OLLAMA:{configured:unified.provider.configured(),model:unified.provider.model},E5:{configured:unified.retriever.configured(),model:unified.retriever.model}};return {configured:Object.values(providers).every(item=>item.configured),provider:'OLLAMA+E5',model:`${providers.OLLAMA.model} + ${providers.E5.model}`,providers};});
    this.model = this.handle(req=>service.info(req.auth.userId));
    this.results = this.handle(req=>repository.results(req.auth.userId,id(req.params.employeeId)));
    this.predict = this.handle(req=>service.predict(req.auth.userId,req.params.employeeId,req.body));
    this.demoData = this.handle(req=>demoData(demo,req.auth.userId,req.params.employeeId));
    this.analyzeDemo = this.handle(req=>runDemo(demo,req.auth.userId,req.params.employeeId,req.body));
    this.analyze = this.handle(req=>unified.run(req.auth.userId,req.params.employeeId,req.body));
    this.batch = this.handle(req=>service.batch(req.auth.userId,req.body));
    this.recommendPolicies = this.handle(req=>policyRepository.generate(req.auth.userId,req.params.id,req.body));
    this.result = this.handle(req=>repository.result(req.auth.userId,id(req.params.id)));
  }
}
module.exports={AiController};
