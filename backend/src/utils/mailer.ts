import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transporter = nodemailer.createTransport({
	host: env.SMTP_HOST,
	port: env.SMTP_PORT,
	secure: false, // Mailpit ne koristi TLS
});

export async function sendMail(to: string, subject: string, html: string) {
	await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html });
}
