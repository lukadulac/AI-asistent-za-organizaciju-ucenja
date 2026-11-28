import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
	api,
	cleanup,
	countMails,
	createLoggedInUser,
	expectError,
	expireEmailTokens,
	getAllTokens,
	getLatestToken,
	registerAndActivate,
	registerUser,
	SUBJECT_RESET,
	uniqueEmail,
} from "../helpers.js";

after(cleanup);

const NEW_PASSWORD = "NovaLozinka456!";
const forgot = (email: string) => api("POST", "/auth/forgot-password", { body: { email } });
const reset = (token: unknown, password: unknown) =>
	api("POST", "/auth/reset-password", { body: { token, password } });
const loginStatus = async (email: string, password: string) =>
	(await api("POST", "/auth/login", { body: { email, password } })).status;

describe("POST /auth/forgot-password", () => {
	it("postojeći email -> 200 i stiže mejl sa linkom", async () => {
		const user = await registerAndActivate();
		const res = await forgot(user.email);
		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		assert.match(await getLatestToken(user.email, SUBJECT_RESET), /^[a-f0-9]{64}$/);
	});

	it("nepostojeći email -> identičan odgovor, bez mejla", async () => {
		const user = await registerAndActivate();
		const existing = await forgot(user.email);
		const missingEmail = uniqueEmail("nema");
		const missing = await forgot(missingEmail);

		assert.equal(missing.status, existing.status);
		assert.deepEqual(missing.body, existing.body);
		assert.equal(await countMails(missingEmail, SUBJECT_RESET), 0);
	});

	it("dva zahteva -> važi samo najnoviji token", async () => {
		const user = await registerAndActivate();
		await forgot(user.email);
		await forgot(user.email);
		const [newest, older] = await getAllTokens(user.email, SUBJECT_RESET, 2);

		expectError(await reset(older, NEW_PASSWORD), 400, "INVALID_TOKEN");
		assert.equal((await reset(newest, NEW_PASSWORD)).status, 200);
	});

	it("neispravan email -> 400 VALIDATION_ERROR", async () => {
		expectError(await forgot("nije-email"), 400, "VALIDATION_ERROR");
	});

	it("mnogo zahteva za isti email -> 429", { todo: "rate limiting nije implementiran" }, async () => {
		const user = await registerAndActivate();
		let limited = false;
		for (let i = 0; i < 15; i++) {
			if ((await forgot(user.email)).status === 429) {
				limited = true;
				break;
			}
		}
		assert.ok(limited);
	});
});

describe("POST /auth/reset-password", () => {
	it("validan token -> lozinka promenjena: stara ne radi, nova radi", async () => {
		const user = await registerAndActivate();
		await forgot(user.email);
		const token = await getLatestToken(user.email, SUBJECT_RESET);

		const res = await reset(token, NEW_PASSWORD);
		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		assert.equal(await loginStatus(user.email, user.password), 401);
		assert.equal(await loginStatus(user.email, NEW_PASSWORD), 200);
	});

	it("posle reseta svi stari refresh tokeni su opozvani", async () => {
		const { user, refreshToken } = await createLoggedInUser();
		await forgot(user.email);
		await reset(await getLatestToken(user.email, SUBJECT_RESET), NEW_PASSWORD);

		const res = await api("POST", "/auth/refresh", { body: { refreshToken } });
		expectError(res, 401, "INVALID_REFRESH_TOKEN");
	});

	it("token je jednokratan", async () => {
		const user = await registerAndActivate();
		await forgot(user.email);
		const token = await getLatestToken(user.email, SUBJECT_RESET);

		assert.equal((await reset(token, NEW_PASSWORD)).status, 200);
		expectError(await reset(token, "JosJednaLozinka789"), 400, "INVALID_TOKEN");
	});

	it("istekao token -> 400, lozinka ostaje stara", async () => {
		const user = await registerAndActivate();
		await forgot(user.email);
		const token = await getLatestToken(user.email, SUBJECT_RESET);
		await expireEmailTokens(user.id, "password_reset");

		expectError(await reset(token, NEW_PASSWORD), 400, "INVALID_TOKEN");
		assert.equal(await loginStatus(user.email, user.password), 200);
	});

	it("izmišljen token -> 400 INVALID_TOKEN", async () => {
		expectError(await reset("b".repeat(64), NEW_PASSWORD), 400, "INVALID_TOKEN");
	});

	it("aktivacioni token ne može da se iskoristi za reset", async () => {
		const user = await registerUser();
		const activationToken = await getLatestToken(user.email, "Aktivirajte nalog");
		expectError(await reset(activationToken, NEW_PASSWORD), 400, "INVALID_TOKEN");
	});

	it("reset aktivira i neaktiviran nalog (link iz mejla dokazuje vlasništvo)", async () => {
		const user = await registerUser();
		await forgot(user.email);
		await reset(await getLatestToken(user.email, SUBJECT_RESET), NEW_PASSWORD);
		assert.equal(await loginStatus(user.email, NEW_PASSWORD), 200);
	});

	it("nova lozinka prolazi istu validaciju kao registracija", async () => {
		const user = await registerAndActivate();
		await forgot(user.email);
		const token = await getLatestToken(user.email, SUBJECT_RESET);

		expectError(await reset(token, "kratka"), 400, "VALIDATION_ERROR");
		expectError(await reset(token, "a".repeat(73)), 400, "VALIDATION_ERROR");
		// token nije potrošen neuspešnom validacijom
		assert.equal((await reset(token, NEW_PASSWORD)).status, 200);
	});

	it("bez tokena -> 400 VALIDATION_ERROR", async () => {
		expectError(await api("POST", "/auth/reset-password", { body: { password: NEW_PASSWORD } }), 400, "VALIDATION_ERROR");
	});
});
