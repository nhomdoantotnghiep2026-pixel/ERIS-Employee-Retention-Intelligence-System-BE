const departmentSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer', example: 1 },
    code: { type: 'string', example: 'DP001' },
    name: { type: 'string', example: 'Human Resources' },
    description: { type: 'string', nullable: true, example: 'Manages people operations.' },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

const departmentIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Department ID.',
  schema: { type: 'integer', minimum: 1 },
  example: 1
};

const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' }
    }
  }
});

const departmentResponse = (message) => ({
  type: 'object',
  required: ['message', 'data'],
  properties: {
    message: { type: 'string', example: message },
    data: departmentSchema
  }
});

const departmentsPaths = {
  '/api/departments': {
    get: {
      tags: ['Departments'],
      operationId: 'listDepartments',
      summary: 'List departments',
      description: 'Returns all departments. HR role required.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Departments retrieved successfully.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'array', items: departmentSchema }
                }
              }
            }
          }
        },
        401: errorResponse('Authentication is required.'),
        403: errorResponse('Only HR users can manage departments.')
      }
    },
    post: {
      tags: ['Departments'],
      operationId: 'createDepartment',
      summary: 'Create a department',
      description: 'Creates a department and assigns its code automatically. HR role required.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        description: 'Department details.',
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 150, example: 'Information Technology' },
                description: { type: 'string', nullable: true, example: 'Owns systems and technology infrastructure.' }
              }
            }
          }
        }
      },
      responses: {
        201: {
          description: 'Department created successfully.',
          content: {
            'application/json': {
              schema: departmentResponse('Department created successfully.')
            }
          }
        },
        400: errorResponse('Invalid request body.'),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('Only HR users can manage departments.')
      }
    }
  },
  '/api/departments/{id}': {
    delete: {
      tags: ['Departments'],
      operationId: 'deactivateDepartment',
      summary: 'Deactivate a department',
      description: 'Changes the department status to `INACTIVE`. Departments with active employees cannot be deactivated. HR role required.',
      security: [{ bearerAuth: [] }],
      parameters: [departmentIdParameter],
      responses: {
        200: {
          description: 'Department deactivated successfully.',
          content: {
            'application/json': {
              schema: departmentResponse('Department deactivated successfully.')
            }
          }
        },
        400: errorResponse('Invalid department ID.'),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('Only HR users can manage departments.'),
        404: errorResponse('Department not found.'),
        409: errorResponse('Department is already inactive or still has active employees.')
      }
    },
    patch: {
      tags: ['Departments'],
      operationId: 'updateDepartment',
      summary: 'Update a department',
      description: 'Updates the department name and/or description. HR role required.',
      security: [{ bearerAuth: [] }],
      parameters: [departmentIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              minProperties: 1,
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 150, example: 'Information Technology' },
                description: { type: 'string', nullable: true, example: 'Owns systems and technology infrastructure.' }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Department updated successfully.',
          content: {
            'application/json': {
              schema: departmentResponse('Department updated successfully.')
            }
          }
        },
        400: errorResponse('Invalid department ID or request body.'),
        401: errorResponse('Authentication is required.'),
        403: errorResponse('Only HR users can manage departments.'),
        404: errorResponse('Department not found.')
      }
    }
  }
};

module.exports = { departmentsPaths };
