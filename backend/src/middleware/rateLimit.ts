import type { Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// Ključ = IP + email: napadač ne može da pogađa lozinku jednog naloga,
// a korisnici iza istog IP-ja (npr. fakultetska mreža) ne blokiraju jedni druge.
// Ide POSLE validate(), pa je email već normalizovan (trim + lowercase).
function ipAndEmailKey(req: Request) {
	const email = typeof req.body?.email === "string" ? req.body.email : "";
	return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
}

function tooManyRequests(_req: Request, res: Response) {
	res.status(429).json({
		success: false,
		error: {
			code: "TOO_MANY_REQUESTS",
			message: "Previše pokušaja. Pokušajte ponovo kasnije.",
		},
	});
}

// Brojač je u memoriji: resetuje se pri restartu servera i važi samo za jedan proces
const common = {
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: ipAndEmailKey,
	handler: tooManyRequests,
} as const;

// Login: broje se samo neuspešni pokušaji (status >= 400)
export const loginLimiter = rateLimit({
	...common,
	windowMs: 15 * 60 * 1000,
	limit: 10,
	skipSuccessfulRequests: true,
});

// Forgot password: svaki zahtev šalje mejl, pa se broje svi
export const forgotPasswordLimiter = rateLimit({
	...common,
	windowMs: 60 * 60 * 1000,
	limit: 5,
});
