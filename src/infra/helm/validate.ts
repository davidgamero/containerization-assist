import * as fs from "node:fs/promises";
import type { Logger } from "pino";
import {
	checkHelmAvailability,
	checkKubectlAvailability,
} from "@/infra/helm/detect";
import type {
	HelmValidationIssue,
	HelmValidationResult,
} from "@/infra/helm/types";
import { validateChartWithCli } from "@/infra/helm/validate-cli";
import {
	validateChartOnDisk,
	validatePlanShape,
} from "@/infra/helm/validate-static";
import { Failure, type Result, Success } from "@/types";

async function resolveChartPath(chartPath?: string): Promise<Result<string>> {
	if (!chartPath) {
		return Failure("Chart path not provided");
	}
	try {
		const stat = await fs.stat(chartPath);
		if (!stat.isDirectory()) {
			return Failure("Chart path is not a directory");
		}
		return Success(chartPath);
	} catch {
		return Failure("Chart path does not exist");
	}
}

function summarize(
	issues: HelmValidationIssue[],
	helmAvailable: boolean,
	chartOnDisk: boolean,
): string {
	const blockCount = issues.filter((i) => i.severity === "block").length;
	const warnCount = issues.filter((i) => i.severity === "warn").length;
	const suggestCount = issues.filter((i) => i.severity === "suggest").length;

	const parts = [
		`${blockCount} blocking, ${warnCount} warning, ${suggestCount} suggestion issue(s).`,
	];
	if (!helmAvailable) {
		parts.push(
			"Install Helm CLI for enhanced chart validation (lint, template rendering).",
		);
	}
	if (!chartOnDisk) {
		parts.push("Chart validation will run after chart files are created.");
	}
	return parts.join(" ");
}

export async function validateHelm(options: {
	chartPath?: string;
	planFiles: Array<{ path: string; purpose: string }>;
	manifestType: string;
	logger: Logger;
}): Promise<HelmValidationResult> {
	const { chartPath, planFiles, manifestType, logger } = options;
	const issues: HelmValidationIssue[] = [];

	try {
		const planIssues = await validatePlanShape(planFiles, manifestType);
		issues.push(...planIssues);
	} catch (error) {
		logger.debug({ error }, "validatePlanShape failed");
		issues.push({
			ruleId: "helm-plan-validation-failed",
			message: "Plan validation encountered an internal error.",
			severity: "warn",
			phase: "static",
			target: "plan",
		});
	}

	const [helmResult, kubectlResult] = await Promise.all([
		checkHelmAvailability(logger),
		checkKubectlAvailability(logger),
	]);

	const chartPathResult = await resolveChartPath(chartPath);
	const chartOnDisk = chartPathResult.ok;
	if (chartPathResult.ok) {
		try {
			const chartIssues = await validateChartOnDisk(
				chartPathResult.value,
				logger,
			);
			issues.push(...chartIssues);
		} catch (error) {
			logger.debug(
				{ error, chartPath: chartPathResult.value },
				"validateChartOnDisk failed",
			);
			issues.push({
				ruleId: "helm-chart-static-validation-failed",
				message: "Chart static validation encountered an internal error.",
				severity: "warn",
				phase: "static",
				target: "chart",
			});
		}
	}

	let cliRan = false;
	if (
		chartOnDisk &&
		chartPathResult.ok &&
		helmResult.ok &&
		helmResult.value.available &&
		helmResult.value.version
	) {
		cliRan = true;
		try {
			const cliIssues = await validateChartWithCli(
				chartPathResult.value,
				helmResult.value.version,
				logger,
			);
			issues.push(...cliIssues);
		} catch (error) {
			logger.debug(
				{ error, chartPath: chartPathResult.value },
				"validateChartWithCli failed",
			);
			issues.push({
				ruleId: "helm-cli-validation-failed",
				message: "Helm CLI validation encountered an internal error.",
				severity: "warn",
				phase: "cli",
				target: "chart",
			});
		}
	}

	const passed = issues.filter((i) => i.severity === "block").length === 0;

	return {
		passed,
		issues,
		summary: summarize(
			issues,
			helmResult.ok && helmResult.value.available,
			chartOnDisk,
		),
		phasesRun: {
			static: true,
			helmCli: cliRan,
			kubectlDryRun:
				cliRan && kubectlResult.ok && kubectlResult.value.available,
		},
		tooling: {
			helm: helmResult.ok ? helmResult.value : { available: false },
			kubectl: kubectlResult.ok ? kubectlResult.value : { available: false },
		},
		targetsValidated: {
			plan: true,
			chartOnDisk,
		},
	};
}
