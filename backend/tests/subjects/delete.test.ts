import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser, expectError } from "../helpers.js";
import { countTasksOfSubject, createSubject, getSubjectRow, INVALID_IDS, insertTask } from "./helpers.js";

after(cleanup);

describe("DELETE /subjects/:id", () => {
	describe("uspešno brisanje", () => {
		it("predmet bez taskova -> 200 { deletedTasks: 0 }", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");

			const res = await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });
			assert.equal(res.status, 200);
			assert.equal(res.body.success, true);
			assert.deepEqual(res.body.data, { deletedTasks: 0 });
		});

		it("predmet sa taskovima -> deletedTasks je broj svih taskova (todo + done)", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await insertTask(user.id, subject.id, "todo");
			await insertTask(user.id, subject.id, "todo");
			await insertTask(user.id, subject.id, "done");

			const res = await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });
			assert.equal(res.status, 200);
			assert.strictEqual(res.body.data.deletedTasks, 3, "broj, ne string");
		});

		it("predmet i njegovi taskovi su uklonjeni iz baze", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await insertTask(user.id, subject.id, "todo");
			await insertTask(user.id, subject.id, "done");

			await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });
			assert.equal(await getSubjectRow(subject.id), undefined);
			assert.equal(await countTasksOfSubject(subject.id), 0);
		});

		it("posle brisanja GET -> 404 i predmet nije u listi", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await createSubject(accessToken, "Fizika");

			await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });

			expectError(await api("GET", `/subjects/${subject.id}`, { token: accessToken }), 404, "SUBJECT_NOT_FOUND");
			const list = await api("GET", "/subjects", { token: accessToken });
			assert.deepEqual(list.body.data.subjects.map((s: { name: string }) => s.name), ["Fizika"]);
		});

		it("brisanje ne dira druge predmete i njihove taskove", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const math = await createSubject(accessToken, "Matematika");
			const physics = await createSubject(accessToken, "Fizika");
			await insertTask(user.id, math.id, "todo");
			await insertTask(user.id, physics.id, "todo");
			await insertTask(user.id, physics.id, "done");

			await api("DELETE", `/subjects/${math.id}`, { token: accessToken });
			assert.ok(await getSubjectRow(physics.id));
			assert.equal(await countTasksOfSubject(physics.id), 2);
		});

		it("posle brisanja isto ime može ponovo da se kreira", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });

			const res = await api("POST", "/subjects", { token: accessToken, body: { name: "Matematika" } });
			assert.equal(res.status, 201);
			assert.notEqual(res.body.data.subject.id, subject.id);
		});
	});

	describe("vlasništvo i postojanje", () => {
		it("tuđi predmet -> 404, predmet i taskovi ostaju u bazi", async () => {
			const owner = await createLoggedInUser();
			const intruder = await createLoggedInUser();
			const subject = await createSubject(owner.accessToken, "Matematika");
			await insertTask(owner.user.id, subject.id, "todo");

			const res = await api("DELETE", `/subjects/${subject.id}`, { token: intruder.accessToken });
			expectError(res, 404, "SUBJECT_NOT_FOUND");
			assert.ok(await getSubjectRow(subject.id), "predmet nije obrisan");
			assert.equal(await countTasksOfSubject(subject.id), 1, "taskovi nisu obrisani");
		});

		it("nepostojeći predmet -> 404 SUBJECT_NOT_FOUND", async () => {
			const { accessToken } = await createLoggedInUser();
			expectError(await api("DELETE", "/subjects/4294967295", { token: accessToken }), 404, "SUBJECT_NOT_FOUND");
		});

		it("drugo brisanje istog predmeta -> 404 (idempotentno, bez 500)", async () => {
			const { accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");

			const first = await api("DELETE", `/subjects/${subject.id}`, { token: accessToken });
			assert.equal(first.status, 200);
			expectError(await api("DELETE", `/subjects/${subject.id}`, { token: accessToken }), 404, "SUBJECT_NOT_FOUND");
		});

		it("dva istovremena brisanja -> jedno 200, jedno 404", async () => {
			const { user, accessToken } = await createLoggedInUser();
			const subject = await createSubject(accessToken, "Matematika");
			await insertTask(user.id, subject.id, "todo");

			const results = await Promise.all([
				api("DELETE", `/subjects/${subject.id}`, { token: accessToken }),
				api("DELETE", `/subjects/${subject.id}`, { token: accessToken }),
			]);
			assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
		});
	});

	describe("neispravan id -> 400 VALIDATION_ERROR", () => {
		for (const id of INVALID_IDS) {
			it(`id = "${id}"`, async () => {
				const { accessToken } = await createLoggedInUser();
				expectError(await api("DELETE", `/subjects/${id}`, { token: accessToken }), 400, "VALIDATION_ERROR");
			});
		}
	});
});
