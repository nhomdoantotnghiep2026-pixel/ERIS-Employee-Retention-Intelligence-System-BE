// ERIS wording adapted from facet-based satisfaction approaches; not a validated scale.
const texts={
 COMPENSATION_BENEFITS:[['PAY','Nhìn chung, bạn hài lòng với mức lương hiện tại của mình ở mức độ nào?'],['BENEFITS','Nhìn chung, bạn hài lòng với các chế độ phúc lợi mà công ty cung cấp cho mình ở mức độ nào?']],
 WORKING_TIME:[['TIME','Nhìn chung, bạn hài lòng với cách sắp xếp thời gian làm việc của mình ở mức độ nào?']],
 WORK_ENVIRONMENT:[['ENVIRONMENT','Nhìn chung, bạn hài lòng với điều kiện làm việc tại công ty ở mức độ nào?']],
 CAREER_DEVELOPMENT:[['LEARNING','Nhìn chung, bạn hài lòng với cơ hội học tập và phát triển chuyên môn tại công ty ở mức độ nào?'],['CAREER','Nhìn chung, bạn hài lòng với cơ hội phát triển nghề nghiệp tại công ty ở mức độ nào?']],
 MANAGEMENT:[['MANAGER','Nhìn chung, bạn hài lòng với sự hỗ trợ từ quản lý trực tiếp ở mức độ nào?']],
 EMPLOYEE_ENGAGEMENT:[['EXPERIENCE','Nhìn chung, bạn hài lòng với trải nghiệm làm việc của mình tại công ty ở mức độ nào?']],
 WORK_LIFE_BALANCE:[['BALANCE','Nhìn chung, bạn hài lòng với sự cân bằng giữa công việc và cuộc sống cá nhân của mình ở mức độ nào?']],
 COMMUNICATION_CULTURE:[['COMMUNICATION','Nhìn chung, bạn hài lòng với việc trao đổi thông tin phục vụ công việc trong công ty ở mức độ nào?']],
 JOB_FIT:[['WORK','Nhìn chung, bạn hài lòng với công việc mình đang đảm nhận ở mức độ nào?']]
};
const templates=category=>(texts[category.name]||[]).map(([code,questionText])=>({templateCode:`ERIS_${code}_V1`,questionText,categoryId:category.id}));
module.exports={templates};
