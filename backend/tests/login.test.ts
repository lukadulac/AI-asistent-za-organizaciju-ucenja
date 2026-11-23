import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
	api,
	cleanup,
	expectError,
	getRefreshTokenRows,
	registerAndActivate,
	registerUser,
	uniqueEmail,
} from "./helpers.js";

after(cleanup);

describe("POST /auth/login", () => {
	it("tačni podaci -> 200, user + accessToken + refreshToken", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});

		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		const { user: u, accessToken, refreshToken } = res.body.data;
		assert.deepEqual(u, {
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			role: "user",
		});
		assert.equal(typeof accessToken, "string");
		assert.match(refreshToken, /^[a-f0-9]{64}$/);
		assert.ok(!/password/i.test(res.text), "odgovor ne sadrži lozinku/heš");
	});

	it("access token: sub = userId, role, ističe za ~15 min, nema osetljivih podataka", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});
		const payload = jwt.decode(res.body.data.accessToken, {
			complete: true,
		}) as jwt.Jwt & {
			payload: jwt.JwtPayload;
		};

		assert.equal(payload.header.alg, "HS256");
		assert.equal(payload.payload.sub, String(user.id));
		assert.equal(payload.payload.role, "user");
		const lifetime = payload.payload.exp! - payload.payload.iat!;
		assert.equal(lifetime, 15 * 60);
		assert.equal(payload.payload.email, undefined);
		assert.equal(payload.payload.password, undefined);
	});

	it("refresh token je u bazi sačuvan samo kao heš, sa User-Agent-om", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
			headers: { "user-agent": "E2E-Test-Agent/1.0" },
		});
		const rows = await getRefreshTokenRows(user.id);
		assert.equal(rows.length, 1);
		assert.notEqual(rows[0]!.token_hash, res.body.data.refreshToken);
		assert.equal(rows[0]!.device_info, "E2E-Test-Agent/1.0");
	});

	it("email sa razmacima i velikim slovima -> i dalje login", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: {
				email: `  ${user.email.toUpperCase()} `,
				password: user.password,
			},
		});
		assert.equal(res.status, 200);
	});

	it("pogrešna lozinka -> 401 INVALID_CREDENTIALS", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: "PogresnaLozinka1" },
		});
		expectError(res, 401, "INVALID_CREDENTIALS");
	});

	it("lozinka je case-sensitive", async () => {
		const user = await registerAndActivate();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password.toUpperCase() },
		});
		expectError(res, 401, "INVALID_CREDENTIALS");
	});

	it("nepostojeći email i pogrešna lozinka daju IDENTIČAN odgovor (bez enumeracije)", async () => {
		const user = await registerAndActivate();
		const wrongPass = await api("POST", "/auth/login", {
			body: { email: user.email, password: "Pogresna123" },
		});
		const noUser = await api("POST", "/auth/login", {
			body: { email: uniqueEmail("nema"), password: "Pogresna123" },
		});

		assert.equal(noUser.status, wrongPass.status);
		assert.deepEqual(noUser.body, wrongPass.body);
	});

	it("neaktiviran nalog + tačna lozinka -> 403 EMAIL_NOT_VERIFIED", async () => {
		const user = await registerUser();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});
		expectError(res, 403, "EMAIL_NOT_VERIFIED");
	});

	it("neaktiviran nalog + pogrešna lozinka -> 401 (ne otkriva stanje naloga)", async () => {
		const user = await registerUser();
		const res = await api("POST", "/auth/login", {
			body: { email: user.email, password: "Pogresna123" },
		});
		expectError(res, 401, "INVALID_CREDENTIALS");
	});

	it("neaktiviran nalog ne dobija refresh token u bazi", async () => {
		const user = await registerUser();
		await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});
		assert.equal((await getRefreshTokenRows(user.id)).length, 0);
	});

	it("dva logina = dve nezavisne sesije", async () => {
		const user = await registerAndActivate();
		const a = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});
		const b = await api("POST", "/auth/login", {
			body: { email: user.email, password: user.password },
		});
		assert.notEqual(a.body.data.refreshToken, b.body.data.refreshToken);
		assert.equal((await getRefreshTokenRows(user.id)).length, 2);
	});

	describe("validacija -> 400 VALIDATION_ERROR", () => {
		const cases: [string, unknown][] = [
			["prazno telo", {}],
			["bez lozinke", { email: "a@b.com" }],
			["prazna lozinka", { email: "a@b.com", password: "" }],
			["neispravan email", { email: "nije-email", password: "nesto123" }],
			["email nije string", { email: 123, password: "nesto123" }],
		];
		for (const [name, body] of cases) {
			it(name, async () => {
				expectError(
					await api("POST", "/auth/login", { body }),
					400,
					"VALIDATION_ERROR",
				);
			});
		}
	});

	it("mnogo neuspešnih pokušaja -> 429 (rate limiting)", async () => {
		const user = await registerAndActivate();
		let limited = false;
		for (let i = 0; i < 30; i++) {
			const res = await api("POST", "/auth/login", {
				body: { email: user.email, password: `Pogresna${i}xx` },
			});
			if (res.status === 429) {
				limited = true;
				break;
			}
		}
		assert.ok(limited, "server mora da počne da vraća 429");
	});
});
