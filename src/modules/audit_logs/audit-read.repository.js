const columns = `a.id, a.user_id AS "userId", a.entity_type AS "entityType",
  a.entity_id AS "entityId", a.action, a.created_at AS "createdAt",
  CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',u.id,'email',u.email,'fullName',u.full_name) END AS actor`;

class AuditReadRepository {
  constructor(pool) { this.pool = pool; }
  async isActiveAdmin(userId) {
    const { rows } = await this.pool.query(`SELECT u.id FROM users u JOIN role r ON r.id=u.role_id
      WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='ADMIN' LIMIT 1`, [userId]);
    return Boolean(rows[0]);
  }
  async list() {
    const { rows } = await this.pool.query(`SELECT ${columns} FROM audit_logs a
      LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC, a.id DESC`);
    return rows;
  }
  async findById(id) {
    const { rows } = await this.pool.query(`SELECT ${columns}, a.old_value AS "oldValue", a.new_value AS "newValue"
      FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.id=$1 LIMIT 1`, [id]);
    return rows[0] || null;
  }
}
module.exports = { AuditReadRepository };
