import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser, expectError } from "../helpers.js";
import { assertSubjectShape, createSubject, INVALID_IDS, insertTask } from "./helpers.js";

after(cleanup);

describe("GET /subjects/:id", () => {
	it("svoj predmet -> 200 i isti podaci kao pri kreiranju", async () => {
		const { accessToken } = await createLoggedInUser();
		const created = await createSubject(accessToken, "Matematika");

		const res = await api("GET", `/subjects/${created.id}`, { token: accessToken });
		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		assertSubjectShape(res.body.data.subject);
		assert.deepEqual(res.body.data.subject, created);
	});

	it("vraća tačne brojače taskova", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const subject = await createSubject(accessToken, "Matematika");
		await insertTask(user.id, subject.id, "todo");
		await insertTask(user.id, subject.id, "done");
		await insertTask(user.id, subject.id, "done");

		const res = await api("GET", `/subjects/${subject.id}`, { token: accessToken });
		assert.equal(res.body.data.subject.openTasks, 1);
		assert.equal(res.body.data.subject.totalTasks, 3);
	});

	it("isti odgovor kao stavka iz liste", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const subject = await createSubject(accessToken, "Matematika");
		await insertTask(user.id, subject.id, "todo");

		const single = await api("GET", `/subjects/${subject.id}`, { token: accessToken });
		const list = await api("GET", "/subjects", { token: accessToken });
		assert.deepEqual(single.body.data.subject, list.body.data.subjects[0]);
	});

	it("nepostojeći predmet -> 404 SUBJECT_NOT_FOUND", async () => {
		const { accessToken } = await createLoggedInUser();
		expectError(await api("GET", "/subjects/4294967295", { token: accessToken }), 404, "SUBJECT_NOT_FOUND");
	});

	it("tuđi predmet -> 404 (ne 403, da se ne otkrije da postoji)", async () => {
		const owner = await createLoggedInUser();
		const intruder = await createLoggedInUser();
		const subject = await createSubject(owner.accessToken, "Tajni predmet");

		const res = await api("GET", `/subjects/${subject.id}`, { token: intruder.accessToken });
		expectError(res, 404, "SUBJECT_NOT_FOUND");
		assert.ok(!res.text.includes("Tajni predmet"), "ime se ne odaje");
	});

	it("odgovor za tuđi i nepostojeći predmet je identičan", async () => {
		const owner = await createLoggedInUser();
		const intruder = await createLoggedInUser();
		const subject = await createSubject(owner.accessToken, "Matematika");

		const foreign = await api("GET", `/subjects/${subject.id}`, { token: intruder.accessToken });
		const missing = await api("GET", "/subjects/4294967295", { token: intruder.accessToken });
		assert.equal(foreign.status, missing.status);
		assert.deepEqual(foreign.body, missing.body);
	});

	describe("neispravan id -> 400 VALIDATION_ERROR", () => {
		for (const id of INVALID_IDS) {
			it(`id = "${id}"`, async () => {
				const { accessToken } = await createLoggedInUser();
				expectError(await api("GET", `/subjects/${id}`, { token: accessToken }), 400, "VALIDATION_ERROR");
			});
		}
	});

	it("ogroman id -> nije 500", async () => {
		const { accessToken } = await createLoggedInUser();
		const res = await api("GET", `/subjects/${"9".repeat(30)}`, { token: accessToken });
		assert.ok(res.status === 400 || res.status === 404, `dobijeno ${res.status} ${res.text}`);
	});

	it("SQL injection u id -> 400, ne puca", async () => {
		const { accessToken } = await createLoggedInUser();
		const res = await api("GET", `/subjects/${encodeURIComponent("1 OR 1=1")}`, { token: accessToken });
		expectError(res, 400, "VALIDATION_ERROR");
	});
});
