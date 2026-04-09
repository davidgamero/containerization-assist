import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "pino";
import { parseVersion } from "@/infra/security/scanner-common";
import { Failure, type Result, Success } from "@/types";
import { HELM_TIMEOUTS, MIN_HELM_VERSION, type ToolInfo } from "./types";

const execFileAsync = promisify(execFile);

let cachedHelm: ToolInfo | undefined;
let cachedKubectl: ToolInfo | undefined;

function satisfiesMinVersion(version: string, minVersion: string): boolean {
	const parts = version.split(".").map(Number);
	const minParts = minVersion.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const v = parts[i] ?? 0;
		const m = minParts[i] ?? 0;
		if (v > m) return true;
		if (v < m) return false;
	}
	return true;
}

export async function checkHelmAvailability(
	logger: Logger,
): Promise<Result<ToolInfo>> {
	if (cachedHelm !== undefined) {
		return cachedHelm.available
			? Success(cachedHelm)
			: Failure("Helm CLI not available");
	}

	try {
		const { stdout } = await execFileAsync("helm", ["version", "--short"], {
			timeout: HELM_TIMEOUTS.versionCheck,
		});
		// helm version --short outputs e.g. "v3.14.0+g3fc9f4b" or "v4.0.0"
		const version = parseVersion(stdout, /v?(\d+\.\d+\.\d+)/);
		if (!version) {
			logger.debug({ stdout }, "Could not parse Helm version");
			cachedHelm = { available: false };
			return Failure("Could not parse Helm version");
		}

		if (!satisfiesMinVersion(version, MIN_HELM_VERSION)) {
			logger.info(
				{ version, required: MIN_HELM_VERSION },
				"Helm version too old",
			);
			cachedHelm = { available: false, version };
			return Failure(
				`Helm ${version} is below minimum required ${MIN_HELM_VERSION}`,
			);
		}

		cachedHelm = { available: true, version };
		logger.debug({ version }, "Helm CLI detected");
		return Success(cachedHelm);
	} catch {
		cachedHelm = { available: false };
		return Failure("Helm CLI not found in PATH");
	}
}

export async function checkKubectlAvailability(
	logger: Logger,
): Promise<Result<ToolInfo>> {
	if (cachedKubectl !== undefined) {
		return cachedKubectl.available
			? Success(cachedKubectl)
			: Failure("kubectl not available");
	}

	try {
		const { stdout } = await execFileAsync(
			"kubectl",
			["version", "--client", "--short"],
			{
				timeout: HELM_TIMEOUTS.versionCheck,
			},
		);
		const version = parseVersion(stdout, /v?(\d+\.\d+\.\d+)/);
		cachedKubectl = version
			? { available: true, version }
			: { available: true };
		logger.debug({ version }, "kubectl detected");
		return Success(cachedKubectl);
	} catch {
		// kubectl version --client --short may fail on newer versions; try alternative
		try {
			const { stdout } = await execFileAsync(
				"kubectl",
				["version", "--client", "-o", "json"],
				{
					timeout: HELM_TIMEOUTS.versionCheck,
				},
			);
			const parsed = JSON.parse(stdout) as {
				clientVersion?: { gitVersion?: string };
			};
			const version = parseVersion(
				parsed?.clientVersion?.gitVersion ?? "",
				/v?(\d+\.\d+\.\d+)/,
			);
			cachedKubectl = version
				? { available: true, version }
				: { available: true };
			logger.debug({ version }, "kubectl detected (json output)");
			return Success(cachedKubectl);
		} catch {
			cachedKubectl = { available: false };
			return Failure("kubectl not found in PATH");
		}
	}
}

export function resetDetectionCache(): void {
	cachedHelm = undefined;
	cachedKubectl = undefined;
}
