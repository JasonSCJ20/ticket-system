import nodemailer from 'nodemailer';
import { CONFIG } from './config.js';

let transporter = null;

if (CONFIG.SMTP_HOST && CONFIG.SMTP_PORT) {
  transporter = nodemailer.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_SECURE,
    auth: CONFIG.SMTP_USER && CONFIG.SMTP_PASS
      ? { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS }
      : undefined,
  });
}

export async function sendEmailNotification(to, subject, text) {
  if (!transporter || !to) return;

  await transporter.sendMail({
    from: CONFIG.NOTIFY_FROM_EMAIL,
    to,
    subject,
    text,
  });
}
