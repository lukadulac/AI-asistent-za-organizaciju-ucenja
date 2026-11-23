import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type UserRole = "user" | "admin";

export function signAccessToken(userId: number, role: UserRole) {
	return jwt.sign({ role }, env.JWT_SECRET, {
		subject: String(userId),
		expiresIn: "15m",
	});
}

export function verifyAccessToken(token: string) {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: UserRole };
    return { userId: Number(payload.sub), role: payload.role };
}