const {score}=require('./surveys.dynamic.validation');

// Reuses the same application scoring as survey submission; no DB function required.
async function periodSatisfaction(client,employeeId,capturedAt,periodStart){
 const {rows}=await client.query(`
 SELECT r.id AS "responseId",q.id AS "questionId",q.category_id AS "categoryId",
        q.question_type AS "questionType",a.answer_value AS "answerValue"
 FROM survey_responses r
 JOIN survey_questions q ON q.survey_id=r.survey_id
 LEFT JOIN survey_answers a ON a.response_id=r.id AND a.question_id=q.id
 WHERE r.employee_id=$1 AND r.submitted_at IS NOT NULL
   AND r.submitted_at>=($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
   AND r.submitted_at<=$2::timestamptz AND q.question_type='RATING'
   AND COALESCE(q.answer_config->>'templateCode','')<>''
 ORDER BY r.submitted_at DESC,r.id DESC,q.id`,[employeeId,capturedAt,periodStart]);
 const groups=new Map();
 for(const row of rows){
  if(!groups.has(row.responseId))groups.set(row.responseId,{questions:[],answers:[]});
  const group=groups.get(row.responseId);
  group.questions.push({id:row.questionId,categoryId:row.categoryId,questionType:row.questionType,isSatisfactionCore:true});
  group.answers.push({questionId:row.questionId,answerValue:row.answerValue});
 }
 let total=0,count=0;
 for(const group of groups.values()){
  const value=score(group.questions,group.answers);
  if(value!==null){total+=value;count++;}
 }
 return count?Number((total/count).toFixed(2)):null;
}

module.exports={periodSatisfaction};
