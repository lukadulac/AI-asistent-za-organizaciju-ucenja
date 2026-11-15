import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { HttpError } from "../utils/HttpError.js";
import {
	registerSchema,
	resendActivationSchema,
	loginSchema,
} from "./auth.schemas.js";
import {
	activateUser,
	registerUser,
	resendActivation,
	loginUser,
} from "./auth.service.js";

export const authRouter = Router();

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

authRouter.post("/login", validate(loginSchema), async (req, res) => {
	const result = await loginUser(req.body.email, req.body.password);
	return res.status(200).json({
		success: true,
		data: { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken },
	});
});
