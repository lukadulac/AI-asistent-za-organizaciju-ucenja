import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, CORS_ORIGIN, createLoggedInUser, expectError, registerAndActivate, uniqueEmail } from "./helpers.js";

after(cleanup);

describe("Opšta bezbednost", () => {
	it("SQL injection u email polju -> 400 validacija, server ne puca", async () => {
		const res = await api("POST", "/auth/login", { body: { email: "' OR 1=1 --", password: "x" } });
		expectError(res, 400, "VALIDATION_ERROR");
	});

	it("SQL injection u lozinci -> 401, ne prijavljuje", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", { body: { email: user.email, password: "' OR '1'='1" } });
		expectError(res, 401, "INVALID_CREDENTIALS");
	});

	it("XSS u imenu se ne izvršava u mejlu/odgovoru (vraća se kao JSON tekst)", async () => {
		const res = await api("POST", "/auth/register", {
			body: {
				email: uniqueEmail("xss"),
				password: "Lozinka123!",
				firstName: "<script>alert(1)</script>",
				lastName: "B",
			},
		});
		assert.equal(res.status, 201);
		assert.match(res.headers.get("content-type") ?? "", /application\/json/);
	});

	it("neispravan JSON -> 400 INVALID_JSON", async () => {
		const res = await api("POST", "/auth/login", { rawBody: "{ nije json" });
		expectError(res, 400, "INVALID_JSON");
	});

	it("preveliko telo zahteva -> odbijeno (4xx), ne 500", async () => {
		const res = await api("POST", "/auth/login", {
			rawBody: JSON.stringify({ email: "a@b.com", password: "x".repeat(200_000) }),
		});
		assert.ok(res.status >= 400 && res.status < 500, `dobijeno ${res.status}`);
	});

	it("nepostojeća ruta -> 404 NOT_FOUND u JSON formatu", async () => {
		expectError(await api("GET", "/auth/ne-postoji"), 404, "NOT_FOUND");
	});

	it("greške ne vraćaju stack trace", async () => {
		const res = await api("POST", "/auth/login", { rawBody: "{ nije json" });
		assert.ok(!/at \w+ \(|node_modules|\.ts:\d+/.test(res.text));
	});

	it("helmet zaglavlja su postavljena", async () => {
		const res = await api("GET", "/health");
		assert.equal(res.headers.get("x-content-type-options"), "nosniff");
		assert.ok(res.headers.get("x-frame-options") || res.headers.get("content-security-policy"));
		assert.equal(res.headers.get("x-powered-by"), null, "Express se ne odaje");
	});

	it("CORS: dozvoljen samo frontend origin", async () => {
		const evil = await api("GET", "/health", { headers: { origin: "http://evil.example.com" } });
		assert.notEqual(evil.headers.get("access-control-allow-origin"), "http://evil.example.com");
		assert.notEqual(evil.headers.get("access-control-allow-origin"), "*");

		const good = await api("GET", "/health", { headers: { origin: CORS_ORIGIN } });
		assert.equal(good.headers.get("access-control-allow-origin"), CORS_ORIGIN);
	});

	it("nijedan auth odgovor ne sadrži password_hash ni token_hash", async () => {
		const { user, accessToken, refreshToken } = await createLoggedInUser();
		const responses = [
			await api("GET", "/auth/me", { token: accessToken }),
			await api("POST", "/auth/refresh", { body: { refreshToken } }),
			await api("POST", "/auth/login", { body: { email: user.email, password: user.password } }),
		];
		for (const r of responses) {
			assert.ok(!/password_hash|token_hash|\$2[aby]\$/.test(r.text));
		}
	});
});

describe("Autorizacija (uloge i vlasništvo)", () => {
	it("običan korisnik na admin ruti -> 403", async () => {
		const { accessToken } = await createLoggedInUser();
		const res = await api("GET", "/admin/access-logs", { token: accessToken });
		assert.equal(res.status, 403);
	});

	it("korisnik A ne može da čita resurs korisnika B", async () => {
		const a = await createLoggedInUser();
		const b = await createLoggedInUser();
		const created = await api("POST", "/subjects", { token: b.accessToken, body: { name: "Matematika" } });
		const res = await api("GET", `/subjects/${created.body.data.subject.id}`, { token: a.accessToken });
		assert.ok([403, 404].includes(res.status));
	});
});
