const THRESHOLD=0.099;
function assess(model) {
  const alert=model.score>=THRESHOLD;
  return {...model,predictionLabel:alert,riskLevel:alert?'REVIEW_REQUIRED':'NO_ALERT',
    assessment:{status:alert?'REVIEW_REQUIRED':'NO_ALERT',label:alert?'Cần HR xem xét':'Chưa có cảnh báo',
      threshold:THRESHOLD,scorePoints:Number((model.score*100).toFixed(2)),thresholdPoints:9.9,
      explanation:'Điểm dùng để xác định cảnh báo, không phải tỷ lệ chắc chắn nhân viên sẽ nghỉ.'}};
}
module.exports={assess,THRESHOLD};
