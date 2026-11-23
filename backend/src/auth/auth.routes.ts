import { Router, type Request } from "express";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { forgotPasswordLimiter, loginLimiter } from "../middleware/rateLimit.js";
import { HttpError } from "../utils/HttpError.js";
import {
	registerSchema,
	resendActivationSchema,
	loginSchema,
	refreshSchema,
	forgotPasswordSchema,
	resetPasswordSchema,
	changePasswordSchema,
} from "./auth.schemas.js";
import {
	activateUser,
	registerUser,
	resendActivation,
	loginUser,
	refreshSession,
	logout,
	getCurrentUser,
	requestPasswordReset,
	resetPassword,
	changePassword,
} from "./auth.service.js";

export const authRouter = Router();

// Ide u refresh_tokens.device_info (kolona je VARCHAR(255))
function deviceInfo(req: Request) {
	return req.get("user-agent")?.slice(0, 255) ?? null;
}

authRouter.post("/register", validate(registerSchema), async (req, res) => {
	const user = await registerUser(req.body);

	return res.status(201).json({
		success: true,
		data: { user },
	});
});

// Otvara se iz mejla u browseru, pa vraća HTML umesto JSON-a
authRouter.get("/activate", async (req, res) => {
	const token = req.query.token;

	if (typeof token !== "string") {
		return res
			.status(400)
			.send(page("Aktivacija nije uspela", "Link je neispravan."));
	}

	try {
		await activateUser(token);
		res.send(
			page("Nalog aktiviran ✅", "Možete se vratiti u aplikaciju i prijaviti."),
		);
	} catch (err) {
		if (err instanceof HttpError) {
			return res
				.status(err.status)
				.send(page("Aktivacija nije uspela", err.message));
		}
		throw err;
	}
});

function page(title: string, message: string) {
	return `<!doctype html><html lang="sr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:0 16px;text-align:center">
<h1>${title}</h1><p>${message}</p></body></html>`;
}

authRouter.post(
	"/resend-activation",
	validate(resendActivationSchema),
	async (req, res) => {
		await resendActivation(req.body.email);

		res.json({
			success: true,
			data: {
				message: "Ako nalog postoji i nije aktiviran, poslali smo novi link.",
			},
		});
	},
);

authRouter.post("/login", validate(loginSchema), loginLimiter, async (req, res) => {
	const result = await loginUser(
		req.body.email,
		req.body.password,
		deviceInfo(req),
	);
	return res.status(200).json({
		success: true,
		data: { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken },
	});
});

authRouter.post("/refresh", validate(refreshSchema), async (req, res) => {
	const tokens = await refreshSession(req.body.refreshToken, deviceInfo(req));
	res.json({ success: true, data: tokens });
});

// Uvek 200: odjava ne otkriva da li je token postojao
authRouter.post("/logout", validate(refreshSchema), async (req, res) => {
	await logout(req.body.refreshToken);
	res.json({ success: true, data: { message: "Odjavljeni ste." } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
	const user = await getCurrentUser(req.user!.userId);
	res.json({ success: true, data: { user } });
});

authRouter.patch(
	"/me/password",
	requireAuth,
	validate(changePasswordSchema),
	async (req, res) => {
		// Klijent mora da zameni oba tokena: stari refresh token je opozvan
		const tokens = await changePassword(
			req.user!.userId,
			req.body.currentPassword,
			req.body.newPassword,
			deviceInfo(req),
		);
		res.json({
			success: true,
			data: {
				message: "Lozinka je promenjena. Ostali uređaji su odjavljeni.",
				...tokens,
			},
		});
	},
);

authRouter.post(
	"/forgot-password",
	validate(forgotPasswordSchema),
	forgotPasswordLimiter,
	async (req, res) => {
		await requestPasswordReset(req.body.email);
		res.json({
			success: true,
			data: {
				message: "Ako nalog postoji, poslali smo link za resetovanje lozinke.",
			},
		});
	},
);

authRouter.post(
	"/reset-password",
	validate(resetPasswordSchema),
	async (req, res) => {
		await resetPassword(req.body.token, req.body.password);
		res.json({
			success: true,
			data: { message: "Lozinka je promenjena. Prijavite se novom lozinkom." },
		});
	},
);
