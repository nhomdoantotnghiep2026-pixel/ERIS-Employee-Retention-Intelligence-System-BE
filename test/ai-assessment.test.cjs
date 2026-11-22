const test=require('node:test');
const assert=require('node:assert/strict');
const {assess}=require('../src/modules/ai/helpers/ai.assessment');
test('threshold uses unrounded raw score and includes equality',()=>{
 for(const [score,label] of [[0,false],[0.09899999,false],[0.099,true],[0.248,true],[1,true]]){
  const result=assess({score});
  assert.equal(result.predictionLabel,label);
  assert.equal(result.riskLevel,label?'REVIEW_REQUIRED':'NO_ALERT');
  assert.equal(result.assessment.label,label?'Cần HR xem xét':'Chưa có cảnh báo');
  assert.equal(result.assessment.threshold,0.099);
 }
});
