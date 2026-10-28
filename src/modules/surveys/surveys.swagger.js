const surveysPaths = {
  '/api/surveys': {
    get: {
      tags: ['Surveys'],
      summary: 'Lấy danh sách các đợt khảo sát (HR)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Danh sách toàn bộ survey, mới nhất trước; không phân trang.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer', example: 1 },
                        title: { type: 'string' },
                        description: { type: 'string', nullable: true },
                        startDate: { type: 'string', format: 'date-time', nullable: true },
                        endDate: { type: 'string', format: 'date-time', nullable: true },
                        status: { type: 'string', example: 'DRAFT' },
                        createdBy: { type: 'integer', nullable: true },
                        createdByName: { type: 'string', nullable: true },
                        questionCount: { type: 'integer', example: 10 },
                        responseCount: { type: 'integer', example: 42 }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' }
      }
    },
    post: {
      tags: ['Surveys'],
      summary: 'Tạo khảo sát (HR)',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string', maxLength: 255, example: 'Khảo sát mức độ gắn kết quý 4' },
                description: { type: 'string', nullable: true },
                startDate: { type: 'string', format: 'date-time', nullable: true },
                endDate: { type: 'string', format: 'date-time', nullable: true }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Tạo survey cùng 8 câu hỏi mặc định; status mặc định là DRAFT.' },
        400: { description: 'Dữ liệu đầu vào không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' }
      }
    }
  },
  '/api/surveys/available': {
    get: {
      tags: ['Surveys'],
      summary: 'Danh sach khao sat co the thuc hien',
      description: 'Chi ap dung cho tai khoan ACTIVE co employee profile ACTIVE va da lam viec it nhat 3 thang. Tra ve survey ACTIVE dang trong thoi gian thuc hien ma employee chua nop. Response nhap duoc tra ve voi trang thai IN_PROGRESS.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Danh sach survey kha dung cua employee dang dang nhap.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer', example: 3 },
                        title: { type: 'string' },
                        description: { type: 'string', nullable: true },
                        startDate: { type: 'string', format: 'date-time' },
                        endDate: { type: 'string', format: 'date-time' },
                        questionCount: { type: 'integer', example: 8 },
                        responseStatus: {
                          type: 'string',
                          enum: ['NOT_STARTED', 'IN_PROGRESS']
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        401: { description: 'Thieu hoac sai access token.' },
        403: { description: 'Tai khoan khong ACTIVE, chua co employee profile ACTIVE, hoac chua du 3 thang lam viec.' }
      }
    }
  },
  '/api/surveys/{id}/responses': {
    post: {
      tags: ['Surveys'],
      summary: 'Nop cau tra loi khao sat',
      description: 'Chi employee ACTIVE da lam viec it nhat 3 thang moi duoc nop. Moi cau hoi bat buoc can co score tu 1 den 4.',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['answers'],
              properties: {
                answers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['questionId', 'score'],
                    properties: {
                      questionId: { type: 'integer', minimum: 1, example: 11 },
                      score: { type: 'integer', minimum: 1, maximum: 4, example: 4 },
                      comment: { type: 'string', maxLength: 1000, nullable: true }
                    }
                  }
                }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Nop cau tra loi thanh cong.' },
        400: { description: 'Du lieu cau tra loi khong hop le hoac thieu cau hoi bat buoc.' },
        401: { description: 'Thieu hoac sai access token.' },
        403: { description: 'Tai khoan khong du dieu kien tham gia khao sat.' },
        404: { description: 'Khong tim thay survey.' },
        409: { description: 'Survey khong con mo, khong co cau hoi, hoac employee da nop.' }
      }
    }
  },
  '/api/surveys/{id}/my-response': {
    get: {
      tags: ['Surveys'],
      summary: 'Xem phan hoi cua toi cho khao sat',
      description: 'Chi tra ve response cua employee lien ket voi account ACTIVE dang dang nhap. Khong the xem response cua employee khac.',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: {
          description: 'Response cua employee, gom cac cau hoi va cau tra loi cua chinh ho.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      survey: { type: 'object' },
                      response: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          status: { type: 'string', enum: ['DRAFT', 'SUBMITTED'] },
                          submittedAt: { type: 'string', format: 'date-time', nullable: true }
                        }
                      },
                      answers: { type: 'array', items: { type: 'object' } }
                    }
                  }
                }
              }
            }
          }
        },
        400: { description: 'Survey ID khong hop le.' },
        401: { description: 'Thieu hoac sai access token.' },
        403: { description: 'Tai khoan ACTIVE chua lien ket employee profile.' },
        404: { description: 'Khong tim thay survey hoac employee chua co response cho survey.' }
      }
    }
  },
  '/api/surveys/{id}': {
    get: {
      tags: ['Surveys'],
      summary: 'Xem noi dung khao sat dang thuc hien',
      description: 'Chi employee ACTIVE da lam viec it nhat 3 thang. Survey phai ACTIVE, dang trong thoi gian mo va chua duoc employee nop.',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: {
          description: 'Thong tin survey va danh sach cau hoi theo thu tu hien thi.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      title: { type: 'string' },
                      description: { type: 'string', nullable: true },
                      startDate: { type: 'string', format: 'date-time' },
                      endDate: { type: 'string', format: 'date-time' },
                      questions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer' },
                            questionText: { type: 'string' },
                            dimensionCode: { type: 'string' },
                            required: { type: 'boolean' },
                            displayOrder: { type: 'integer' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        400: { description: 'Survey ID khong hop le.' },
        401: { description: 'Thieu hoac sai access token.' },
        403: { description: 'Tai khoan khong du dieu kien tham gia survey.' },
        404: { description: 'Khong tim thay survey.' },
        409: { description: 'Survey chua mo, da het han, khong co cau hoi hoac employee da nop survey.' }
      }
    }
  },
  '/api/surveys/{id}/publish': {
    post: {
      tags: ['Surveys'],
      summary: 'Publish khảo sát (HR)',
      description: 'Chuyển survey từ DRAFT sang ACTIVE. Không thêm, sửa hoặc xoá câu hỏi.',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: { description: 'Publish survey thành công.' },
        400: { description: 'ID không hợp lệ hoặc survey đã hết hạn.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy survey.' },
        409: { description: 'Survey không còn ở trạng thái DRAFT.' }
      }
    }
  },
  '/api/surveys/{id}/results': {
    get: {
      tags: ['Surveys'],
      summary: 'Xem kết quả tổng hợp khảo sát (HR)',
      description: 'Chỉ tính lượt đã gửi hoàn tất. Mỗi câu có thêm answers: [{score, comment}], giữ nguyên nhận xét null và trả [] nếu chưa có câu trả lời. Không trả tên, employeeId hoặc responseId của người trả lời.',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: { description: 'Kết quả theo từng câu hỏi, gồm averageScore, phân bố điểm 1–4 và answers chứa điểm, nhận xét từng câu trả lời.' },
        400: { description: 'ID không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy survey.' }
      }
    }
  }
};

