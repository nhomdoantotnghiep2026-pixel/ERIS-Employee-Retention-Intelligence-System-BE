const DEFAULT_SURVEY_QUESTIONS = Object.freeze([
  {
    questionText: 'Tôi cảm thấy hài lòng với công việc hiện tại của mình.',
    dimensionCode: 'JS01',
    required: true,
    displayOrder: 1
  },
  {
    questionText: 'Công việc hiện tại phù hợp với năng lực và kỹ năng của tôi.',
    dimensionCode: 'JS02',
    required: true,
    displayOrder: 2
  },
  {
    questionText: 'Tôi cảm thấy công việc mình đang làm có ý nghĩa và giá trị.',
    dimensionCode: 'JS03',
    required: true,
    displayOrder: 3
  },
  {
    questionText: 'Tôi có cơ hội phát triển chuyên môn và nghề nghiệp trong công việc hiện tại.',
    dimensionCode: 'JS04',
    required: true,
    displayOrder: 4
  },
  {
    questionText: 'Tôi cảm thấy thoải mái với môi trường làm việc hiện tại.',
    dimensionCode: 'ES01',
    required: true,
    displayOrder: 5
  },
  {
    questionText: 'Tôi được cung cấp đầy đủ công cụ và điều kiện cần thiết để thực hiện công việc.',
    dimensionCode: 'ES02',
    required: true,
    displayOrder: 6
  },
  {
    questionText: 'Môi trường làm việc tại công ty tạo điều kiện thuận lợi để tôi hoàn thành nhiệm vụ.',
    dimensionCode: 'ES03',
    required: true,
    displayOrder: 7
  },
  {
    questionText: 'Tôi cảm thấy an toàn và được tôn trọng tại nơi làm việc.',
    dimensionCode: 'ES04',
    required: true,
    displayOrder: 8
  }
]);

module.exports = { DEFAULT_SURVEY_QUESTIONS };
