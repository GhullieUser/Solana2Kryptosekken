// src/lib/tokenMap.ts
export type TokenHint = { symbol: string; decimals: number };

export const TOKEN_HINTS: Record<string, TokenHint> = {
	// Stablecoins / majors
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
	So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
	// Common tokens (extend freely)
	JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: { symbol: "JUP", decimals: 6 },
	DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", decimals: 5 },
	DGXSgA3UGZ92x9RLkG9ZHzk4VXwx6zbdMwsbCq7qp7bX: { symbol: "PYTH", decimals: 6 },
	"4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
		symbol: "RAY",
		decimals: 6,
	},
	orcaEKTdK7LKz57vaAYr9QeAwaQfG8Wuc3gw5cQRFPr: { symbol: "ORCA", decimals: 6 },
};

export function hintFor(mint: string): TokenHint | undefined {
	return TOKEN_HINTS[mint];
}
