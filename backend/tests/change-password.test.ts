import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser, expectError, login } from "./helpers.js";

after(cleanup);

const NEW_PASSWORD = "NovaLozinka456!";
const change = (token: string | undefined, body: unknown) =>
	api("PATCH", "/auth/me/password", { token, body });

describe("PATCH /auth/me/password", () => {
	it("ispravna trenutna lozinka -> 200 i nov par tokena koji radi", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const res = await change(accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD });

		assert.equal(res.status, 200);
		const { accessToken: newAccess, refreshToken: newRefresh } = res.body.data;
		assert.equal(typeof newAccess, "string");
		assert.match(newRefresh, /^[a-f0-9]{64}$/);
		assert.equal((await api("GET", "/auth/me", { token: newAccess })).status, 200);
		assert.equal((await api("POST", "/auth/refresh", { body: { refreshToken: newRefresh } })).status, 200);
	});

	it("stara lozinka više ne radi, nova radi", async () => {
		const { user, accessToken } = await createLoggedInUser();
		await change(accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD });

		const oldLogin = await api("POST", "/auth/login", { body: { email: user.email, password: user.password } });
		expectError(oldLogin, 401, "INVALID_CREDENTIALS");
		const newLogin = await api("POST", "/auth/login", { body: { email: user.email, password: NEW_PASSWORD } });
		assert.equal(newLogin.status, 200);
	});

	it("svi ostali uređaji su odjavljeni (njihovi refresh tokeni opozvani)", async () => {
		const { user, accessToken, refreshToken: thisDevice } = await createLoggedInUser();
		const { refreshToken: otherDevice } = await login(user.email, user.password);

		await change(accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD });

		for (const rt of [thisDevice, otherDevice]) {
			expectError(await api("POST", "/auth/refresh", { body: { refreshToken: rt } }), 401, "INVALID_REFRESH_TOKEN");
		}
	});

	it("pogrešna trenutna lozinka -> 400 WRONG_PASSWORD, lozinka se ne menja", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const res = await change(accessToken, { currentPassword: "Pogresna123", newPassword: NEW_PASSWORD });
		expectError(res, 400, "WRONG_PASSWORD");

		const stillOld = await api("POST", "/auth/login", { body: { email: user.email, password: user.password } });
		assert.equal(stillOld.status, 200);
	});

	it("bez access tokena -> 401 UNAUTHORIZED", async () => {
		expectError(await change(undefined, { currentPassword: "x", newPassword: NEW_PASSWORD }), 401, "UNAUTHORIZED");
	});

	it("refresh token umesto access tokena -> 401", async () => {
		const { user, refreshToken } = await createLoggedInUser();
		const res = await change(refreshToken, { currentPassword: user.password, newPassword: NEW_PASSWORD });
		expectError(res, 401, "INVALID_ACCESS_TOKEN");
	});

	it("nova lozinka prolazi validaciju (min 8, max 72 bajta)", async () => {
		const { user, accessToken } = await createLoggedInUser();
		expectError(await change(accessToken, { currentPassword: user.password, newPassword: "kratka" }), 400, "VALIDATION_ERROR");
		expectError(
			await change(accessToken, { currentPassword: user.password, newPassword: "ž".repeat(37) }),
			400,
			"VALIDATION_ERROR",
		);
	});

	it("bez trenutne lozinke -> 400 VALIDATION_ERROR", async () => {
		const { accessToken } = await createLoggedInUser();
		expectError(await change(accessToken, { newPassword: NEW_PASSWORD }), 400, "VALIDATION_ERROR");
	});
});
