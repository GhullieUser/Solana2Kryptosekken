// src/lib/programMap.ts

/** Human-friendly labels for known program IDs (local registry). */
export const PROGRAM_LABELS: Record<string, string> = {
	// Pumpkin Staking
	"7WFoBLi5jzY5hhxDvFSz4viDeoNhvNyY22zXGSHN8o8L": "Pumpkin Staking"
};

export function programLabelFor(programId?: string): string | undefined {
	if (!programId) return undefined;
	return PROGRAM_LABELS[programId];
}
