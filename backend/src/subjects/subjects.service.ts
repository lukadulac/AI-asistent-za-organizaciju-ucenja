import { inTransaction, pool } from "../db/pool.js";
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

export async function updateSubject(userId: number, subjectId: number,name: string,) {
	let result: ResultSetHeader;
	try {
		[result] = await pool.execute<ResultSetHeader>(
			"UPDATE subjects SET name = ? WHERE id = ? AND user_id = ?",
			[name, subjectId, userId],
		);
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

	if (result.affectedRows === 0) {
		throw new HttpError(404, "SUBJECT_NOT_FOUND", "Predmet nije pronađen.");
	}

	return getSubject(userId, subjectId);
}

export async function deleteSubject(userId: number, subjectId: number) {
	return inTransaction(async (connection) => {
		
		const [subjects] = await connection.execute<RowDataPacket[]>(
			`SELECT id FROM subjects WHERE id = ? AND user_id = ? FOR UPDATE`,
			[subjectId, userId],
		);

		if (subjects.length === 0) {
			throw new HttpError(404, "SUBJECT_NOT_FOUND", "Predmet nije pronađen.");
		}

		const [counts] = await connection.execute<RowDataPacket[]>(
			`SELECT COUNT(*) AS count FROM tasks WHERE subject_id = ?`,
			[subjectId],
		);

		
		await connection.execute(`DELETE FROM subjects WHERE id = ?`, [subjectId]);

		return { deletedTasks: counts[0]!.count as number };
	});
}
