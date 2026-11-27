import {z} from "zod";

export const subjectBodySchema = z.strictObject({
    name: z.string({ error: "Naziv predmeta je obavezan." }).trim().min(1, "Naziv predmeta je obavezan.").max(100, "Naziv predmeta ne sme biti duži od 100 karaktera."),
})