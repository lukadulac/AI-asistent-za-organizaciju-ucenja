import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { api, cleanup, createLoggedInUser, deleteUserById, expectError, JWT_SECRET } from "../helpers.js";

after(cleanup);

// Pravi base64url delove JWT-a ručno (za "alg: none" napad)
function b64url(obj: unknown) {
	return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("GET /auth/me (zaštićena ruta)", () => {
	it("validan access token -> 200 i podaci korisnika", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const res = await api("GET", "/auth/me", { token: accessToken });

		assert.equal(res.status, 200);
		assert.deepEqual(res.body.data.user, {
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			role: "user",
		});
		assert.ok(!/password/i.test(res.text), "nema osetljivih polja");
	});

	it("bez Authorization header-a -> 401 UNAUTHORIZED", async () => {
		expectError(await api("GET", "/auth/me"), 401, "UNAUTHORIZED");
	});

	it("pogrešna šema (Basic) -> 401 UNAUTHORIZED", async () => {
		const res = await api("GET", "/auth/me", { headers: { authorization: "Basic dXNlcjpwYXNz" } });
		expectError(res, 401, "UNAUTHORIZED");
	});

	it("'Bearer' bez tokena -> 401", async () => {
		const res = await api("GET", "/auth/me", { headers: { authorization: "Bearer " } });
		assert.equal(res.status, 401);
	});

	it("smeće umesto tokena -> 401 INVALID_ACCESS_TOKEN", async () => {
		expectError(await api("GET", "/auth/me", { token: "ovo.nije.jwt" }), 401, "INVALID_ACCESS_TOKEN");
	});

	it("token potpisan pogrešnim ključem -> 401 INVALID_ACCESS_TOKEN", async () => {
		const { user } = await createLoggedInUser();
		const forged = jwt.sign({ role: "user" }, "pogresan-tajni-kljuc-koji-je-dugacak-32+", {
			subject: String(user.id),
			expiresIn: "15m",
		});
		expectError(await api("GET", "/auth/me", { token: forged }), 401, "INVALID_ACCESS_TOKEN");
	});

	it("'alg: none' token -> 401 INVALID_ACCESS_TOKEN", async () => {
		const { user } = await createLoggedInUser();
		const now = Math.floor(Date.now() / 1000);
		const unsigned = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
			sub: String(user.id),
			role: "admin",
			iat: now,
			exp: now + 900,
		})}.`;
		expectError(await api("GET", "/auth/me", { token: unsigned }), 401, "INVALID_ACCESS_TOKEN");
	});

	it("izmenjen payload (role: admin) bez ponovnog potpisa -> 401", async () => {
		const { accessToken } = await createLoggedInUser();
		const [header, payload, signature] = accessToken.split(".");
		const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
		decoded.role = "admin";
		const tampered = `${header}.${b64url(decoded)}.${signature}`;
		expectError(await api("GET", "/auth/me", { token: tampered }), 401, "INVALID_ACCESS_TOKEN");
	});

	it("refresh token umesto access tokena -> 401", async () => {
		const { refreshToken } = await createLoggedInUser();
		expectError(await api("GET", "/auth/me", { token: refreshToken }), 401, "INVALID_ACCESS_TOKEN");
	});

	it("istekao access token -> 401 TOKEN_EXPIRED", { skip: !JWT_SECRET && "JWT_SECRET nije u .env" }, async () => {
		const { user } = await createLoggedInUser();
		const now = Math.floor(Date.now() / 1000);
		const expired = jwt.sign(
			{ role: "user", iat: now - 3600, exp: now - 60 },
			JWT_SECRET,
			{ subject: String(user.id) },
		);
		expectError(await api("GET", "/auth/me", { token: expired }), 401, "TOKEN_EXPIRED");
	});

	it("korisnik obrisan iz baze, token još važi -> 401 UNAUTHORIZED", async () => {
		const { user, accessToken } = await createLoggedInUser();
		await deleteUserById(user.id);
		expectError(await api("GET", "/auth/me", { token: accessToken }), 401, "UNAUTHORIZED");
	});
});
