const backgroundProperties = {
  educations: {
    type: 'array', minItems: 1, maxItems: 20,
    description: 'Bằng cấp ban đầu. Dùng cùng validation và xác minh trường từ ROR/Vietmap như API thêm bằng cấp.',
    items: {
      type: 'object', additionalProperties: false,
      required: ['educationLevel', 'institution', 'institutionRefId'],
      properties: {
        educationLevel: { type: 'integer', enum: [1, 2, 3, 4], example: 2 },
        fieldOfStudy: { type: 'string', maxLength: 150, nullable: true, example: 'Công nghệ thông tin' },
        institution: { type: 'string', maxLength: 150, description: 'Tên trường đúng như gợi ý đã chọn.' },
        institutionRefId: { type: 'string', maxLength: 528, description: 'ID lấy từ GET /api/employee-educations/institutions. Backend xác minh trước khi lưu.' },
        graduationYear: { type: 'integer', nullable: true, example: 2022, description: 'Từ năm sinh + 21 đến năm hiện tại.' }
      }
    }
  },
  workExperiences: {
    type: 'array', maxItems: 50,
    description: 'Kinh nghiệm trước đây; bắt buộc gửi [] nếu chưa có. Có thể lưu nhiều công ty.',
    items: {
      type: 'object', additionalProperties: false, required: ['companyName', 'positionTitle', 'startDate'],
      properties: {
        companyName: { type: 'string', maxLength: 150, example: 'Công ty ABC' },
        positionTitle: { type: 'string', maxLength: 150, example: 'Backend Developer' },
        startDate: { type: 'string', example: '2022-06', description: 'YYYY-MM-DD, YYYY-MM hoặc MM/YYYY. Thiếu ngày tự lấy 01; không ở tương lai hoặc trước/ngay ngày sinh.' },
        endDate: { type: 'string', nullable: true, example: '2025-08', description: 'Cùng định dạng startDate; không trước startDate, không ở tương lai. Có thể bỏ qua hoặc null nếu chưa kết thúc.' }
      }
    }
  }
};
module.exports = { backgroundProperties };
