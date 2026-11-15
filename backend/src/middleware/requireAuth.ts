import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../utils/HttpError.js";
import { verifyAccessToken } from "../utils/jwt.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
	const header = req.get("authorization");

	if (!header?.startsWith("Bearer ")) {
		throw new HttpError(401, "UNAUTHORIZED", "Niste prijavljeni.");
	}
	const token = header.slice(7);

	try {
		req.user = verifyAccessToken(token);
	} catch (err) {
		// Poseban kod da bi klijent znao da treba da pozove /refresh
		if (err instanceof jwt.TokenExpiredError) {
			throw new HttpError(401, "TOKEN_EXPIRED", "Sesija je istekla.");
		}
		throw new HttpError(401, "INVALID_ACCESS_TOKEN", "Token nije validan.");
	}
	next();
}
