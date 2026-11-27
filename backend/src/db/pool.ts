import mysql from "mysql2/promise";
import {env} from "../config/env.js";

export const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
	dateStrings: ["DATE"],
})

// Pokreće fn u transakciji: commit ako uspe, rollback ako baci grešku
export const inTransaction = async <T>(fn: (connection: mysql.PoolConnection) => Promise<T>) => {
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const result = await fn(connection);
		await connection.commit();
		return result;
	} catch (error) {
		// Ako i rollback pukne (npr. prekinuta veza), ne sme da sakrije pravu grešku
		await connection.rollback().catch((rollbackErr) => {
			console.error("Rollback failed:", rollbackErr);
		});
		throw error;
	} finally {
		connection.release();
	}
};