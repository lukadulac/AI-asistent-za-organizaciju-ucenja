import { z } from "zod";

const emailField = z
	.string()
	.trim()
	.toLowerCase()
	.min(1, { message: "Email je obavezan." })
	.pipe(z.email({ message: "Email nije validan." }));

// Ista pravila za registraciju, reset i promenu lozinke (bcrypt gleda samo prva 72 bajta)
const passwordField = z
	.string()
	.min(8, { message: "Lozinka mora imati najmanje 8 karaktera." })
	// Bajtovi, ne karakteri: č, ć, ž, š, đ zauzimaju po 2 bajta u UTF-8
	.refine((s) => Buffer.byteLength(s, "utf8") <= 72, {
		message: "Lozinka je predugačka (najviše 72 bajta).",
	});

const tokenField = z.string().min(1, { message: "Token je obavezan." });

export const registerSchema = z.object({
	email: emailField,
	password: passwordField,
	firstName: z
		.string()
		.trim()
		.min(1, { message: "Ime je obavezno." })
		.max(100, { message: "Ime ne sme biti duže od 100 karaktera." }),
	lastName: z
		.string()
		.trim()
		.min(1, { message: "Prezime je obavezno." })
		.max(100, { message: "Prezime ne sme biti duže od 100 karaktera." }),
});
export const resendActivationSchema = z.object({
	email: emailField,
});

export const loginSchema = z.object({
	email: emailField,
	password: z.string().min(1, { message: "Lozinka je obavezna." }),
});

export const refreshSchema = z.object({
	refreshToken: tokenField,
});

export const forgotPasswordSchema = z.object({
	email: emailField,
});

export const resetPasswordSchema = z.object({
	token: tokenField,
	password: passwordField,
});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, { message: "Trenutna lozinka je obavezna." }),
	newPassword: passwordField,
});