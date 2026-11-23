import { Router } from "express";

// Admin rute: u app.ts su iza requireAuth + requireRole("admin"),
// pa svaka ruta ovde podrazumeva prijavljenog admina.
// Admin se prijavljuje istim /auth/login kao i korisnik; u aplikaciji radi kao običan korisnik.
export const adminRouter = Router();

// TODO: GET /access-logs (pregled evidencije pristupa)
