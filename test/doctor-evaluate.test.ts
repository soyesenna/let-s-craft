import { describe, expect, it } from "vitest";
import { computeExit, type DoctorObservations, evaluateFindings, type Finding } from "../src/doctor";

// ===========================================================================
// deferred-pool C (/lsc-doctor) — AC7/8 (PURE parts only). plan Step 6, D6.
// The runner is split observe(effect) / evaluate(pure) / exit(pure):
//   collectObservations(observePorts) -> DoctorObservations   (effect — TestIntegration owns)
//   evaluateFindings(observations)    -> Finding[]            (PURE — this file)
//   computeExit(findings)             -> number               (PURE — this file)
//   runDoctor(ports)                  -> DoctorReport          (orchestration — TestIntegration
//                                        owns ports/hang/timeout/table/adapter capture)
//
//   Finding = { id, status: "PASS"|"WARN"|"FAIL"|"UNKNOWN", evidence, remediation? }
//   The 8 check ids (physical SSOT, per plan Step 6):
//     "dist-drift"  "plugin-link"  "agents-frontmatter"  "models-yaml"
//     "orphan-worktree"  "stale-craft-state"  "gitignore-registration"  "skill-path-drift"(R0)
//   Logical exit (N2): FAIL >= 1 -> 1, else 0 (WARN / UNKNOWN / PASS never fail the exit).
//
// DoctorObservations is INJECTED here (evaluate is pure — no fs, no exec, no SDK), so this file
// stays read-only by construction: it only maps observed facts to a status per check.
//
// PRE-CRAFT RED (test-first): src/doctor.ts does NOT exist yet — this whole file is import-shaped
// RED (module resolution fails at load) until craft (plan Step 6) writes the module. That is the
// correct, expected test-first outcome (release-gate import-RED precedent).
// ===========================================================================

/** An all-PASS observation set (every check healthy). Each test overrides exactly one sub-field so
 * exactly one check changes status and the rest stay PASS — isolating the check under test. */
function healthy(): DoctorObservations {
	// The physical 9-agent SSOT (spec §C 제약 5): name/description required, tools/spawns/thinkingLevel
	// optional. A mix of files carry optional fields and a mix carry none — a healthy repo passes either
	// way. This is the SAME healthy repo shape doctor-adapters.test.ts's healthyPorts() returns, so the
	// two layers judge the same observation identically (fixture-semantics parity).
	const files = [
		{ path: "agents/lsc-explore.md", name: "lsc-explore", description: "read-only search specialist", tools: "read, grep, glob, bash, lsp" },
		{ path: "agents/lsc-executor.md", name: "lsc-executor", description: "focused task executor", spawns: "lsc-explore, lsc-architect" },
		{ path: "agents/lsc-critic.md", name: "lsc-critic", description: "reviews a plan/diff for flaws", tools: "read, grep, glob, bash, lsp" },
		{ path: "agents/lsc-critic-recheck.md", name: "lsc-critic-recheck", description: "diff-only AWC re-check", tools: "read, grep, glob", thinkingLevel: "medium" },
		{ path: "agents/lsc-architect.md", name: "lsc-architect", description: "architecture + debugging advisor", tools: "read, grep, glob", spawns: "lsc-critic" },
		{ path: "agents/lsc-planner.md", name: "lsc-planner", description: "spec into an actionable plan", tools: "read, write, edit", spawns: "lsc-explore" },
		{ path: "agents/lsc-librarian.md", name: "lsc-librarian", description: "external library/API research", tools: "read, grep, glob, web_search" },
		{ path: "agents/lsc-tracer.md", name: "lsc-tracer", description: "causal why-tracer" },
		{ path: "agents/lsc-test-engineer.md", name: "lsc-test-engineer", description: "test strategy + TDD enforcement" },
	];
	return {
		distDrift: { srcHashMatches: true, buildInfoMatches: true },
		pluginLink: { loadedAtRuntime: false, linked: true },
		agents: { files, readmeDocumentedCount: files.length },
		modelsYaml: { valid: true, errors: [] },
		worktrees: [{ path: "/srv/proj/.lsc/worktrees/live", head: "abc", branch: "refs/heads/lets-craft/live" }],
		craftStates: [{ feature: "live", worktreeExists: true, stateParsed: true }],
		gitignore: { worktreesIgnored: true },
		skillLiterals: [{ skill: "skills/pre-craft/SKILL.md", literal: ".lsc/worktrees/{feature}", expected: ".lsc/worktrees/{feature}" }],
	};
}

