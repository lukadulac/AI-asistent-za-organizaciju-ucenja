import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/HttpError.js";
import { registerSchema } from "./auth.schemas.js";
import type { z } from "zod";
import { generateToken, hashToken } from "../utils/tokens.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { signAccessToken } from "../utils/jwt.js";

type RegisterInput = z.infer<typeof registerSchema>;
async function sendActivationEmail(
	connection: PoolConnection,
	userId: number,
	email: string,
	firstName: string,
) {
	const { token, tokenHash } = generateToken();
	await connection.execute(
		"INSERT INTO email_tokens (user_id, type, token_hash, expires_at) VALUES (?, 'activation', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR))",
		[userId, tokenHash],
	);
	const link = `${env.APP_URL}/api/v1/auth/activate?token=${token}`;
	await sendMail(
		email,
		"Aktivirajte nalog",
		`<p>Zdravo ${escapeHtml(firstName)},</p>
                 <p>Kliknite na link da aktivirate nalog:</p>
                 <p><a href="${link}">Aktiviraj nalog</a></p>
                 <p>Link važi 24 sata.</p>`,
	);
}

export async function registerUser(input: RegisterInput) {
	const passwordHash = await bcrypt.hash(input.password, 12);
	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();
		const [result] = await connection.execute<ResultSetHeader>(
			"INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)",
			[input.email, passwordHash, input.firstName, input.lastName],
		);
		await sendActivationEmail(connection, result.insertId, input.email, input.firstName);

		await connection.commit();
		return {
			id: result.insertId,
			email: input.email,
			firstName: input.firstName,
			lastName: input.lastName,
		};
	} catch (err) {
		await connection.rollback();
		if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
			throw new HttpError(
				409,
				"EMAIL_TAKEN",
				"Korisnik sa ovim emailom već postoji.",
			);
		}
		throw err;
	} finally {
		connection.release();
	}
}

export async function activateUser(token: string) {
	const tokenHash = hashToken(token);

	const [rows] = await pool.execute<RowDataPacket[]>(
		`SELECT id, user_id FROM email_tokens
                 WHERE token_hash = ? AND type = 'activation'
                   AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
		[tokenHash],
	);
	const row = rows[0];
	if (!row) {
		throw new HttpError(
			400,
			"INVALID_TOKEN",
			"Token je nevažeći ili je istekao.",
		);
	}
	await pool.execute(
		"UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?",
		[row.user_id],
	);
	await pool.execute(
		"UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?",
		[row.id],
	);
}
export async function resendActivation(email: string) {
        const [rows] = await pool.execute<RowDataPacket[]>(
                "SELECT id, first_name, email_verified_at FROM users WHERE email = ?",
                [email],
        );
        const user = rows[0];

        // Ne otkrivamo da li nalog postoji ili je već aktiviran
        if (!user || user.email_verified_at !== null) return;

        const connection = await pool.getConnection();
        try {
                await connection.beginTransaction();
                await connection.execute(
                        "UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND type = 'activation' AND used_at IS NULL",
                        [user.id],
                );
                await sendActivationEmail(connection, user.id, email, user.first_name);
                await connection.commit();
        } catch (err) {
                await connection.rollback();
                throw err;
        } finally {
                connection.release();
        }
}

export async function loginUser(email: string, password: string) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		"SELECT id, email, first_name, last_name, role, password_hash, email_verified_at FROM users WHERE email = ?",
		[email],
	);
	const user = rows[0];

	// Prvo lozinka, pa tek onda aktivacija: bez tačne lozinke ne otkrivamo stanje naloga
	const passwordMatch = user
		? await bcrypt.compare(password, user.password_hash)
		: false;
	if (!user || !passwordMatch) {
		throw new HttpError(
			401,
			"INVALID_CREDENTIALS",
			"Pogrešan email ili lozinka.",
		);
	}
	if (user.email_verified_at === null) {
		throw new HttpError(
			403,
			"EMAIL_NOT_VERIFIED",
			"Nalog nije aktiviran. Proverite mejl.",
		);
	}

	// U bazu ide samo heš, klijent dobija pravi token
	const { token, tokenHash } = generateToken();
	await pool.execute(
		"INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))",
		[user.id, tokenHash],
	);

	return {
		accessToken: signAccessToken(user.id, user.role),
		refreshToken: token,
		user: {
			id: user.id,
			email: user.email,
			firstName: user.first_name,
			lastName: user.last_name,
			role: user.role,
		},
	};
}