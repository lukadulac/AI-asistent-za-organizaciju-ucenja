import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Connection, PoolConnection } from "mysql2/promise";
import { pool, inTransaction } from "../db/pool.js";
import { HttpError } from "../utils/HttpError.js";
import { registerSchema } from "./auth.schemas.js";
import type { z } from "zod";
import { generateToken, hashToken } from "../utils/tokens.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { signAccessToken, type UserRole } from "../utils/jwt.js";

type RegisterInput = z.infer<typeof registerSchema>;

const BCRYPT_ROUNDS = 12;

function invalidTokenError() {
	return new HttpError(400, "INVALID_TOKEN", "Token je nevažeći ili je istekao.");
}

function unauthorizedError() {
	return new HttpError(401, "UNAUTHORIZED", "Niste prijavljeni.");
}

// Red iz tabele users -> oblik koji vraćaju /login i /me
function toPublicUser(row: RowDataPacket) {
	return {
		id: row.id as number,
		email: row.email as string,
		firstName: row.first_name as string,
		lastName: row.last_name as string,
		role: row.role as UserRole,
	};
}

// Pravi refresh token u bazi (samo heš) i potpisuje access token. Koriste ga login i refresh.
async function issueSession(
	db: Connection,
	userId: number,
	role: UserRole,
	deviceInfo: string | null,
) {
	const { token, tokenHash } = generateToken();
	await db.execute(
		"INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))",
		[userId, tokenHash, deviceInfo],
	);
	return { accessToken: signAccessToken(userId, role), refreshToken: token };
}

type RevokeReason = "rotated" | "logout" | "password_change" | "reuse_detected";

// Posle promene/reseta lozinke (ili otkrivene krađe) svi uređaji moraju ponovo da se prijave
async function revokeAllRefreshTokens(
	db: Connection,
	userId: number,
	reason: RevokeReason,
) {
	await db.execute(
		"UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL",
		[reason, userId],
	);
}

function invalidRefreshTokenError() {
	return new HttpError(
		401,
		"INVALID_REFRESH_TOKEN",
		"Sesija nije važeća. Prijavite se ponovo.",
	);
}

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
	const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

	try {
		return await inTransaction(async (connection) => {
			const [result] = await connection.execute<ResultSetHeader>(
				"INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)",
				[input.email, passwordHash, input.firstName, input.lastName],
			);
			await sendActivationEmail(connection, result.insertId, input.email, input.firstName);
			return {
				id: result.insertId,
				email: input.email,
				firstName: input.firstName,
				lastName: input.lastName,
			};
		});
	} catch (err) {
		if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
			throw new HttpError(
				409,
				"EMAIL_TAKEN",
				"Korisnik sa ovim emailom već postoji.",
			);
		}
		throw err;
	}
}

export async function activateUser(token: string) {
	const tokenHash = hashToken(token);

	await inTransaction(async (connection) => {
		// FOR UPDATE: dva istovremena klika na link ne mogu oba da prođu
		const [rows] = await connection.execute<RowDataPacket[]>(
			`SELECT id, user_id FROM email_tokens
                 WHERE token_hash = ? AND type = 'activation'
                   AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
                 FOR UPDATE`,
			[tokenHash],
		);
		const row = rows[0];
		if (!row) throw invalidTokenError();

		await connection.execute(
			"UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?",
			[row.user_id],
		);
		await connection.execute(
			"UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?",
			[row.id],
		);
	});
}

export async function resendActivation(email: string) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		"SELECT id, first_name, email_verified_at FROM users WHERE email = ?",
		[email],
	);
	const user = rows[0];

	// Ne otkrivamo da li nalog postoji ili je već aktiviran
	if (!user || user.email_verified_at !== null) return;

	await inTransaction(async (connection) => {
		await connection.execute(
			"UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND type = 'activation' AND used_at IS NULL",
			[user.id],
		);
		await sendActivationEmail(connection, user.id, email, user.first_name);
	});
}

export async function loginUser(
	email: string,
	password: string,
	deviceInfo: string | null,
) {
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

	const tokens = await issueSession(pool, user.id, user.role, deviceInfo);

	return { ...tokens, user: toPublicUser(user) };
}