/** Status of a single check by id — the evaluate+lookup pattern every per-check test shares. */
function statusOf(observations: DoctorObservations, id: string): Finding["status"] | undefined {
	return evaluateFindings(observations).find(f => f.id === id)?.status;
}

/** A finding fixture for the pure computeExit tests (id/evidence are irrelevant to the exit rule). */
function mkFinding(status: Finding["status"]): Finding {
	return { id: `check-${status}`, status, evidence: "n/a" };
}

/** Build a single agent-file observation carrying extra (possibly malformed) frontmatter fields. The
 * observe layer carries the RAW parsed frontmatter, so a real malformed file may hold any YAML value in
 * an optional field — the cast models exactly that, letting the pure evaluate reject a schema violation. */
function agentFile(extra: Record<string, unknown>): DoctorObservations["agents"]["files"][number] {
	return { path: "agents/lsc-explore.md", name: "lsc-explore", description: "read-only search specialist", ...extra } as DoctorObservations["agents"]["files"][number];
}

describe("evaluateFindings — a healthy repo shape", () => {
	it("emits exactly one finding per check (8) and they are all PASS", () => {
		const findings = evaluateFindings(healthy());

		expect(findings).toHaveLength(8);
		expect(findings.every(f => f.status === "PASS")).toBe(true);
	});
});

describe("evaluateFindings — dist<->src drift (srcHash is canonical)", () => {
	it("FAILs when the src hash does not match the manifest", () => {
		expect(statusOf({ ...healthy(), distDrift: { srcHashMatches: false, buildInfoMatches: true } }, "dist-drift")).toBe("FAIL");
	});

	it("PASSes when the src hash matches even if BUILD_INFO is stale (srcHash canonical)", () => {
		expect(statusOf({ ...healthy(), distDrift: { srcHashMatches: true, buildInfoMatches: false } }, "dist-drift")).toBe("PASS");
	});
});

describe("evaluateFindings — plugin link", () => {
	it("reports UNKNOWN when the plugin is loaded at runtime (can't be checked in-process, exit-neutral)", () => {
		expect(statusOf({ ...healthy(), pluginLink: { loadedAtRuntime: true, linked: true } }, "plugin-link")).toBe("UNKNOWN");
	});

	it("FAILs when the plugin is not linked and is not loaded at runtime (broken installation)", () => {
		expect(statusOf({ ...healthy(), pluginLink: { loadedAtRuntime: false, linked: false } }, "plugin-link")).toBe("FAIL");
	});
});

describe("evaluateFindings — agents frontmatter (physical files are the SSOT)", () => {
	it("FAILs when a physical agent file is missing a required field (name/description)", () => {
		const badAgents = {
			files: [{ path: "agents/lsc-explore.md", name: "lsc-explore" /* description missing */ }],
			readmeDocumentedCount: 1,
		};

		expect(statusOf({ ...healthy(), agents: badAgents }, "agents-frontmatter")).toBe("FAIL");
	});

	it("WARNs (stale docs) when README documents a different agent count than physically exists", () => {
		const base = healthy();
		const mismatched = { files: base.agents.files, readmeDocumentedCount: base.agents.files.length - 1 };

		expect(statusOf({ ...base, agents: mismatched }, "agents-frontmatter")).toBe("WARN");
	});

	it("FAILs when the optional thinkingLevel is not a recognized level (low|medium|high)", () => {
		const obs = { ...healthy(), agents: { files: [agentFile({ thinkingLevel: "turbo" })], readmeDocumentedCount: 1 } };
		expect(statusOf(obs, "agents-frontmatter")).toBe("FAIL");
	});

	it("FAILs when the optional tools field violates its schema (wrong type)", () => {
		const obs = { ...healthy(), agents: { files: [agentFile({ tools: 42 })], readmeDocumentedCount: 1 } };
		expect(statusOf(obs, "agents-frontmatter")).toBe("FAIL");
	});

	it("FAILs when the optional spawns field violates its schema (wrong type)", () => {
		const obs = { ...healthy(), agents: { files: [agentFile({ spawns: { nested: true } })], readmeDocumentedCount: 1 } };
		expect(statusOf(obs, "agents-frontmatter")).toBe("FAIL");
	});
});

