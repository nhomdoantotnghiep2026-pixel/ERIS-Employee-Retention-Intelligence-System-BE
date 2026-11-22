const { AppError } = require('../../common/errors/app-error');
const { reconcile } = require('./services/attendance-sources.service');

function importOptions(req) {
  if (Object.keys(req.body || {}).some(key => key !== 'options')) throw new AppError(400, 'Only file and options are accepted.');
  if (!req.body?.options) return {};
  try { return JSON.parse(req.body.options); }
  catch { throw new AppError(400, 'options must be a JSON object.'); }
}

class AttendanceController {
  constructor(service) { this.service = service; }
  handle = action => async (req, res, next) => {
    try { res.json(await action(req)); } catch (error) { next(error); }
  };
  preview = this.handle(req => this.service.preview(req.attendanceUser, req.file, importOptions(req)));
  confirm = this.handle(req => this.service.confirm(req.attendanceUser, req.file, importOptions(req)));
  reconcilePreview = this.handle(req => reconcile(this.service, req.attendanceUser, req.body));
  reconcileConfirm = this.handle(req => reconcile(this.service, req.attendanceUser, req.body, true));
  summary = this.handle(req => this.service.list(req.attendanceUser, req.query, false, true));
  own = this.handle(req => this.service.list(req.attendanceUser, req.query, true));
  list = this.handle(req => this.service.list(req.attendanceUser, req.query));
  cancellations = this.handle(req => this.service.cancellations(req.attendanceUser, req.query));
  cancellation = this.handle(req => this.service.cancellations(req.attendanceUser, {}, req.params.id));
  logs = this.handle(req => this.service.logs(req.attendanceUser, req.params.id, req.query));
  cancel = this.handle(req => this.service.cancel(req.attendanceUser, req.params.id, req.body));
  detail = this.handle(req => this.service.detail(req.attendanceUser, req.params.id));
  errors = async (req, res, next) => {
    try {
      const buffer = await this.service.errors(req.attendanceUser, req.file, importOptions(req));
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment('attendance-errors.xlsx');
      res.send(Buffer.from(buffer));
    } catch (error) { next(error); }
  };
}

module.exports = { AttendanceController };
