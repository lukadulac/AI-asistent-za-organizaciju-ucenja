import { describe, it, after } from "node:test";
import { api, cleanup, createLoggedInUser, expectError } from "../helpers.js";
import { createSubject } from "./helpers.js";

after(cleanup);

// Svaka ruta predmeta je iza requireAuth
const ENDPOINTS: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "POST", path: "/subjects", body: { name: "Matematika" } },
	{ method: "GET", path: "/subjects" },
	{ method: "GET", path: "/subjects/1" },
	{ method: "PATCH", path: "/subjects/1", body: { name: "Fizika" } },
	{ method: "DELETE", path: "/subjects/1" },
];

describe("Predmeti: autentifikacija", () => {
	for (const { method, path, body } of ENDPOINTS) {
		it(`${method} ${path} bez tokena -> 401 UNAUTHORIZED`, async () => {
			expectError(await api(method, path, { body }), 401, "UNAUTHORIZED");
		});

		it(`${method} ${path} sa neispravnim tokenom -> 401 INVALID_ACCESS_TOKEN`, async () => {
			expectError(await api(method, path, { body, token: "ovo.nije.jwt" }), 401, "INVALID_ACCESS_TOKEN");
		});
	}

	it("auth se proverava pre validacije (neispravan id bez tokena -> 401, ne 400)", async () => {
		expectError(await api("GET", "/subjects/abc"), 401, "UNAUTHORIZED");
	});

	it("auth se proverava pre postojanja resursa (tuđi predmet bez tokena -> 401)", async () => {
		const owner = await createLoggedInUser();
		const subject = await createSubject(owner.accessToken, "Matematika");
		expectError(await api("GET", `/subjects/${subject.id}`), 401, "UNAUTHORIZED");
	});
});
