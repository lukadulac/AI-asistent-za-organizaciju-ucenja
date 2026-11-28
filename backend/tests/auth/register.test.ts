import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
	api,
	cleanup,
	countMails,
	DEFAULT_PASSWORD,
	expectError,
	getUserRow,
	registerUser,
	SUBJECT_ACTIVATION,
	uniqueEmail,
} from "../helpers.js";

after(cleanup);

describe("POST /auth/register", () => {
	it("validni podaci -> 201, korisnik neaktiviran, stigao mejl za aktivaciju", async () => {
		const email = uniqueEmail();
		const res = await api("POST", "/auth/register", {
			body: { email, password: DEFAULT_PASSWORD, firstName: "Pera", lastName: "Perić" },
		});

		assert.equal(res.status, 201);
		assert.equal(res.body.success, true);
		assert.equal(res.body.data.user.email, email);
		assert.equal(res.body.data.user.firstName, "Pera");
		assert.equal(res.body.data.user.lastName, "Perić");
		assert.equal(typeof res.body.data.user.id, "number");

		const row = await getUserRow(email);
		assert.ok(row, "korisnik postoji u bazi");
		assert.equal(row.email_verified_at, null, "nalog nije aktiviran");
		assert.equal(await countMails(email, SUBJECT_ACTIVATION), 1);
	});

	it("odgovor ne sadrži lozinku ni heš", async () => {
		const email = uniqueEmail();
		const res = await api("POST", "/auth/register", {
			body: { email, password: DEFAULT_PASSWORD, firstName: "A", lastName: "B" },
		});
		assert.equal(res.status, 201);
		assert.ok(!res.text.includes(DEFAULT_PASSWORD));
		assert.ok(!/password/i.test(res.text));
	});

	it("lozinka je u bazi sačuvana kao bcrypt heš, ne kao plain text", async () => {
		const user = await registerUser();
		const row = await getUserRow(user.email);
		assert.notEqual(row!.password_hash, user.password);
		assert.match(row!.password_hash, /^\$2[aby]\$\d{2}\$/);
	});

	it("email se normalizuje (trim + lowercase)", async () => {
		const base = uniqueEmail();
		const res = await api("POST", "/auth/register", {
			body: { email: `  ${base.toUpperCase()}  `, password: DEFAULT_PASSWORD, firstName: "A", lastName: "B" },
		});
		assert.equal(res.status, 201);
		assert.equal(res.body.data.user.email, base);
	});

	it("isti email ponovo -> 409 EMAIL_TAKEN", async () => {
		const user = await registerUser();
		const res = await api("POST", "/auth/register", {
			body: { email: user.email, password: DEFAULT_PASSWORD, firstName: "A", lastName: "B" },
		});
		expectError(res, 409, "EMAIL_TAKEN");
	});

	it("isti email drugim slovima -> 409 EMAIL_TAKEN", async () => {
		const user = await registerUser();
		const res = await api("POST", "/auth/register", {
			body: { email: user.email.toUpperCase(), password: DEFAULT_PASSWORD, firstName: "A", lastName: "B" },
		});
		expectError(res, 409, "EMAIL_TAKEN");
	});

	describe("validacija -> 400 VALIDATION_ERROR", () => {
		const valid = () => ({ email: uniqueEmail(), password: DEFAULT_PASSWORD, firstName: "A", lastName: "B" });

		const cases: [string, (b: Record<string, unknown>) => void, string][] = [
			["neispravan email", (b) => (b.email = "nije-email"), "email"],
			["prazan email", (b) => (b.email = ""), "email"],
			["lozinka kraća od 8", (b) => (b.password = "kratka"), "password"],
			["lozinka duža od 72 bajta (ASCII)", (b) => (b.password = "a".repeat(73)), "password"],
			["lozinka duža od 72 bajta (č = 2 bajta)", (b) => (b.password = "č".repeat(37)), "password"],
			["prazno ime", (b) => (b.firstName = "   "), "firstName"],
			["ime duže od 100", (b) => (b.firstName = "a".repeat(101)), "firstName"],
			["prazno prezime", (b) => (b.lastName = ""), "lastName"],
			["nedostaje lozinka", (b) => delete b.password, "password"],
			["nedostaje email", (b) => delete b.email, "email"],
			["lozinka nije string", (b) => (b.password = 12345678), "password"],
		];

		for (const [name, mutate, field] of cases) {
			it(name, async () => {
				const body = valid();
				mutate(body);
				const res = await api("POST", "/auth/register", { body });
				expectError(res, 400, "VALIDATION_ERROR");
				assert.ok(res.body.error.details[field], `greška za polje ${field}`);
			});
		}

		it("lozinka od tačno 72 bajta prolazi", async () => {
			const body = { ...valid(), password: "a".repeat(72) };
			const res = await api("POST", "/auth/register", { body });
			assert.equal(res.status, 201);
		});

		it("prazno telo -> 400", async () => {
			const res = await api("POST", "/auth/register", { body: {} });
			expectError(res, 400, "VALIDATION_ERROR");
		});
	});
});
