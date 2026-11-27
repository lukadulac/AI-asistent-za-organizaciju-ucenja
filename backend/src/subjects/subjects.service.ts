import { pool } from "../db/pool.js";
import { HttpError } from "../utils/HttpError.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function createSubject(userID: number, name: string) {
	try {
		const [result] = await pool.execute<ResultSetHeader>(
			"INSERT INTO subjects (name, user_id) VALUES (?, ?)",
			[name, userID],
		);
		return {
			id: result.insertId,
			name,
			openTasks: 0,
			totalTasks: 0,
		};
	} catch (err) {
		if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
			throw new HttpError(
				409,
				"SUBJECT_EXISTS",
				"Predmet sa tim imenom već postoji.",
			);
		}
		throw err;
	}
}

export async function listSubjects(userId: number) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		`SELECT s.id, s.name,
		        COUNT(CASE WHEN t.status = 'todo' THEN 1 END) AS openTasks,
		        COUNT(t.id) AS totalTasks
		 FROM subjects s
		 LEFT JOIN tasks t ON t.subject_id = s.id
		 WHERE s.user_id = ?
		 GROUP BY s.id
		 ORDER BY s.name`,
		[userId],
	);
	return rows;
}

export async function getSubject(userId: number, subjectId: number) {
	const [rows] = await pool.execute<RowDataPacket[]>(
		`SELECT s.id, s.name,
		        COUNT(CASE WHEN t.status = 'todo' THEN 1 END) AS openTasks,
		        COUNT(t.id) AS totalTasks
		 FROM subjects s
		 LEFT JOIN tasks t ON t.subject_id = s.id
		 WHERE s.id = ? AND s.user_id = ?
		 GROUP BY s.id`,
		[subjectId, userId],
	);

	if (rows.length === 0) {
		throw new HttpError(404, "SUBJECT_NOT_FOUND", "Predmet nije pronađen.");
	}
	return rows[0];
}