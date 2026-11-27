import express from "express";
import helmet from "helmet";
import cors from "cors";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { pool } from "./db/pool.js";
import { env } from "./config/env.js";
import { authRouter } from "./auth/auth.routes.js";
import { adminRouter } from "./admin/admin.routes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole } from "./middleware/requireRole.js";
import { subjectsRouter } from "./subjects/subjects.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/v1/health", async (req, res) => {
	try {
		await pool.query("SELECT 1");
		res.json({ success: true, data: { status: "ok", db: "up" } });
	} catch (error) {
		console.error("Health check failed:", error);
		res.status(503).json({
			success: false,
			error: { code: "DB_UNAVAILABLE", message: "Baza trenutno nije dostupna." },
		});
	}
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/subjects", subjectsRouter)
// Ne-admin dobija 403 za bilo koju /admin putanju, pre nego što se proveri da li ruta postoji
app.use("/api/v1/admin", requireAuth, requireRole("admin"), adminRouter);
app.use(notFound);
app.use(errorHandler);
