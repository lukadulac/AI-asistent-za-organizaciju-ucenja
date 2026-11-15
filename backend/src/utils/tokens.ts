import crypto from "node:crypto";

export function hashToken(token: string) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken() {
	const token = crypto.randomBytes(32).toString("hex");
	return { token, tokenHash: hashToken(token) };
}
