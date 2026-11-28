// Alati samo za testove predmeta.
// Taskovi se ubacuju direktno u bazu jer /tasks endpointi još ne postoje
// (baza se i dalje koristi samo za pripremu stanja i proveru, ne za logiku).
import assert from "node:assert/strict";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { api, db } from "../helpers.js";

export type SubjectDto = {
	id: number;
	name: string;
	openTasks: number;
	totalTasks: number;
};

export async function createSubject(token: string, name: string): Promise<SubjectDto> {
	const res = await api("POST", "/subjects", { token, body: { name } });
	if (res.status !== 201) throw new Error(`Kreiranje predmeta nije uspelo: ${res.status} ${res.text}`);
	return res.body.data.subject;
}

export async function insertTask(
	userId: number,
	subjectId: number,
	status: "todo" | "done" = "todo",
): Promise<number> {
	const [result] = await db().execute<ResultSetHeader>(
		`INSERT INTO tasks (user_id, subject_id, title, due_date, priority, estimated_minutes, status, completed_at)
		 VALUES (?, ?, ?, '2030-01-01', 'medium', 60, ?, ?)`,
		[userId, subjectId, `Task ${status}`, status, status === "done" ? new Date() : null],
	);
	return result.insertId;
}

export async function getSubjectRow(id: number) {
	const [rows] = await db().execute<RowDataPacket[]>("SELECT * FROM subjects WHERE id = ?", [id]);
	return rows[0];
}

export async function countTasksOfSubject(subjectId: number) {
	const [rows] = await db().execute<RowDataPacket[]>(
		"SELECT COUNT(*) AS count FROM tasks WHERE subject_id = ?",
		[subjectId],
	);
	return Number(rows[0]!.count);
}

// Odgovor ne sme da sadrži interna polja (user_id i sl.), a brojači moraju biti brojevi, ne stringovi
export function assertSubjectShape(subject: unknown) {
	assert.ok(subject && typeof subject === "object", "predmet mora biti objekat");
	assert.deepEqual(Object.keys(subject).sort(), ["id", "name", "openTasks", "totalTasks"]);
	const s = subject as SubjectDto;
	assert.equal(typeof s.id, "number");
	assert.equal(typeof s.name, "string");
	assert.equal(typeof s.openTasks, "number", "openTasks mora biti broj");
	assert.equal(typeof s.totalTasks, "number", "totalTasks mora biti broj");
}

// Neispravni ID-jevi u putanji: svi moraju dati 400 VALIDATION_ERROR
export const INVALID_IDS = ["abc", "0", "-1", "1.5", "01", "1e3", "1abc", "%20"];
