const nodemailer = require('nodemailer');
const { env } = require('./env');

const mailTransporter = nodemailer.createTransport({
  host: env.mail.host,
  port: env.mail.port,
  secure: env.mail.secure,
  auth: {
    user: env.mail.user,
    pass: env.mail.password
  }
});

module.exports = { mailTransporter };
