import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
	api,
	cleanup,
	createLoggedInUser,
	deleteUserById,
	expectError,
	expireRefreshTokens,
	login,
} from "./helpers.js";

after(cleanup);

const refresh = (refreshToken: unknown) =>
	api("POST", "/auth/refresh", { body: { refreshToken } });
const logout = (refreshToken: unknown) =>
	api("POST", "/auth/logout", { body: { refreshToken } });

describe("POST /auth/refresh", () => {
	it("validan refresh token -> 200, nov par tokena, novi access token radi", async () => {
		const { refreshToken } = await createLoggedInUser();
		const res = await refresh(refreshToken);

		assert.equal(res.status, 200);
		const { accessToken: newAccess, refreshToken: newRefresh } = res.body.data;
		assert.equal(typeof newAccess, "string");
		assert.match(newRefresh, /^[a-f0-9]{64}$/);
		assert.notEqual(newRefresh, refreshToken);
		assert.equal(
			(await api("GET", "/auth/me", { token: newAccess })).status,
			200,
		);
	});

	it("rotacija: stari refresh token posle upotrebe više ne važi", async () => {
		const { refreshToken } = await createLoggedInUser();
		assert.equal((await refresh(refreshToken)).status, 200);
		expectError(await refresh(refreshToken), 401, "INVALID_REFRESH_TOKEN");
	});

	it("lanac rotacija radi (A -> B -> C)", async () => {
		const { refreshToken: a } = await createLoggedInUser();
		const b = (await refresh(a)).body.data.refreshToken;
		const c = (await refresh(b)).body.data.refreshToken;
		assert.equal((await refresh(c)).status, 200);
	});

	it("dva istovremena zahteva sa istim tokenom -> samo jedan uspeva", async () => {
		const { refreshToken } = await createLoggedInUser();
		const results = await Promise.all([
			refresh(refreshToken),
			refresh(refreshToken),
		]);
		const ok = results.filter((r) => r.status === 200).length;
		assert.equal(ok, 1);
	});

	it("reuse detekcija: ponovna upotreba starog tokena opoziva i ceo lanac", async () => {
		const { refreshToken: old } = await createLoggedInUser();
		const fresh = (await refresh(old)).body.data.refreshToken;
		await refresh(old); // napadač koristi ukradeni stari token
		expectError(await refresh(fresh), 401, "INVALID_REFRESH_TOKEN");
	});

	it("istekao refresh token -> 401", async () => {
		const { user, refreshToken } = await createLoggedInUser();
		await expireRefreshTokens(user.id);
		expectError(await refresh(refreshToken), 401, "INVALID_REFRESH_TOKEN");
	});

	it("izmišljen token -> 401", async () => {
		expectError(await refresh("f".repeat(64)), 401, "INVALID_REFRESH_TOKEN");
	});

	it("access token umesto refresh tokena -> 401", async () => {
		const { accessToken } = await createLoggedInUser();
		expectError(await refresh(accessToken), 401, "INVALID_REFRESH_TOKEN");
	});

	it("obrisan korisnik -> 401", async () => {
		const { user, refreshToken } = await createLoggedInUser();
		await deleteUserById(user.id);
		expectError(await refresh(refreshToken), 401, "INVALID_REFRESH_TOKEN");
	});

	it("bez tokena / prazan / nije string -> 400 VALIDATION_ERROR", async () => {
		expectError(
			await api("POST", "/auth/refresh", { body: {} }),
			400,
			"VALIDATION_ERROR",
		);
		expectError(await refresh(""), 400, "VALIDATION_ERROR");
		expectError(await refresh(123), 400, "VALIDATION_ERROR");
	});
});

describe("POST /auth/logout", () => {
	it("posle odjave taj refresh token više ne radi", async () => {
		const { refreshToken } = await createLoggedInUser();
		const res = await logout(refreshToken);
		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		expectError(await refresh(refreshToken), 401, "INVALID_REFRESH_TOKEN");
	});

	it("dupla odjava -> i dalje 200", async () => {
		const { refreshToken } = await createLoggedInUser();
		assert.equal((await logout(refreshToken)).status, 200);
		assert.equal((await logout(refreshToken)).status, 200);
	});

	it("izmišljen token -> isti 200 odgovor (ne otkriva da li je token postojao)", async () => {
		const { refreshToken } = await createLoggedInUser();
		const real = await logout(refreshToken);
		const fake = await logout("0".repeat(64));
		assert.equal(fake.status, real.status);
		assert.deepEqual(fake.body, real.body);
	});

	it("odjava jednog uređaja ne odjavljuje drugi", async () => {
		const { user, refreshToken: deviceA } = await createLoggedInUser();
		const { refreshToken: deviceB } = await login(user.email, user.password);

		await logout(deviceA);
		assert.equal((await refresh(deviceB)).status, 200);
	});

	it("bez tokena -> 400 VALIDATION_ERROR", async () => {
		expectError(
			await api("POST", "/auth/logout", { body: {} }),
			400,
			"VALIDATION_ERROR",
		);
	});
});
