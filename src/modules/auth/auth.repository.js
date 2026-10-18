class AuthRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }
}

module.exports = { AuthRepository };
