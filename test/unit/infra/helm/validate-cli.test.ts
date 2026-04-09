import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Logger } from "pino";

let mockExecFileAsync: jest.MockedFunction<
	(
		file: string,
		args: string[],
		options?: unknown,
	) => Promise<{ stdout: string; stderr: string }>
>;
let mockExecFileRaw: jest.Mock;
let mockKubectlStdinEnd: jest.Mock;

const promisifiedFunctions = new Map<unknown, "execFile">();

jest.mock("node:child_process", () => {
	const mockExecFileFn = jest.fn();
	mockExecFileRaw = mockExecFileFn;
	promisifiedFunctions.set(mockExecFileFn, "execFile");
	return {
		execFile: mockExecFileFn,
	};
});

jest.mock("node:util", () => {
	const actual = jest.requireActual<typeof import("node:util")>("node:util");
	return {
		...actual,
		promisify: (fn: unknown) => {
			const fnType = promisifiedFunctions.get(fn);
			return (...args: unknown[]) => {
				if (fnType === "execFile") {
					if (!mockExecFileAsync) {
						throw new Error("mockExecFileAsync not initialized");
					}
					return mockExecFileAsync(...(args as [string, string[], unknown?]));
				}
				throw new Error("Unexpected function passed to promisify");
			};
		},
	};
});

jest.mock("@/infra/helm/detect", () => ({
	checkKubectlAvailability: jest.fn(),
}));

import { checkKubectlAvailability } from "@/infra/helm/detect";
import { validateChartWithCli } from "@/infra/helm/validate-cli";

function createExecError(
	message: string,
	fields?: { code?: string; stderr?: string; stdout?: string },
): Error {
	const error = new Error(message) as Error & {
		code?: string;
		stderr?: string;
		stdout?: string;
	};
	if (fields?.code) {
		error.code = fields.code;
	}
	if (fields?.stderr !== undefined) {
		error.stderr = fields.stderr;
	}
	if (fields?.stdout !== undefined) {
		error.stdout = fields.stdout;
	}
	return error;
}

