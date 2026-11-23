// Zajednički alati za E2E testove.
// Testovi NE uvoze ništa iz src/: gađaju pokrenut server preko HTTP-a,
// tokene čitaju iz Mailpit-a, a bazu koriste samo za pripremu stanja (npr. istekao token) i čišćenje.
import "dotenv/config";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export const API_URL = process.env.TEST_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/api/v1`;
export const MAILPIT_URL = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";
export const JWT_SECRET = process.env.JWT_SECRET ?? "";
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

export const DEFAULT_PASSWORD = "Lozinka123!";

// ---------- HTTP ----------

export type ApiResponse = {
	status: number;
	headers: Headers;
	body: any;
	text: string;
};

export async function api(
	method: string,
	path: string,
	options: { body?: unknown; rawBody?: string; token?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
	const headers: Record<string, string> = { ...options.headers };
	if (options.body !== undefined || options.rawBody !== undefined) {
		headers["content-type"] ??= "application/json";
	}
	if (options.token) headers.authorization = `Bearer ${options.token}`;

	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers,
		body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
	});
	const text = await res.text();
	let body: any = null;
	try {
		body = JSON.parse(text);
	} catch {
		// HTML stranica (npr. /activate) ili prazno telo
	}
	return { status: res.status, headers: res.headers, body, text };
}

// ---------- Mailpit ----------

type MailpitSummary = { ID: string; Subject: string; Created: string };

export const SUBJECT_ACTIVATION = "Aktivirajte nalog";
export const SUBJECT_RESET = "Resetovanje lozinke";

async function searchMessages(email: string, subject: string): Promise<MailpitSummary[]> {
	const url = new URL("/api/v1/search", MAILPIT_URL);
	url.searchParams.set("query", `to:"${email}" subject:"${subject}"`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Mailpit search nije uspeo: ${res.status}`);
	const data = (await res.json()) as { messages?: MailpitSummary[] };
	return data.messages ?? [];
}

async function messageHtml(id: string): Promise<string> {
	const res = await fetch(new URL(`/api/v1/message/${id}`, MAILPIT_URL));
	if (!res.ok) throw new Error(`Mailpit message nije uspeo: ${res.status}`);
	const data = (await res.json()) as { HTML: string };
	return data.HTML;
}

function extractToken(html: string): string {
	const match = html.match(/token=([a-f0-9]{64})/);
	if (!match?.[1]) throw new Error("Token nije pronađen u mejlu");
	return match[1];
}

export async function countMails(email: string, subject: string) {
	return (await searchMessages(email, subject)).length;
}

// Svi tokeni iz mejlova za dati email/subject, najnoviji prvi
export async function getAllTokens(email: string, subject: string, expectedCount = 1): Promise<string[]> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const messages = await searchMessages(email, subject);
		if (messages.length >= expectedCount) {
			messages.sort((a, b) => b.Created.localeCompare(a.Created));
			const tokens: string[] = [];
			for (const m of messages) tokens.push(extractToken(await messageHtml(m.ID)));
			return tokens;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Nije stiglo ${expectedCount} mejl(a) "${subject}" za ${email}`);
}

export async function getLatestToken(email: string, subject: string, expectedCount = 1) {
	const tokens = await getAllTokens(email, subject, expectedCount);
	return tokens[0]!;
}

// ---------- Baza (samo priprema stanja i čišćenje) ----------

let pool: mysql.Pool | null = null;

export function db() {
	pool ??= mysql.createPool({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		connectionLimit: 2,
		timezone: "Z",
	});
	return pool;
}

export async function expireEmailTokens(userId: number, type: "activation" | "password_reset") {
	await db().execute(
		"UPDATE email_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE user_id = ? AND type = ?",
		[userId, type],
	);
}

export async function expireRefreshTokens(userId: number) {
	await db().execute(
		"UPDATE refresh_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE user_id = ?",
		[userId],
	);
}

export async function deleteUserById(userId: number) {
	await db().execute("DELETE FROM users WHERE id = ?", [userId]);
}

export async function getUserRow(email: string) {
	const [rows] = await db().execute<RowDataPacket[]>("SELECT * FROM users WHERE email = ?", [email]);
	return rows[0];
}

export async function getRefreshTokenRows(userId: number) {
	const [rows] = await db().execute<RowDataPacket[]>("SELECT * FROM refresh_tokens WHERE user_id = ?", [userId]);
	return rows;
}

export async function getEmailTokenRows(userId: number) {
	const [rows] = await db().execute<RowDataPacket[]>("SELECT * FROM email_tokens WHERE user_id = ?", [userId]);
	return rows;
}

// Briše samo korisnike koje je napravio ovaj test fajl (fajlovi se izvršavaju paralelno)
const createdEmails = new Set<string>();

export async function cleanup() {
	if (createdEmails.size > 0) {
		const emails = [...createdEmails];
		await db().query("DELETE FROM users WHERE email IN (?)", [emails]);
		createdEmails.clear();
	}
	await pool?.end();
	pool = null;
}

// ---------- Fabrike korisnika ----------

export function uniqueEmail(prefix = "e2e") {
	const email = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@test.local`;
	createdEmails.add(email);
	return email;
}

export type TestUser = {
	id: number;
	email: string;
	password: string;
	firstName: string;
	lastName: string;
};

export async function registerUser(overrides: Partial<Omit<TestUser, "id">> = {}): Promise<TestUser> {
	const input = {
		email: overrides.email ?? uniqueEmail(),
		password: overrides.password ?? DEFAULT_PASSWORD,
		firstName: overrides.firstName ?? "Test",
		lastName: overrides.lastName ?? "Korisnik",
	};
	createdEmails.add(input.email.trim().toLowerCase());
	const res = await api("POST", "/auth/register", { body: input });
	if (res.status !== 201) throw new Error(`Registracija nije uspela: ${res.status} ${res.text}`);
	return { ...input, email: res.body.data.user.email, id: res.body.data.user.id };
}

export async function activate(email: string) {
	const token = await getLatestToken(email, SUBJECT_ACTIVATION);
	const res = await api("GET", `/auth/activate?token=${token}`);
	if (res.status !== 200) throw new Error(`Aktivacija nije uspela: ${res.status}`);
}

export async function registerAndActivate(overrides: Partial<Omit<TestUser, "id">> = {}) {
	const user = await registerUser(overrides);
	await activate(user.email);
	return user;
}

export async function login(email: string, password: string) {
	const res = await api("POST", "/auth/login", { body: { email, password } });
	if (res.status !== 200) throw new Error(`Login nije uspeo: ${res.status} ${res.text}`);
	return res.body.data as { accessToken: string; refreshToken: string; user: any };
}

// Aktiviran korisnik + jedna sesija
export async function createLoggedInUser() {
	const user = await registerAndActivate();
	const session = await login(user.email, user.password);
	// session takođe ima `user` (bez lozinke), pa test korisnik ide poslednji da ga ne pregazi
	return { ...session, user };
}

export function expectError(res: ApiResponse, status: number, code: string) {
	if (res.status !== status || res.body?.success !== false || res.body?.error?.code !== code) {
		throw new Error(`Očekivano ${status} ${code}, dobijeno ${res.status} ${res.text}`);
	}
}
