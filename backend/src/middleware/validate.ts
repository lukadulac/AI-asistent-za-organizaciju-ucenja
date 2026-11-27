import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

type Source = "params" | "query" | "body";

export function validate(schema: z.ZodType, source: Source = "body") {
	return (req: Request, res: Response, next: NextFunction) => {
		const result = schema.safeParse(req[source]);

		if (!result.success) {
			const { formErrors, fieldErrors } = z.flattenError(result.error);
			return res.status(400).json({
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "Neispravni podaci.",
					details: formErrors.length ? { ...fieldErrors, _errors: formErrors } : fieldErrors,
				},
			});
		}
		if (source === "body") {
			req.body = result.data;
		} else {
			req.validated = { ...req.validated, [source]: result.data };
		}
		next();
	};
}
