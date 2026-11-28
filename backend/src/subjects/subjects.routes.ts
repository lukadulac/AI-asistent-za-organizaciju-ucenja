import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { subjectBodySchema } from "./subjects.schemas.js";
import {
	createSubject,
	listSubjects,
	getSubject,
	updateSubject,
	deleteSubject,
} from "./subjects.service.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { idParamSchema } from "../utils/schemas.js";

export const subjectsRouter = Router();
subjectsRouter.use(requireAuth);

subjectsRouter.post("/", validate(subjectBodySchema), async (req, res) => {
	const subject = await createSubject(req.user!.userId, req.body.name);

	return res.status(201).json({
		success: true,
		data: { subject },
	});
});

subjectsRouter.get("/", async (req, res) => {
	const subjects = await listSubjects(req.user!.userId);

	return res.json({
		success: true,
		data: { subjects },
	});
});

subjectsRouter.get("/:id",validate(idParamSchema, "params"), async (req, res) => {
		const { id } = req.validated!.params as { id: number };
		const subject = await getSubject(req.user!.userId, id);

		return res.json({
			success: true,
			data: { subject },
		});
	},
);

subjectsRouter.patch("/:id",validate(idParamSchema, "params"),validate(subjectBodySchema),async (req, res) => {
		const { id } = req.validated!.params as { id: number };
		const subject = await updateSubject(req.user!.userId, id, req.body.name);

		return res.json({
			success: true,
			data: { subject },
		});
	},
);

subjectsRouter.delete("/:id", validate(idParamSchema, "params"), async(req, res) => {
	const { id } = req.validated!.params as { id: number };
	const result = await deleteSubject(req.user!.userId, id);

	return res.json({
		success: true,
		data: result,
	});
});