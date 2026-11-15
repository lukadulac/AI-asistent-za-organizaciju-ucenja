import { z } from "zod";

const emailField = z
	.string()
	.trim()
	.toLowerCase()
	.min(1, { message: "Email je obavezan." })
	.pipe(z.email({ message: "Email nije validan." }));

export const registerSchema = z.object({
	email: emailField,
	password: z
		.string()
		.min(8, { message: "Lozinka mora imati najmanje 8 karaktera." })
		.max(72, { message: "Lozinka ne sme biti duža od 72 karaktera." }),
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