surveysPaths['/api/surveys/{id}/responses'] = {
  ...surveysPaths['/api/surveys/{id}/responses'],
  get: {
    tags: ['Surveys'], summary: 'Xem nhân viên đã làm khảo sát và toàn bộ câu trả lời (HR)',
    description: 'Dùng khi HR mở chi tiết khảo sát. Một response chứa survey, responseCount và participants. Mỗi participant có responseId, submittedAt, employee (id, employeeCode, fullName) và answers. Chỉ lấy bài đã gửi hoàn tất, không lấy bản nháp. Giữ kết quả của nhân viên đã ngừng hoạt động. Không có người gửi trả participants: []. Câu hỏi không trả lời có score/comment null. Không cần gọi riêng API từng nhân viên.',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 2147483647 } }],
    responses: {
      200: { description: 'Danh sách nhân viên và bài trả lời theo thời điểm gửi mới nhất.',
        content: { 'application/json': { example: { data: {
          survey: { id: 4, title: 'Khảo sát quý', status: 'ACTIVE', description: 'Khảo sát nhân sự', startDate: '2026-10-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z' },
          responseCount: 1, participants: [{ responseId: 5, submittedAt: '2026-10-29T08:00:00Z',
            employee: { id: 12, employeeCode: 'EMP012', fullName: 'Nguyễn Văn A' },
            answers: [{ questionId: 49, questionText: 'Bạn hài lòng với công việc không?', dimensionCode: 'JS01', required: true, displayOrder: 1, score: 4, comment: 'Ổn đấy' }] }]
        } } } } },
      400: { description: 'ID khảo sát không hợp lệ.' }, 401: { description: 'Thiếu hoặc sai access token.' },
      403: { description: 'Chỉ HR có tài khoản ACTIVE được xem.' }, 404: { description: 'Không tìm thấy khảo sát.' }
    }
  }
};
module.exports = { surveysPaths };
