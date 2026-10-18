class AuthService {
  constructor({ authRepository, mailService, redisClient }) {
    this.authRepository = authRepository;
    this.mailService = mailService;
    this.redisClient = redisClient;
  }
}

module.exports = { AuthService };
