import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/HttpError.js";
import type { UserRole } from "../utils/jwt.js";

// Ide POSLE requireAuth. Uloga se čita iz baze, ne iz JWT-a: ako admin izgubi
// ulogu, gubi pristup odmah, a ne tek kad mu istekne access token (15 min).
export function requireRole(role: UserRole) {
	return async (req: Request, _res: Response, next: NextFunction) => {
		if (!req.user) {
			throw new HttpError(401, "UNAUTHORIZED", "Niste prijavljeni.");
		}

		const [rows] = await pool.execute<RowDataPacket[]>(
			"SELECT role FROM users WHERE id = ?",
			[req.user.userId],
		);
		const user = rows[0];
		if (!user) {
			throw new HttpError(401, "UNAUTHORIZED", "Niste prijavljeni.");
		}
		if (user.role !== role) {
			throw new HttpError(403, "FORBIDDEN", "Nemate pristup ovoj stranici.");
		}
		next();
	};
}