describe("evaluateFindings — models.yaml", () => {
	it("FAILs when the models file fails validation", () => {
		expect(statusOf({ ...healthy(), modelsYaml: { valid: false, errors: ["duplicate preset id"] } }, "models-yaml")).toBe("FAIL");
	});
});

describe("evaluateFindings — orphan worktree (prunable)", () => {
	it("WARNs and cites the prunable reason when a worktree is prunable", () => {
		const findings = evaluateFindings({
			...healthy(),
			worktrees: [{ path: "/srv/proj/.lsc/worktrees/gone", prunable: "gitdir file points to non-existent location" }],
		});
		const finding = findings.find(f => f.id === "orphan-worktree");

		expect(finding?.status).toBe("WARN");
		expect(finding?.evidence).toContain("gitdir file points to non-existent location");
	});
});

describe("evaluateFindings — stale craft-state (2 conditions, R9: unclosed-open-release condition retired with openRelease)", () => {
	it("WARNs when the state's worktree directory is missing", () => {
		const obs = { ...healthy(), craftStates: [{ feature: "f", worktreeExists: false, stateParsed: true }] };
		expect(statusOf(obs, "stale-craft-state")).toBe("WARN");
	});

	it("WARNs when the state file cannot be parsed", () => {
		const obs = { ...healthy(), craftStates: [{ feature: "f", worktreeExists: true, stateParsed: false }] };
		expect(statusOf(obs, "stale-craft-state")).toBe("WARN");
	});
});

describe("evaluateFindings — gitignore registration (read-only)", () => {
	it("FAILs when .lsc/worktrees is not gitignored", () => {
		expect(statusOf({ ...healthy(), gitignore: { worktreesIgnored: false } }, "gitignore-registration")).toBe("FAIL");
	});
});

describe("evaluateFindings — R0 skill path-literal drift", () => {
	it("FAILs when a SKILL.md path literal diverges from the paths.ts-derived expectation", () => {
		const findings = evaluateFindings({
			...healthy(),
			skillLiterals: [{ skill: "skills/pre-craft/SKILL.md", literal: ".lsc/worktrees/WRONG", expected: ".lsc/worktrees/{feature}" }],
		});
		const finding = findings.find(f => f.id === "skill-path-drift");

		expect(finding?.status).toBe("FAIL");
		expect(finding?.evidence).toContain(".lsc/worktrees/{feature}");
	});
});

describe("computeExit — logical exit code (pure)", () => {
	it("returns 1 when any finding is FAIL", () => {
		expect(computeExit([mkFinding("PASS"), mkFinding("WARN"), mkFinding("FAIL")])).toBe(1);
	});

	it("returns 0 for a WARN-only report", () => {
		expect(computeExit([mkFinding("PASS"), mkFinding("WARN")])).toBe(0);
	});

	it("returns 0 for an all-PASS report", () => {
		expect(computeExit([mkFinding("PASS"), mkFinding("PASS")])).toBe(0);
	});

	it("returns 0 for an UNKNOWN-only (timeout/plugin) report", () => {
		expect(computeExit([mkFinding("PASS"), mkFinding("UNKNOWN"), mkFinding("WARN")])).toBe(0);
	});

	it("returns 0 for an empty report", () => {
		expect(computeExit([])).toBe(0);
	});

	it("drives the exit of a fully healthy report to 0 and a gitignore-FAIL report to 1", () => {
		expect(computeExit(evaluateFindings(healthy()))).toBe(0);
		expect(computeExit(evaluateFindings({ ...healthy(), gitignore: { worktreesIgnored: false } }))).toBe(1);
	});
});