// Rotacija: stari refresh token se opoziva, klijent dobija nov par tokena
export async function refreshSession(refreshToken: string, deviceInfo: string | null) {
	const tokenHash = hashToken(refreshToken);

	// Opoziv lanca mora da se commit-uje, pa grešku bacamo tek posle transakcije
	const result = await inTransaction(async (connection) => {
		// JOIN proverava i da korisnik još postoji; FOR UPDATE sprečava da dva
		// istovremena zahteva sa istim tokenom oba dobiju nov token
		const [rows] = await connection.execute<RowDataPacket[]>(
			`SELECT rt.id, rt.revoked_at, rt.revoke_reason,
                        rt.expires_at > UTC_TIMESTAMP() AS not_expired,
                        u.id AS user_id, u.role
                 FROM refresh_tokens rt
                 JOIN users u ON u.id = rt.user_id
                 WHERE rt.token_hash = ?
                 FOR UPDATE`,
			[tokenHash],
		);
		const row = rows[0];
		if (!row) return null;

		// Već rotiran token je ponovo stigao: neko ga je ukrao (ili ga je klijent
		// pogrešno sačuvao). Ne znamo ko je pravi vlasnik, pa odjavljujemo sve uređaje.
		if (row.revoke_reason === "rotated") {
			await revokeAllRefreshTokens(connection, row.user_id, "reuse_detected");
			return null;
		}
		if (row.revoked_at !== null || !row.not_expired) return null;

		await connection.execute(
			"UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoke_reason = 'rotated' WHERE id = ?",
			[row.id],
		);
		return issueSession(connection, row.user_id, row.role, deviceInfo);
	});

	if (!result) throw invalidRefreshTokenError();
	return result;
}

export async function logout(refreshToken: string) {
	await pool.execute(
		"UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoke_reason = 'logout' WHERE token_hash = ? AND revoked_at IS NULL",
		[hashToken(refreshToken)],
	);
}

// Čita iz baze, ne iz JWT-a: korisnik je možda obrisan ili mu je promenjena uloga
export async function getCurrentUser(userId: number) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		"SELECT id, email, first_name, last_name, role FROM users WHERE id = ?",
		[userId],
	);
	const user = rows[0];
	if (!user) throw unauthorizedError();
	return toPublicUser(user);
}

export async function requestPasswordReset(email: string) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		"SELECT id, first_name FROM users WHERE email = ?",
		[email],
	);
	const user = rows[0];

	// Ne otkrivamo da li nalog postoji
	if (!user) return;

	const { token, tokenHash } = generateToken();
	await inTransaction(async (connection) => {
		// Važi samo poslednji poslati link
		await connection.execute(
			"UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND type = 'password_reset' AND used_at IS NULL",
			[user.id],
		);
		await connection.execute(
			"INSERT INTO email_tokens (user_id, type, token_hash, expires_at) VALUES (?, 'password_reset', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))",
			[user.id, tokenHash],
		);
	});

	// Mejl tek posle commit-a: link nikad ne vodi na token koji je rollback obrisao,
	// a transakcija ne drži lock dok čeka SMTP
	const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
	await sendMail(
		email,
		"Resetovanje lozinke",
		`<p>Zdravo ${escapeHtml(user.first_name)},</p>
                 <p>Kliknite na link da postavite novu lozinku:</p>
                 <p><a href="${link}">Postavi novu lozinku</a></p>
                 <p>Link važi 30 minuta. Ako niste tražili reset, ignorišite ovaj mejl.</p>`,
	);
}

export async function resetPassword(token: string, password: string) {
	const tokenHash = hashToken(token);

	await inTransaction(async (connection) => {
		const [rows] = await connection.execute<RowDataPacket[]>(
			`SELECT id, user_id FROM email_tokens
                 WHERE token_hash = ? AND type = 'password_reset'
                   AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
                 FOR UPDATE`,
			[tokenHash],
		);
		const row = rows[0];
		if (!row) throw invalidTokenError();

		// bcrypt je skup, pa tek kad znamo da je token pravi
		const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

		// Link iz mejla dokazuje vlasništvo nad adresom, pa aktivira i neaktiviran nalog
		await connection.execute(
			"UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?",
			[passwordHash, row.user_id],
		);
		await connection.execute(
			"UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?",
			[row.id],
		);
		await revokeAllRefreshTokens(connection, row.user_id, "password_change");
	});
}

// Opoziva sve refresh tokene, pa trenutnom uređaju vraća novu sesiju da ne bi bio odjavljen
export async function changePassword(
	userId: number,
	currentPassword: string,
	newPassword: string,
	deviceInfo: string | null,
) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		"SELECT password_hash, role FROM users WHERE id = ?",
		[userId],
	);
	const user = rows[0];
	if (!user) throw unauthorizedError();
	if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
		throw new HttpError(400, "WRONG_PASSWORD", "Trenutna lozinka nije tačna.");
	}

	const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
	return inTransaction(async (connection) => {
		await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
			passwordHash,
			userId,
		]);
		await revokeAllRefreshTokens(connection, userId, "password_change");
		return issueSession(connection, userId, user.role, deviceInfo);
	});
}
