import * as zod from "zod/v4";
import { describe, expect, it } from "vitest";
import { registerAskTools } from "../src/ask";

interface SafeParseResult {
	success: boolean;
	data?: unknown;
}

interface CapturedParameters {
	safeParse(value: unknown): SafeParseResult;
}

interface CapturedToolDefinition {
	name: string;
	parameters: CapturedParameters;
}

function isCapturedToolDefinition(value: unknown): value is CapturedToolDefinition {
	if (typeof value !== "object" || value === null || !("name" in value) || !("parameters" in value)) return false;
	const parameters = value.parameters;
	return (
		typeof value.name === "string" &&
		typeof parameters === "object" &&
		parameters !== null &&
		"safeParse" in parameters &&
		typeof parameters.safeParse === "function"
	);
}

function captureAskToolDefinitions(): CapturedToolDefinition[] {
	const captured: CapturedToolDefinition[] = [];
	const mockPi = {
		zod,
		registerTool(definition: unknown): void {
			if (!isCapturedToolDefinition(definition)) throw new Error("registerAskTools registered a tool without a name or safeParse schema");
			captured.push(definition);
		},
	};

	// This test double intentionally supplies only the two registration-time ExtensionAPI members used by registerAskTools.
	registerAskTools(mockPi as unknown as Parameters<typeof registerAskTools>[0]);
	return captured;
}

const capturedTools = captureAskToolDefinitions();

function toolNamed(name: string): CapturedToolDefinition {
	const definition = capturedTools.find(candidate => candidate.name === name);
	if (!definition) throw new Error(`expected registerAskTools to register ${name}`);
	return definition;
}

function option(label: string): { label: string; description: string } {
	return { label, description: `${label} is a concrete choice with a balanced rationale.` };
}

function validSelectParams(count = 2): { question: string; options: Array<{ label: string; description: string }> } {
	return {
		question: "Choose a path",
		options: Array.from({ length: count }, (_, index) => option(`Option ${index + 1}`)),
	};
}

describe("registerAskTools schema capture", () => {
	// plan §2 Step 1-A/§3 AC1/§4 DR-D7: mock-pi catcher는 등록 순서와 무관하게 정확히 세 ask seam tool을 관측한다.
	it("registers lsc_ask, lsc_select, and lsc_confirm", () => {
		const names = capturedTools.map(definition => definition.name);
		expect(names).toHaveLength(3);
		expect(names).toEqual(expect.arrayContaining(["lsc_ask", "lsc_select", "lsc_confirm"]));
	});

	// plan §3 AC1/§4 DR-D7: lsc_select parameters는 옵션 1개를 zod 경계에서 거부한다.
	it("lsc_select rejects one option", () => {
		expect(toolNamed("lsc_select").parameters.safeParse(validSelectParams(1)).success).toBe(false);
	});

	// plan §3 AC1/§4 DR-D7: lsc_select parameters는 옵션 5개를 zod 경계에서 거부한다.
	it("lsc_select rejects five options", () => {
		expect(toolNamed("lsc_select").parameters.safeParse(validSelectParams(5)).success).toBe(false);
	});

	// plan §3 AC1/§4 DR-D7: lsc_select parameters는 하한인 옵션 2개를 허용한다.
	it("lsc_select accepts two options", () => {
		expect(toolNamed("lsc_select").parameters.safeParse(validSelectParams(2)).success).toBe(true);
	});

	// plan §3 AC1/§4 DR-D7: lsc_select parameters는 상한인 옵션 4개를 허용한다.
	it("lsc_select accepts four options", () => {
		expect(toolNamed("lsc_select").parameters.safeParse(validSelectParams(4)).success).toBe(true);
	});

	// plan §2 Step 1-A/§3 AC1: option.description은 required field다.
	it("lsc_select rejects an option without description", () => {
		const params = {
			question: "Choose a path",
			options: [{ label: "Option 1" }, option("Option 2")],
		};
		expect(toolNamed("lsc_select").parameters.safeParse(params).success).toBe(false);
	});

	// plan §2 Step 1-A/§3 AC1: description .min(1)은 exact empty string을 schema에서 거부한다.
	it("lsc_select rejects an empty description", () => {
		const params = validSelectParams();
		params.options[0] = { label: "Option 1", description: "" };
		expect(toolNamed("lsc_select").parameters.safeParse(params).success).toBe(false);
	});

	// plan §2 Step 1-A/§3 AC1: multi는 boolean true를 허용한다.
	it("lsc_select accepts boolean multi", () => {
		expect(toolNamed("lsc_select").parameters.safeParse({ ...validSelectParams(), multi: true }).success).toBe(true);
	});

	// plan §2 Step 1-A/§3 AC1: multi는 boolean 이외 타입을 거부한다.
	it("lsc_select rejects non-boolean multi", () => {
		expect(toolNamed("lsc_select").parameters.safeParse({ ...validSelectParams(), multi: "true" }).success).toBe(false);
	});

	// plan §2 Step 1-A/§3 AC1: recommended는 zero-based non-negative integer를 허용한다.
	it("lsc_select accepts an integer recommended index", () => {
		expect(toolNamed("lsc_select").parameters.safeParse({ ...validSelectParams(), recommended: 1 }).success).toBe(true);
	});

	// plan §2 Step 1-A/§3 AC1: recommended는 fractional number를 거부한다.
	it("lsc_select rejects a fractional recommended index", () => {
		expect(toolNamed("lsc_select").parameters.safeParse({ ...validSelectParams(), recommended: 0.5 }).success).toBe(false);
	});

	// plan §2 Step 1-A/§3 AC1: recommended는 음수를 거부한다.
	it("lsc_select rejects a negative recommended index", () => {
		expect(toolNamed("lsc_select").parameters.safeParse({ ...validSelectParams(), recommended: -1 }).success).toBe(false);
	});

	// plan §2 Step 1-A/§3 AC1/AC5: lsc_ask schema는 editor prefill을 입력·출력에 보존한다.
	it("lsc_ask accepts and preserves prefill", () => {
		const parsed = toolNamed("lsc_ask").parameters.safeParse({ question: "Explain", prefill: "Initial draft" });
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ question: "Explain", prefill: "Initial draft" });
	});

	// plan §2 Step 1-A/§3 AC1/AC5: 제거된 placeholder는 lsc_ask parsed parameter shape에 남지 않는다.
	it("lsc_ask omits the legacy placeholder field", () => {
		const parsed = toolNamed("lsc_ask").parameters.safeParse({ question: "Explain", placeholder: "legacy hint" });
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ question: "Explain" });
	});

	// plan §2 Step 1-A/§3 AC1/AC5: lsc_ask의 prefill은 optional이다.
	it("lsc_ask accepts a question without prefill", () => {
		expect(toolNamed("lsc_ask").parameters.safeParse({ question: "Explain" }).success).toBe(true);
	});

	// plan §2 Step 1-A/§3 AC1/AC4: lsc_confirm schema는 question-only 호출을 허용한다.
	it("lsc_confirm accepts its question parameter", () => {
		const parsed = toolNamed("lsc_confirm").parameters.safeParse({ question: "Proceed?" });
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ question: "Proceed?" });
	});

	// plan §2 Step 1-A/§3 AC1/AC4: lsc_confirm schema는 question 누락을 거부한다.
	it("lsc_confirm rejects a missing question", () => {
		expect(toolNamed("lsc_confirm").parameters.safeParse({}).success).toBe(false);
	});
});
