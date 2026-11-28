import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
	api,
	cleanup,
	countMails,
	expireEmailTokens,
	getAllTokens,
	getLatestToken,
	getUserRow,
	registerAndActivate,
	registerUser,
	SUBJECT_ACTIVATION,
	uniqueEmail,
} from "../helpers.js";

after(cleanup);

describe("GET /auth/activate", () => {
	it("validan token -> 200 HTML, nalog aktiviran", async () => {
		const user = await registerUser();
		const token = await getLatestToken(user.email, SUBJECT_ACTIVATION);

		const res = await api("GET", `/auth/activate?token=${token}`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/html/);
		assert.match(res.text, /Nalog aktiviran/);

		const row = await getUserRow(user.email);
		assert.notEqual(row!.email_verified_at, null);
	});

	it("posle aktivacije login radi", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", { body: { email: user.email, password: user.password } });
		assert.equal(res.status, 200);
	});

	it("isti token drugi put -> 400 (jednokratan)", async () => {
		const user = await registerUser();
		const token = await getLatestToken(user.email, SUBJECT_ACTIVATION);
		assert.equal((await api("GET", `/auth/activate?token=${token}`)).status, 200);

		const res = await api("GET", `/auth/activate?token=${token}`);
		assert.equal(res.status, 400);
		assert.match(res.text, /Aktivacija nije uspela/);
	});

	it("istekao token -> 400, nalog ostaje neaktiviran", async () => {
		const user = await registerUser();
		const token = await getLatestToken(user.email, SUBJECT_ACTIVATION);
		await expireEmailTokens(user.id, "activation");

		const res = await api("GET", `/auth/activate?token=${token}`);
		assert.equal(res.status, 400);
		assert.equal((await getUserRow(user.email))!.email_verified_at, null);
	});

	it("izmišljen token -> 400", async () => {
		const res = await api("GET", `/auth/activate?token=${"a".repeat(64)}`);
		assert.equal(res.status, 400);
	});

	it("bez tokena -> 400", async () => {
		const res = await api("GET", "/auth/activate");
		assert.equal(res.status, 400);
		assert.match(res.text, /Link je neispravan/);
	});

	it("token kao niz (?token=a&token=b) -> 400", async () => {
		const res = await api("GET", "/auth/activate?token=a&token=b");
		assert.equal(res.status, 400);
	});
});

describe("POST /auth/resend-activation", () => {
	const MESSAGE = "Ako nalog postoji i nije aktiviran, poslali smo novi link.";

	it("neaktiviran nalog -> 200, novi mejl, stari token više ne važi, novi važi", async () => {
		const user = await registerUser();
		const oldToken = await getLatestToken(user.email, SUBJECT_ACTIVATION);

		const res = await api("POST", "/auth/resend-activation", { body: { email: user.email } });
		assert.equal(res.status, 200);
		assert.equal(res.body.data.message, MESSAGE);

		const tokens = await getAllTokens(user.email, SUBJECT_ACTIVATION, 2);
		const newToken = tokens[0]!;
		assert.notEqual(newToken, oldToken);

		assert.equal((await api("GET", `/auth/activate?token=${oldToken}`)).status, 400);
		assert.equal((await api("GET", `/auth/activate?token=${newToken}`)).status, 200);
	});

	it("nepostojeći email -> isti odgovor kao za postojeći (bez enumeracije)", async () => {
		const user = await registerUser();
		const existing = await api("POST", "/auth/resend-activation", { body: { email: user.email } });
		const missing = await api("POST", "/auth/resend-activation", { body: { email: uniqueEmail("nema") } });

		assert.equal(missing.status, existing.status);
		assert.deepEqual(missing.body, existing.body);
	});

	it("već aktiviran nalog -> isti odgovor, ne šalje se novi mejl", async () => {
		const user = await registerAndActivate();
		const before = await countMails(user.email, SUBJECT_ACTIVATION);

		const res = await api("POST", "/auth/resend-activation", { body: { email: user.email } });
		assert.equal(res.status, 200);
		assert.equal(res.body.data.message, MESSAGE);
		assert.equal(await countMails(user.email, SUBJECT_ACTIVATION), before);
	});

	it("neispravan email -> 400 VALIDATION_ERROR", async () => {
		const res = await api("POST", "/auth/resend-activation", { body: { email: "x" } });
		assert.equal(res.status, 400);
		assert.equal(res.body.error.code, "VALIDATION_ERROR");
	});
});
