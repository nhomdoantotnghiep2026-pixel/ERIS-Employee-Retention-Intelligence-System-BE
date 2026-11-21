// ERIS-authored content; not a validated psychometric scale or translation.
const {ratingConfig}=require('./surveys.dynamic.validation');
const catalog={
  "COMPENSATION_BENEFITS": {
    "satisfaction": [
      "Bạn hài lòng với mức lương hiện tại ở mức độ nào?",
      "Mức độ hài lòng của bạn với các chế độ phúc lợi đang được hưởng như thế nào?",
      "Bạn đánh giá mức độ hài lòng với cách công ty ghi nhận đóng góp thông qua đãi ngộ như thế nào?",
      "Về sự minh bạch của chính sách đãi ngộ, bạn cảm thấy hài lòng ở mức nào?"
    ],
    "bank": [
      "Bạn muốn công ty làm rõ thông tin nào trong chính sách lương?",
      "Phúc lợi nào đang hỗ trợ tốt nhất nhu cầu của bạn?",
      "Phúc lợi nào bạn mong muốn được bổ sung hoặc điều chỉnh?",
      "Bạn thấy điểm nào chưa phù hợp giữa đãi ngộ và trách nhiệm công việc?",
      "Bạn muốn công ty ghi nhận đóng góp của mình bằng hình thức nào?",
      "Nếu chỉ cải thiện một vấn đề về đãi ngộ, bạn ưu tiên điều gì?",
      "Trong 4 tuần qua, bạn gặp khó khăn khi tra cứu thông tin về lương và phúc lợi với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để hiểu và sử dụng tốt hơn các chính sách đãi ngộ?",
      "Bạn có thể mô tả một tình huống khiến cách tính hoặc chi trả thu nhập chưa rõ ràng với mình không?",
      "Sau khi công ty điều chỉnh chính sách đãi ngộ, thông tin nào bạn muốn được cập nhật để biết nhu cầu của mình đã được xem xét?"
    ]
  },
  "WORKING_TIME": {
    "satisfaction": [
      "Bạn hài lòng với lịch làm việc hiện tại ở mức độ nào?",
      "Về khả năng chủ động sắp xếp thời gian làm việc, bạn cảm thấy hài lòng ở mức nào?",
      "Mức độ hài lòng của bạn với thời gian nghỉ giữa ca làm việc như thế nào?",
      "Bạn đánh giá mức độ hài lòng với cách công ty sắp xếp thời gian làm thêm như thế nào?"
    ],
    "bank": [
      "Thời điểm nào trong lịch làm việc gây khó khăn cho bạn?",
      "Những yếu tố nào thường khiến công việc kéo dài ngoài giờ?",
      "Bạn mong muốn thay đổi gì trong cách bố trí ca làm?",
      "Bạn cần được báo trước lịch làm hoặc thay đổi lịch bao lâu?",
      "Bạn có đề xuất gì để giảm thời gian làm thêm không cần thiết?",
      "Hình thức linh hoạt về thời gian nào sẽ giúp bạn làm việc tốt hơn?",
      "Trong 4 tuần qua, lịch làm việc thay đổi ngoài dự kiến ảnh hưởng đến việc sắp xếp của bạn với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để chủ động sắp xếp thời gian làm việc hơn?",
      "Có công đoạn bàn giao hoặc cuộc họp nào thường làm kéo dài thời gian làm việc mà bạn muốn điều chỉnh không?",
      "Nếu thử một cách sắp xếp lịch làm mới, dấu hiệu nào sẽ giúp bạn nhận thấy cách đó phù hợp hơn?"
    ]
  },
  "WORK_ENVIRONMENT": {
    "satisfaction": [
      "Bạn hài lòng với điều kiện vật chất tại nơi làm việc ở mức độ nào?",
      "Với các công cụ được cung cấp để làm việc, bạn cảm thấy hài lòng ở mức nào?",
      "Mức độ hài lòng của bạn với sự an toàn tại nơi làm việc như thế nào?",
      "Bạn đánh giá mức độ hài lòng với sự hỗ trợ từ đồng nghiệp trong công việc như thế nào?"
    ],
    "bank": [
      "Công cụ hoặc thiết bị nào đang cản trở công việc của bạn?",
      "Bạn muốn cải thiện điều gì trong không gian làm việc?",
      "Bạn có quan ngại nào về an toàn cần công ty xử lý?",
      "Việc phối hợp với đồng nghiệp đang gặp trở ngại gì?",
      "Nguồn lực nào bạn cần để thực hiện công việc hiệu quả hơn?",
      "Nếu chọn một cải thiện về môi trường làm việc, bạn sẽ chọn gì?",
      "Trong 4 tuần qua, sự cố về công cụ hoặc điều kiện làm việc làm gián đoạn công việc của bạn với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để cải thiện điều kiện thực hiện công việc?",
      "Bạn có thể mô tả một tình huống phối hợp tốt giữa đồng nghiệp mà công ty nên duy trì không?",
      "Sau khi phản ánh một vấn đề về môi trường làm việc, bạn mong muốn nhận thông tin xử lý như thế nào?"
    ]
  },
  "CAREER_DEVELOPMENT": {
    "satisfaction": [
      "Bạn hài lòng với cơ hội học tập chuyên môn tại công ty ở mức độ nào?",
      "Mức độ hài lòng của bạn với cơ hội phát triển nghề nghiệp tại công ty như thế nào?",
      "Về sự hỗ trợ để đạt mục tiêu nghề nghiệp, bạn cảm thấy hài lòng ở mức nào?",
      "Bạn đánh giá mức độ hài lòng với sự rõ ràng của lộ trình phát triển nghề nghiệp như thế nào?"
    ],
    "bank": [
      "Bạn muốn phát triển theo hướng nghề nghiệp nào trong thời gian tới?",
      "Kỹ năng nào bạn muốn được đào tạo thêm?",
      "Bạn cần công ty hỗ trợ gì để đạt mục tiêu nghề nghiệp?",
      "Điều gì đang cản trở sự phát triển nghề nghiệp của bạn?",
      "Bạn muốn được trải nghiệm nhiệm vụ hoặc vai trò nào?",
      "Bạn mong muốn được trao đổi về lộ trình nghề nghiệp như thế nào?",
      "Trong 4 tuần qua, việc thiếu hướng dẫn về phát triển nghề nghiệp khiến bạn khó xác định bước tiếp theo với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để thực hiện mục tiêu phát triển nghề nghiệp?",
      "Bạn mong muốn đạt được kết quả phát triển cụ thể nào trong 6 đến 12 tháng tới?",
      "Sau một hoạt động đào tạo, bạn muốn có cơ hội áp dụng kỹ năng mới vào nhiệm vụ nào?"
    ]
  },
  "MANAGEMENT": {
    "satisfaction": [
      "Bạn hài lòng với sự hỗ trợ của quản lý trực tiếp ở mức độ nào?",
      "Bạn đánh giá mức độ hài lòng với những phản hồi về công việc từ quản lý như thế nào?",
      "Về cách quản lý phân công công việc, bạn cảm thấy hài lòng ở mức nào?",
      "Mức độ hài lòng của bạn với sự công bằng trong cách quản lý đối xử với nhân viên như thế nào?"
    ],
    "bank": [
      "Bạn cần quản lý hỗ trợ thêm ở những tình huống nào?",
      "Bạn mong muốn nhận phản hồi về công việc theo cách nào?",
      "Nhiệm vụ nào cần được làm rõ về mục tiêu hoặc ưu tiên?",
      "Bạn có đề xuất gì để việc phân công công việc phù hợp hơn?",
      "Điều gì giúp bạn trao đổi thẳng thắn hơn với quản lý?",
      "Bạn mong muốn quản lý thay đổi một điều gì để hỗ trợ nhóm tốt hơn?",
      "Trong 4 tuần qua, bạn gặp khó khăn vì chưa được làm rõ ưu tiên công việc với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào từ quản lý trực tiếp trong thời gian tới?",
      "Bạn có thể chia sẻ một cách phản hồi từ quản lý đã giúp mình cải thiện công việc không?",
      "Khi có bất đồng về cách thực hiện nhiệm vụ, bạn mong muốn trao đổi và đi đến thống nhất với quản lý như thế nào?"
    ]
  },
  "EMPLOYEE_ENGAGEMENT": {
    "satisfaction": [
      "Bạn hài lòng với trải nghiệm làm việc tại công ty ở mức độ nào?",
      "Về sự ghi nhận dành cho đóng góp của mình, bạn cảm thấy hài lòng ở mức nào?",
      "Mức độ hài lòng của bạn với cơ hội tham gia đóng góp vào các hoạt động của công ty như thế nào?",
      "Bạn đánh giá mức độ hài lòng với sự kết nối của mình với tập thể tại công ty như thế nào?"
    ],
    "bank": [
      "Điều gì khiến bạn muốn tiếp tục làm việc tại công ty?",
      "Điều gì đang làm giảm động lực làm việc của bạn?",
      "Bạn muốn đóng góp thêm vào hoạt động nào của công ty?",
      "Bạn mong muốn được ghi nhận đóng góp bằng cách nào?",
      "Điều gì sẽ giúp bạn cảm thấy kết nối hơn với tập thể?",
      "Bạn muốn công ty ưu tiên cải thiện điều gì để hỗ trợ sự gắn bó?",
      "Trong 4 tuần qua, bạn cảm thấy khó duy trì động lực làm việc với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để cảm thấy được kết nối và có đóng góp hơn tại công ty?",
      "Bạn có thể chia sẻ một trải nghiệm gần đây khiến mình cảm thấy đóng góp được trân trọng không?",
      "Trong 3 tháng tới, thay đổi cụ thể nào sẽ giúp bạn mong muốn tiếp tục đóng góp cho công ty hơn?"
    ]
  },
  "WORK_LIFE_BALANCE": {
    "satisfaction": [
      "Bạn hài lòng với sự cân bằng giữa công việc và cuộc sống cá nhân ở mức độ nào?",
      "Về khả năng nghỉ ngơi sau giờ làm việc, bạn cảm thấy hài lòng ở mức nào?",
      "Mức độ hài lòng của bạn với khả năng sắp xếp việc cá nhân bên cạnh công việc như thế nào?",
      "Bạn đánh giá mức độ hài lòng với sự hỗ trợ của công ty khi cần cân bằng công việc và cuộc sống như thế nào?"
    ],
    "bank": [
      "Yếu tố công việc nào thường ảnh hưởng đến thời gian cá nhân của bạn?",
      "Bạn gặp khó khăn gì khi cần nghỉ ngơi sau giờ làm?",
      "Hình thức hỗ trợ nào sẽ giúp bạn cân bằng công việc và cuộc sống?",
      "Bạn muốn thay đổi điều gì về việc liên hệ công việc ngoài giờ?",
      "Bạn cần trao đổi gì về việc sắp xếp nhiệm vụ trong giai đoạn cao điểm?",
      "Bạn có đề xuất gì để duy trì sức khỏe và thời gian phục hồi?",
      "Trong 4 tuần qua, yêu cầu công việc làm gián đoạn thời gian nghỉ hoặc kế hoạch cá nhân của bạn với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để cân bằng công việc và cuộc sống cá nhân?",
      "Bạn muốn thống nhất nguyên tắc nào với nhóm về việc liên hệ ngoài giờ làm việc?",
      "Nếu công ty thử một biện pháp hỗ trợ cân bằng công việc và cuộc sống, bạn muốn đánh giá hiệu quả của biện pháp đó qua điều gì?"
    ]
  },
  "COMMUNICATION_CULTURE": {
    "satisfaction": [
      "Bạn hài lòng với việc được cung cấp thông tin cần thiết cho công việc ở mức độ nào?",
      "Mức độ hài lòng của bạn với sự rõ ràng của thông tin được trao đổi trong công ty như thế nào?",
      "Về cơ hội nêu ý kiến tại công ty, bạn cảm thấy hài lòng ở mức nào?",
      "Bạn đánh giá mức độ hài lòng với sự tôn trọng trong giao tiếp tại công ty như thế nào?"
    ],
    "bank": [
      "Thông tin nào bạn thường nhận được chậm hoặc chưa đầy đủ?",
      "Kênh trao đổi nào đang gây khó khăn cho công việc?",
      "Bạn muốn được thông báo về thay đổi của công ty theo cách nào?",
      "Điều gì khiến bạn chưa thoải mái khi nêu ý kiến?",
      "Bạn đề xuất điều gì để phối hợp giữa các phòng ban tốt hơn?",
      "Bạn muốn công ty duy trì hoặc cải thiện điều gì trong văn hóa giao tiếp?",
      "Trong 4 tuần qua, bạn phải làm lại công việc vì thông tin chưa rõ hoặc chưa được cập nhật với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để việc trao đổi thông tin trong công ty hiệu quả hơn?",
      "Bạn có thể mô tả một tình huống mà việc trao đổi thông tin giữa các nhóm đã giúp xử lý công việc tốt hơn không?",
      "Sau khi gửi ý kiến hoặc đề xuất, bạn mong muốn công ty phản hồi theo cách nào?"
    ]
  },
  "JOB_FIT": {
    "satisfaction": [
      "Bạn hài lòng với nội dung công việc đang đảm nhận ở mức độ nào?",
      "Mức độ hài lòng của bạn với cơ hội sử dụng kỹ năng trong công việc hiện tại như thế nào?",
      "Về sự phù hợp giữa nhiệm vụ và thế mạnh của bản thân, bạn cảm thấy hài lòng ở mức nào?",
      "Bạn đánh giá mức độ hài lòng với sự rõ ràng của vai trò công việc hiện tại như thế nào?"
    ],
    "bank": [
      "Những nhiệm vụ nào phù hợp nhất với thế mạnh của bạn?",
      "Những nhiệm vụ nào bạn thấy chưa phù hợp với kỹ năng hiện tại?",
      "Bạn muốn sử dụng kỹ năng nào nhiều hơn trong công việc?",
      "Bạn muốn điều chỉnh nhiệm vụ nào trong vai trò hiện tại?",
      "Bạn cần nguồn lực hoặc hướng dẫn gì để thực hiện vai trò tốt hơn?",
      "Bạn muốn được tham gia loại công việc nào để phát huy sở thích chuyên môn?",
      "Trong 4 tuần qua, bạn gặp khó khăn vì nhiệm vụ chưa phù hợp với kỹ năng hiện có với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào để thực hiện vai trò hiện tại phù hợp hơn với năng lực của mình?",
      "Bạn muốn dành thêm hoặc bớt thời gian cho loại nhiệm vụ nào, và vì sao?",
      "Nếu được điều chỉnh một phần vai trò hiện tại, bạn mong muốn kết quả công việc và trải nghiệm của mình thay đổi như thế nào?"
    ]
  },
  "OTHER": {
    "satisfaction": [
      "Với các nội dung trong chủ đề này, bạn hài lòng với trải nghiệm thực tế của mình ở mức nào?",
      "Bạn đánh giá mức độ hài lòng với cách công ty xử lý các vấn đề thuộc chủ đề này như thế nào?",
      "Mức độ hài lòng của bạn với sự hỗ trợ của công ty đối với các nội dung trong chủ đề này như thế nào?",
      "Về cách công ty đáp ứng các nhu cầu được đề cập trong chủ đề này, bạn cảm thấy hài lòng ở mức nào?"
    ],
    "bank": [
      "Bạn muốn chia sẻ thêm vấn đề nào chưa được các chủ đề khác đề cập?",
      "Vấn đề đó đang ảnh hưởng thế nào đến trải nghiệm làm việc của bạn?",
      "Bạn mong muốn công ty hỗ trợ hoặc thay đổi điều gì đối với vấn đề đó?",
      "Bạn đã nhận được sự hỗ trợ nào liên quan đến vấn đề đó?",
      "Theo bạn, công ty nên ưu tiên xử lý nội dung nào trước?",
      "Bạn có đề xuất cụ thể nào để cải thiện trải nghiệm liên quan đến nội dung này?",
      "Trong 4 tuần qua, các vấn đề bạn muốn nêu ở nhóm Khác ảnh hưởng đến trải nghiệm làm việc với tần suất như thế nào?",
      "Bạn ưu tiên hình thức hỗ trợ nào đối với các nội dung mình nêu trong nhóm Khác?",
      "Bạn có thể mô tả một tình huống cụ thể để công ty hiểu rõ hơn nội dung mình muốn phản ánh không?",
      "Sau khi nội dung này được xem xét, bạn mong muốn nhận được phản hồi hoặc theo dõi kết quả như thế nào?"
    ]
  }
};
// Keep measurement facets, template codes and the satisfaction scale stable; author each prompt directly.
function templates(category){return (catalog[category.name]?.satisfaction||[]).map((questionText,i)=>({templateCode:`ERIS_${category.name}_${i+1}_V2`,questionText,categoryId:category.id,questionType:'RATING',answerConfig:ratingConfig()}));}
const diagnosticOptions={"COMPENSATION_BENEFITS": ["Lương cơ bản", "Thưởng", "Phụ cấp", "Bảo hiểm và phúc lợi", "Thông tin chính sách"], "WORKING_TIME": ["Lịch làm việc", "Thay đổi ca", "Làm thêm giờ", "Thời gian nghỉ", "Tính linh hoạt"], "WORK_ENVIRONMENT": ["Thiết bị và công cụ", "Không gian làm việc", "An toàn", "Quan hệ đồng nghiệp", "Nguồn lực hỗ trợ"], "CAREER_DEVELOPMENT": ["Đào tạo chuyên môn", "Người hướng dẫn", "Lộ trình nghề nghiệp", "Cơ hội thử vai trò mới", "Tiêu chí thăng tiến"], "MANAGEMENT": ["Phân công nhiệm vụ", "Phản hồi công việc", "Sự hỗ trợ", "Tính công bằng", "Trao đổi với quản lý"], "EMPLOYEE_ENGAGEMENT": ["Sự ghi nhận", "Động lực làm việc", "Kết nối tập thể", "Cơ hội đóng góp ý kiến", "Ý nghĩa công việc"], "WORK_LIFE_BALANCE": ["Liên hệ ngoài giờ", "Thời gian phục hồi", "Lịch làm linh hoạt", "Khối lượng việc", "Hỗ trợ việc cá nhân"], "COMMUNICATION_CULTURE": ["Thông tin kịp thời", "Thông tin rõ ràng", "Kênh giao tiếp", "Cơ hội nêu ý kiến", "Phối hợp phòng ban"], "JOB_FIT": ["Nội dung nhiệm vụ", "Kỹ năng được sử dụng", "Thế mạnh cá nhân", "Sự rõ ràng của vai trò", "Nguồn lực thực hiện"], "OTHER": ["Điều kiện hỗ trợ", "Cách xử lý vấn đề", "Thông tin và hướng dẫn", "Khả năng nêu ý kiến", "Nội dung khác"]};
const supportOptions={
  "COMPENSATION_BENEFITS": [
    "Hướng dẫn cách tính thu nhập",
    "Giải thích quyền lợi phúc lợi",
    "Trao đổi riêng về đãi ngộ",
    "Hướng dẫn thủ tục hưởng quyền lợi",
    "Nội dung khác"
  ],
  "WORKING_TIME": [
    "Thông báo lịch sớm hơn",
    "Quy trình đổi ca rõ ràng",
    "Làm rõ giới hạn làm thêm",
    "Sắp xếp lại việc bàn giao",
    "Nội dung khác"
  ],
  "WORK_ENVIRONMENT": [
    "Bổ sung thiết bị hoặc công cụ",
    "Hướng dẫn sử dụng công cụ",
    "Cải thiện không gian làm việc",
    "Đầu mối xử lý sự cố rõ ràng",
    "Nội dung khác"
  ],
  "CAREER_DEVELOPMENT": [
    "Đào tạo chuyên môn",
    "Mentor hoặc người hướng dẫn",
    "Trao đổi lộ trình nghề nghiệp",
    "Nhiệm vụ thực hành kỹ năng mới",
    "Nội dung khác"
  ],
  "MANAGEMENT": [
    "Trao đổi riêng định kỳ",
    "Phản hồi công việc cụ thể",
    "Làm rõ mục tiêu và ưu tiên",
    "Hỗ trợ giải quyết trở ngại",
    "Nội dung khác"
  ],
  "EMPLOYEE_ENGAGEMENT": [
    "Ghi nhận đóng góp cụ thể",
    "Tham gia hoạt động tập thể",
    "Cơ hội đóng góp ý kiến",
    "Làm rõ ý nghĩa và tác động công việc",
    "Nội dung khác"
  ],
  "WORK_LIFE_BALANCE": [
    "Linh hoạt về lịch làm",
    "Làm rõ nguyên tắc liên hệ ngoài giờ",
    "Rà soát lại khối lượng việc",
    "Trao đổi riêng về nhu cầu hỗ trợ",
    "Nội dung khác"
  ],
  "COMMUNICATION_CULTURE": [
    "Kênh thông tin thống nhất",
    "Thông báo thay đổi kịp thời",
    "Làm rõ đầu mối phối hợp",
    "Theo dõi phản hồi sau khi góp ý",
    "Nội dung khác"
  ],
  "JOB_FIT": [
    "Hướng dẫn nhiệm vụ",
    "Đào tạo kỹ năng còn thiếu",
    "Điều chỉnh phân bổ nhiệm vụ",
    "Trao đổi lại phạm vi vai trò",
    "Nội dung khác"
  ],
  "OTHER": [
    "Trao đổi riêng với HR",
    "Làm rõ thông tin liên quan",
    "Kết nối người phụ trách xử lý",
    "Theo dõi và phản hồi kết quả",
    "Nội dung khác"
  ]
};
const frequencyLabels=['Không lần nào','Hiếm khi','Thỉnh thoảng','Thường xuyên','Chưa đủ trải nghiệm để đánh giá'];
function bank(category){return (catalog[category.name]?.bank||[]).map((questionText,i)=>{
 const q={bankCode:`ERIS_BANK_${category.name}_${i+1}_V1`,questionText,categoryId:category.id,questionType:'TEXT',answerConfig:null};
 if(i===0)return {...q,questionText:'Trong chủ đề này, những nội dung nào bạn muốn công ty ưu tiên tìm hiểu hoặc cải thiện?',questionType:'MULTIPLE_CHOICE',answerConfig:{options:diagnosticOptions[category.name].map((label,n)=>({code:'TOPIC_'+(n+1),label}))}};
 if(i===6)return {...q,questionType:'SINGLE_CHOICE',answerConfig:{options:frequencyLabels.map((label,n)=>({code:'FREQ_'+(n+1),label}))}};
 if(i===7)return {...q,questionType:'MULTIPLE_CHOICE',answerConfig:{options:supportOptions[category.name].map((label,n)=>({code:'SUPPORT_'+(n+1),label}))}};
 return q;
});}

module.exports={templates,bank};
