import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser, expectError } from "../helpers.js";
import { assertSubjectShape, createSubject, getSubjectRow } from "./helpers.js";

after(cleanup);

describe("POST /subjects", () => {
	describe("uspešno kreiranje", () => {
		it("validno ime -> 201, predmet sa brojačima 0/0", async () => {
			const { accessToken } = await createLoggedInUser();
			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "Matematika" } });

			assert.equal(res.status, 201);
			assert.equal(res.body.success, true);
			assertSubjectShape(res.body.data.subject);
			assert.equal(res.body.data.subject.name, "Matematika");
			assert.equal(res.body.data.subject.openTasks, 0);
			assert.equal(res.body.data.subject.totalTasks, 0);
		});

		it("predmet je u bazi vezan za ulogovanog korisnika", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Fizika");

			const row = await getSubjectRow(subject.id);
			assert.ok(row, "red postoji u bazi");
			assert.equal(row.user_id, user.id);
			assert.equal(row.name, "Fizika");
		});

		it("razmaci oko imena se uklanjaju (trim)", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "   Hemija  ");

			assert.equal(subject.name, "Hemija");
			assert.equal((await getSubjectRow(subject.id))?.name, "Hemija");
		});

		it("ime od tačno 100 karaktera -> 201 (granica)", async () => {
			const { accessToken } = await createLoggedInUser();
			const name = "a".repeat(100);
			const res = await api("POST", "/subjects", { token: accessToken, body: { name } });

			assert.equal(res.status, 201);
			assert.equal(res.body.data.subject.name, name);
		});

		it("ime od 1 karaktera -> 201 (granica)", async () => {
			const { accessToken } = await createLoggedInUser();
			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "X" } });
			assert.equal(res.status, 201);
		});

		it("ćirilica i dijakritici se čuvaju ispravno", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Математика čćžšđ");
			assert.equal(subject.name, "Математика čćžšđ");
			assert.equal((await getSubjectRow(subject.id))?.name, "Математика čćžšđ");
		});

		it("dva različita korisnika mogu imati predmet sa istim imenom", async () => {
			const a = await createLoggedInUser();
			const b = await createLoggedInUser();
			await createSubject(a.accessToken, "Matematika");

			const res = await api("POST", "/subjects", { token: b.accessToken, body: { name: "Matematika" } });
			assert.equal(res.status, 201);
		});

		it("XSS u imenu se čuva kao običan tekst i vraća kao JSON", async () => {
			const { accessToken } = await createLoggedInUser();
			const name = "<script>alert(1)</script>";
			const res = await api("POST", "/subjects", { token: accessToken, body: { name } });

			assert.equal(res.status, 201);
			assert.match(res.headers.get("content-type") ?? "", /application\/json/);
			assert.equal(res.body.data.subject.name, name);
		});
	});

	describe("validacija -> 400 VALIDATION_ERROR", () => {
		const invalidBodies: Array<[string, unknown]> = [
			["prazno telo", {}],
			["name je prazan string", { name: "" }],
			["name su samo razmaci", { name: "    " }],
			["name je broj", { name: 123 }],
			["name je null", { name: null }],
			["name je niz", { name: ["Matematika"] }],
			["name je objekat", { name: { x: 1 } }],
			["name ima 101 karakter", { name: "a".repeat(101) }],
			["telo je niz", [{ name: "Matematika" }]],
		];

		for (const [label, body] of invalidBodies) {
			it(label, async () => {
				const { accessToken } = await createLoggedInUser();
				const res = await api("POST", "/subjects", { token: accessToken, body });
				expectError(res, 400, "VALIDATION_ERROR");
			});
		}

		it("greška validacije ima details.name", async () => {
			const { accessToken } = await createLoggedInUser();
			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "" } });

			expectError(res, 400, "VALIDATION_ERROR");
			assert.ok(Array.isArray(res.body.error.details?.name), "details.name postoji");
		});

		it("neispravan JSON -> 400 INVALID_JSON", async () => {
			const { accessToken } = await createLoggedInUser();
			const res = await api("POST", "/subjects", { token: accessToken, rawBody: "{ nije json" });
			expectError(res, 400, "INVALID_JSON");
		});
	});

	describe("mass assignment (strict šema)", () => {
		it("dodatno polje userId -> 400 i predmet se ne pravi", async () => {
			const a = await createLoggedInUser();
			const b = await createLoggedInUser();
			const res = await api("POST", "/subjects", {
				token: a.accessToken,
				body: { name: "Podmetnut", userId: b.user.id },
			});
			expectError(res, 400, "VALIDATION_ERROR");

			const list = await api("GET", "/subjects", { token: b.accessToken });
			assert.deepEqual(list.body.data.subjects, [], "korisnik B nije dobio predmet");
		});

		it("dodatna polja id / openTasks -> 400", async () => {
			const { accessToken } = await createLoggedInUser();
			for (const extra of [{ id: 1 }, { openTasks: 99 }, { user_id: 1 }]) {
				const res = await api("POST", "/subjects", { token: accessToken, body: { name: "Test", ...extra } });
				expectError(res, 400, "VALIDATION_ERROR");
			}
		});
	});

	describe("duplikati -> 409 SUBJECT_EXISTS", () => {
		it("isto ime kod istog korisnika", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Matematika");

			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "Matematika" } });
			expectError(res, 409, "SUBJECT_EXISTS");
		});

		it("isto ime sa drugačijim velikim/malim slovima", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Matematika");

			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "MATEMATIKA" } });
			expectError(res, 409, "SUBJECT_EXISTS");
		});

		it("isto ime posle trim-a", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Matematika");

			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "  Matematika " } });
			expectError(res, 409, "SUBJECT_EXISTS");
		});

		it("isto ime bez dijakritika (collation je accent-insensitive)", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Šah");

			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "Sah" } });
			expectError(res, 409, "SUBJECT_EXISTS");
		});

		it("posle 409 i dalje postoji samo jedan predmet", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Matematika");
			await api("POST", "/subjects", { token: accessToken, body: { name: "Matematika" } });

			const list = await api("GET", "/subjects", { token: accessToken });
			assert.equal(list.body.data.subjects.length, 1);
		});
	});
});
