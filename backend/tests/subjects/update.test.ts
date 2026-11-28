import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser, expectError } from "../helpers.js";
import { assertSubjectShape, createSubject, getSubjectRow, INVALID_IDS, insertTask } from "./helpers.js";

after(cleanup);

describe("PATCH /subjects/:id", () => {
	describe("uspešna izmena", () => {
		it("novo ime -> 200, izmenjen predmet u odgovoru i u bazi", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Matematika 2" } });
			assert.equal(res.status, 200);
			assert.equal(res.body.success, true);
			assertSubjectShape(res.body.data.subject);
			assert.equal(res.body.data.subject.id, subject.id);
			assert.equal(res.body.data.subject.name, "Matematika 2");
			assert.equal((await getSubjectRow(subject.id))?.name, "Matematika 2");
		});

		it("odgovor sadrži tačne brojače taskova", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await insertTask(user.id, subject.id, "todo");
			await insertTask(user.id, subject.id, "done");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Analiza" } });
			assert.equal(res.body.data.subject.openTasks, 1);
			assert.equal(res.body.data.subject.totalTasks, 2);
		});

		it("izmena ne dira taskove predmeta", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await insertTask(user.id, subject.id, "todo");

			await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Analiza" } });
			const res = await api("GET", `/subjects/${subject.id}`, { token: accessToken });
			assert.equal(res.body.data.subject.totalTasks, 1);
		});

		it("ime se trim-uje", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "  Fizika  " } });
			assert.equal(res.body.data.subject.name, "Fizika");
		});

		it("isto ime kao trenutno -> 200 (nije 404 ni 409)", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Matematika" } });
			assert.equal(res.status, 200, res.text);
			assert.equal(res.body.data.subject.name, "Matematika");
		});

		it("promena samo velikih/malih slova svog predmeta -> 200 (nije 409)", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Matematika" } });
			assert.equal(res.status, 200, res.text);
			assert.equal(res.body.data.subject.name, "Matematika");
		});

		it("ime koje već koristi drugi korisnik -> 200", async () => {
			const a = await createLoggedInUser();
			const b = await createLoggedInUser();
			await createSubject(b.accessToken, "Fizika");
			const subject = await createSubject(a.accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: a.accessToken, body: { name: "Fizika" } });
			assert.equal(res.status, 200);
		});
	});

	describe("vlasništvo i postojanje", () => {
		it("tuđi predmet -> 404 i ime u bazi ostaje nepromenjeno", async () => {
			const owner = await createLoggedInUser();
			const intruder = await createLoggedInUser();
			const subject = await createSubject(owner.accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: intruder.accessToken, body: { name: "Hakovano" } });
			expectError(res, 404, "SUBJECT_NOT_FOUND");
			assert.equal((await getSubjectRow(subject.id))?.name, "Matematika");
		});

		it("nepostojeći predmet -> 404 SUBJECT_NOT_FOUND", async () => {
			const { accessToken } = await createLoggedInUser();
			const res = await api("PATCH", "/subjects/4294967295", { token: accessToken, body: { name: "X" } });
			expectError(res, 404, "SUBJECT_NOT_FOUND");
		});

		it("obrisan predmet -> 404", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "X" } });
			expectError(res, 404, "SUBJECT_NOT_FOUND");
		});
	});

	describe("duplikati -> 409 SUBJECT_EXISTS", () => {
		it("ime drugog svog predmeta -> 409 i ime ostaje staro", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Fizika");
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "Fizika" } });
			expectError(res, 409, "SUBJECT_EXISTS");
			assert.equal((await getSubjectRow(subject.id))?.name, "Matematika");
		});

		it("ime drugog svog predmeta drugačijim slovima -> 409", async () => {
			const { accessToken } = await createLoggedInUser();
			await createSubject(accessToken, "Fizika");
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body: { name: "FIZIKA" } });
			expectError(res, 409, "SUBJECT_EXISTS");
		});
	});

	describe("validacija -> 400 VALIDATION_ERROR", () => {
		const invalidBodies: Array<[string, unknown]> = [
			["prazno telo", {}],
			["name je prazan string", { name: "" }],
			["name su samo razmaci", { name: "   " }],
			["name je broj", { name: 42 }],
			["name ima 101 karakter", { name: "a".repeat(101) }],
			["dodatno polje userId (mass assignment)", { name: "X", userId: 1 }],
			["dodatno polje id", { name: "X", id: 999 }],
		];

		for (const [label, body] of invalidBodies) {
			it(label, async () => {
				const { accessToken } = await createLoggedInUser();
				const subject = await createSubject(accessToken, "Matematika");

				const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, body });
				expectError(res, 400, "VALIDATION_ERROR");
				assert.equal((await getSubjectRow(subject.id))?.name, "Matematika", "ime nije promenjeno");
			});
		}

		for (const id of INVALID_IDS) {
			it(`neispravan id = "${id}"`, async () => {
				const { accessToken } = await createLoggedInUser();
				const res = await api("PATCH", `/subjects/${id}`, { token: accessToken, body: { name: "X" } });
				expectError(res, 400, "VALIDATION_ERROR");
			});
		}

		it("neispravan JSON -> 400 INVALID_JSON", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			const res = await api("PATCH", `/subjects/${subject.id}`, { token: accessToken, rawBody: "{ nije" });
			expectError(res, 400, "INVALID_JSON");
		});
	});
});
