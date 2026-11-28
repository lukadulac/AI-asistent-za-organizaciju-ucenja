import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createLoggedInUser } from "../helpers.js";
import { assertSubjectShape, createSubject, insertTask } from "./helpers.js";

after(cleanup);

describe("GET /subjects", () => {
	it("novi korisnik -> 200 i prazna lista", async () => {
		const { accessToken } = await createLoggedInUser();
		const res = await api("GET", "/subjects", { token: accessToken });

		assert.equal(res.status, 200);
		assert.equal(res.body.success, true);
		assert.deepEqual(res.body.data.subjects, []);
	});

	it("vraća samo predmete ulogovanog korisnika", async () => {
		const a = await createLoggedInUser();
		const b = await createLoggedInUser();
		await createSubject(a.accessToken, "Matematika");
		await createSubject(b.accessToken, "Fizika");
		await createSubject(b.accessToken, "Hemija");

		const res = await api("GET", "/subjects", { token: a.accessToken });
		assert.equal(res.status, 200);
		assert.deepEqual(
			res.body.data.subjects.map((s: { name: string }) => s.name),
			["Matematika"],
		);
	});

	it("predmeti su sortirani po imenu", async () => {
		const { accessToken } = await createLoggedInUser();
		for (const name of ["Fizika", "Biologija", "Matematika", "Algebra"]) {
			await createSubject(accessToken, name);
		}

		const res = await api("GET", "/subjects", { token: accessToken });
		assert.deepEqual(
			res.body.data.subjects.map((s: { name: string }) => s.name),
			["Algebra", "Biologija", "Fizika", "Matematika"],
		);
	});

	it("svaki predmet ima tačno id, name, openTasks, totalTasks (bez user_id)", async () => {
		const { accessToken } = await createLoggedInUser();
		await createSubject(accessToken, "Matematika");

		const res = await api("GET", "/subjects", { token: accessToken });
		for (const subject of res.body.data.subjects) assertSubjectShape(subject);
		assert.ok(!/user_id|userId/.test(res.text));
	});

	it("predmet bez taskova -> openTasks 0 i totalTasks 0 (ne null)", async () => {
		const { accessToken } = await createLoggedInUser();
		await createSubject(accessToken, "Prazan");

		const res = await api("GET", "/subjects", { token: accessToken });
		const [subject] = res.body.data.subjects;
		assert.equal(subject.openTasks, 0);
		assert.equal(subject.totalTasks, 0);
	});

	it("brojači: openTasks broji samo 'todo', totalTasks broji sve", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const subject = await createSubject(accessToken, "Matematika");
		await insertTask(user.id, subject.id, "todo");
		await insertTask(user.id, subject.id, "todo");
		await insertTask(user.id, subject.id, "done");

		const res = await api("GET", "/subjects", { token: accessToken });
		const [listed] = res.body.data.subjects;
		assert.equal(listed.openTasks, 2);
		assert.equal(listed.totalTasks, 3);
		assertSubjectShape(listed);
	});

	it("svi taskovi završeni -> openTasks 0, totalTasks > 0", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const subject = await createSubject(accessToken, "Završen");
		await insertTask(user.id, subject.id, "done");
		await insertTask(user.id, subject.id, "done");

		const res = await api("GET", "/subjects", { token: accessToken });
		const [listed] = res.body.data.subjects;
		assert.equal(listed.openTasks, 0);
		assert.equal(listed.totalTasks, 2);
	});

	it("taskovi jednog predmeta se ne broje drugom", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const math = await createSubject(accessToken, "Matematika");
		const physics = await createSubject(accessToken, "Fizika");
		await insertTask(user.id, math.id, "todo");
		await insertTask(user.id, math.id, "todo");
		await insertTask(user.id, physics.id, "done");

		const res = await api("GET", "/subjects", { token: accessToken });
		const byName = Object.fromEntries(
			res.body.data.subjects.map((s: { name: string }) => [s.name, s]),
		);
		assert.deepEqual(
			{ open: byName.Matematika.openTasks, total: byName.Matematika.totalTasks },
			{ open: 2, total: 2 },
		);
		assert.deepEqual(
			{ open: byName.Fizika.openTasks, total: byName.Fizika.totalTasks },
			{ open: 0, total: 1 },
		);
	});

	it("predmet sa taskovima i predmet bez taskova se oba pojavljuju (LEFT JOIN)", async () => {
		const { user, accessToken } = await createLoggedInUser();
		const withTasks = await createSubject(accessToken, "Sa taskovima");
		await createSubject(accessToken, "Bez taskova");
		await insertTask(user.id, withTasks.id, "todo");

		const res = await api("GET", "/subjects", { token: accessToken });
		assert.equal(res.body.data.subjects.length, 2);
	});
});
