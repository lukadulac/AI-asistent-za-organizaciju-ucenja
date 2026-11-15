import type { UserRole } from "../utils/jwt.js";

declare global {
	namespace Express {
		interface Request {
			// Postavlja requireAuth
			user?: { userId: number; role: UserRole };
		}
	}
}