describe("infra/helm/validate-cli", () => {
	let mockLogger: Logger;
	const mockCheckKubectlAvailability = jest.mocked(checkKubectlAvailability);

	beforeEach(() => {
		mockExecFileAsync =
			jest.fn<
				(
					file: string,
					args: string[],
					options?: unknown,
				) => Promise<{ stdout: string; stderr: string }>
			>();
		mockKubectlStdinEnd = jest.fn();

		mockExecFileRaw.mockImplementation((...args: unknown[]) => {
			const callback = args[3] as ((error: Error | null) => void) | undefined;
			callback?.(null);
			return {
				stdin: {
					end: mockKubectlStdinEnd,
				},
			};
		});

		mockCheckKubectlAvailability.mockResolvedValue({
			ok: true,
			value: { available: true, version: "1.29.0" },
		});

		mockLogger = {
			info: jest.fn(),
			debug: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		} as unknown as Logger;

		jest.clearAllMocks();
	});

	describe("helm lint", () => {
		it("parses [ERROR] as block and [WARNING] as warn", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({
					stdout:
						"[ERROR] templates/deployment.yaml: bad field\n[WARNING] values.yaml: unused key\n",
					stderr: "",
				})
				.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-lint-error",
					severity: "block",
					message: expect.stringContaining("[ERROR]"),
					phase: "cli",
					target: "chart",
				}),
				expect.objectContaining({
					ruleId: "helm-lint-warning",
					severity: "warn",
					message: expect.stringContaining("[WARNING]"),
					phase: "cli",
					target: "chart",
				}),
			]);
		});

		it("handles lint timeout (ETIMEDOUT)", async () => {
			mockExecFileAsync
				.mockRejectedValueOnce(
					createExecError("timed out", { code: "ETIMEDOUT" }),
				)
				.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-lint-timeout",
					severity: "warn",
					message: "helm lint timed out after 30000ms.",
				}),
			]);
		});

		it("handles lint failure with parseable output", async () => {
			mockExecFileAsync
				.mockRejectedValueOnce(
					createExecError("lint failed", {
						stderr: "[ERROR] chart invalid\n[WARNING] deprecated API\n",
					}),
				)
				.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toHaveLength(2);
			expect(issues[0]).toEqual(
				expect.objectContaining({
					ruleId: "helm-lint-error",
					severity: "block",
				}),
			);
			expect(issues[1]).toEqual(
				expect.objectContaining({
					ruleId: "helm-lint-warning",
					severity: "warn",
				}),
			);
		});

		it("handles lint failure with unparseable output as generic block error", async () => {
			mockExecFileAsync
				.mockRejectedValueOnce(createExecError("unexpected helm lint crash"))
				.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-lint-error",
					severity: "block",
					message: "unexpected helm lint crash",
				}),
			]);
		});
	});

	describe("helm template", () => {
		it("successful render returns no issues", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: "", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([]);
		});

		it("timeout produces warn", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockRejectedValueOnce(
					createExecError("template timed out", { code: "ETIMEDOUT" }),
				);

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-template-timeout",
					severity: "warn",
					message: "helm template timed out after 30000ms.",
				}),
			]);
		});

		it("missing dependency error produces warn (not block)", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockRejectedValueOnce(
					createExecError("template failed", {
						stderr:
							"Error: found in Chart.yaml, but missing in charts/ directory: redis. Run helm dependency build",
					}),
				);

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-template-missing-deps",
					severity: "warn",
				}),
			]);
		});

		it("other render errors produce block", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockRejectedValueOnce(
					createExecError("render failed", {
						stderr:
							"template: chart/templates/deployment.yaml: malformed mapping",
					}),
				);

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-template-render-error",
					severity: "block",
				}),
			]);
		});
	});

	describe("kubectl dry-run", () => {
		it("is skipped when template output is empty", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: "   \n", stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([]);
			expect(mockCheckKubectlAvailability).not.toHaveBeenCalled();
			expect(mockExecFileRaw).not.toHaveBeenCalled();
		});

		it("is skipped when kubectl is not available", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({
					stdout: "apiVersion: v1\nkind: ConfigMap\n",
					stderr: "",
				});
			mockCheckKubectlAvailability.mockResolvedValueOnce({
				ok: false,
				error: "kubectl not found in PATH",
			});

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([]);
			expect(mockCheckKubectlAvailability).toHaveBeenCalledTimes(1);
			expect(mockExecFileRaw).not.toHaveBeenCalled();
		});

		it("success produces no issues and pipes template output to stdin", async () => {
			const rendered =
				"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n";
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: rendered, stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([]);
			expect(mockExecFileRaw).toHaveBeenCalledWith(
				"kubectl",
				["apply", "--dry-run=client", "-f", "-"],
				{ timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
				expect.any(Function),
			);
			expect(mockKubectlStdinEnd).toHaveBeenCalledWith(rendered);
		});

		it("failure produces warn", async () => {
			const rendered = "apiVersion: v1\nkind: ConfigMap\n";
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: rendered, stderr: "" });

			mockExecFileRaw.mockImplementationOnce((...args: unknown[]) => {
				const callback = args[3] as ((error: Error | null) => void) | undefined;
				callback?.(
					createExecError("kubectl failed", {
						stderr: "error validating data",
					}),
				);
				return {
					stdin: {
						end: mockKubectlStdinEnd,
					},
				};
			});

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-kubectl-dryrun-error",
					severity: "warn",
					message: "error validating data",
				}),
			]);
			expect(mockKubectlStdinEnd).toHaveBeenCalledWith(rendered);
		});

		it("timeout produces warn", async () => {
			const rendered = "apiVersion: v1\nkind: Service\n";
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: rendered, stderr: "" });

			mockExecFileRaw.mockImplementationOnce((...args: unknown[]) => {
				const callback = args[3] as ((error: Error | null) => void) | undefined;
				callback?.(createExecError("kubectl timeout", { code: "ETIMEDOUT" }));
				return {
					stdin: {
						end: mockKubectlStdinEnd,
					},
				};
			});

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-kubectl-dryrun-error",
					severity: "warn",
					message: "kubectl dry-run timed out after 15000ms.",
				}),
			]);
		});
	});

	describe("end-to-end flow", () => {
		it("clean chart with all tools available produces no issues", async () => {
			const rendered = "apiVersion: v1\nkind: ConfigMap\n";
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
				.mockResolvedValueOnce({ stdout: rendered, stderr: "" });

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([]);
			expect(mockCheckKubectlAvailability).toHaveBeenCalledTimes(1);
			expect(mockKubectlStdinEnd).toHaveBeenCalledWith(rendered);
		});

		it("collects multiple issues from different phases", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({
					stdout: "[WARNING] lint warning one\n",
					stderr: "[ERROR] lint hard failure\n",
				})
				.mockRejectedValueOnce(
					createExecError("template dependency error", {
						stderr: "dependencies missing. please run helm dependency build",
					}),
				);

			const issues = await validateChartWithCli(
				"/tmp/chart",
				"3.14.0",
				mockLogger,
			);

			expect(issues).toEqual([
				expect.objectContaining({
					ruleId: "helm-lint-warning",
					severity: "warn",
				}),
				expect.objectContaining({
					ruleId: "helm-lint-error",
					severity: "block",
				}),
				expect.objectContaining({
					ruleId: "helm-template-missing-deps",
					severity: "warn",
				}),
			]);
		});
	});
});
