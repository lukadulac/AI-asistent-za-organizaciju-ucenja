import { z } from "zod";

export const idParamSchema = z.object({
    id: z
        .string()
        .regex(/^[1-9]\d*$/, "ID mora biti ceo pozitivan broj.")
        .transform((val) => parseInt(val, 10))
        
});