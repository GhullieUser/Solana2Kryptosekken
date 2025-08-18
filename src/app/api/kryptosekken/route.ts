// app/api/kryptosekken/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
	fetchEnhancedTxs,
	fetchTokenMetadataMap,
	fetchJupiterTokenMetadataMap,
	getTokenAccountsByOwner,
	HeliusTx,
	NativeTransfer,
	TokenTransfer
} from "@/lib/helius";
import {
	KSRow,
	rowsToCSV,
	toAmountString,
	toNorwayTimeString,
	currencyCode
} from "@/lib/kryptosekken";
import { hintFor } from "@/lib/tokenMap";

/** Ensure env vars are readable at runtime (no static optimization). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ================= In-memory cache ================= */
type CacheVal = {
	rowsProcessed: KSRow[]; // Notat still starts with "sig:" (we prefix wallet tag on response)
	rawCount: number;
	count: number;
	createdAt: number;
};
const CACHE = new Map<string, CacheVal>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function mkCacheKey(input: {
	address: string;
	fromISO?: string;
	toISO?: string;
	includeNFT: boolean;
	dustMode: string;
	dustThreshold: number;
	dustInterval: string;
	useOslo: boolean; // include tz in cache key so formatted timestamps don't mismatch
}) {
	const s = JSON.stringify(input);
	return crypto.createHash("sha256").update(s).digest("hex");
}
function getCache(key: string): CacheVal | null {
	const v = CACHE.get(key);
	if (!v) return null;
	if (Date.now() - v.createdAt > CACHE_TTL_MS) {
		CACHE.delete(key);
		return null;
	}
	return v;
}
function setCache(key: string, val: CacheVal) {
	CACHE.set(key, val);
}

/* ================= Numbers & helpers ================= */

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsToSol(l: number | string): number {
	const n = typeof l === "string" ? parseInt(l, 10) : l;
	return n / LAMPORTS_PER_SOL;
}

function sum<T>(arr: T[], f: (x: T) => number): number {
	return arr.reduce((a, b) => a + f(b), 0);
}

function numberToPlain(n: number, maxDecimals = 18): string {
	if (!Number.isFinite(n)) return "0";
	const s = String(n);
	if (!/e/i.test(s)) return s;
	const f = n.toFixed(maxDecimals);
	return f.replace(/\.?0+$/, "");
}

function shiftDecString(raw: string, decimals: number): string {
	const neg = raw.startsWith("-");
	let s = neg ? raw.slice(1) : raw;
	s = s.replace(/^0+/, "") || "0";
	if (decimals > 0) {
		if (s.length <= decimals) {
			s = `0.${"0".repeat(decimals - s.length)}${s}`;
		} else {
			s = `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
		}
	}
	s = s.replace(/\.?0+$/, "");
	return (neg ? "-" : "") + s;
}

type TokenTransferPlus = TokenTransfer & {
	rawTokenAmount?: { tokenAmount?: string; decimals?: number };
	fromTokenAccount?: string;
	toTokenAccount?: string;
	tokenStandard?: string;
	isNFT?: boolean;
	tokenSymbol?: string;
};

function makeSymDecResolver(
	jupMeta: Map<string, { symbol?: string; decimals?: number }>,
	heliusMeta: Map<string, { symbol?: string; decimals?: number }>
) {
	return (
		mint: string,
		symbol?: string,
		decimals?: number
	): { symbol: string; decimals: number } => {
		if (mint === "So11111111111111111111111111111111111111112") {
			return { symbol: "SOL", decimals: 9 };
		}
		const j = jupMeta.get(mint);
		const h = heliusMeta.get(mint);
		const hint = hintFor(mint);

		const sym =
			symbol ||
			j?.symbol ||
			h?.symbol ||
			hint?.symbol ||
			`TOKEN-${mint.slice(0, 6)}`;

		const dec =
			typeof decimals === "number"
				? decimals
				: typeof j?.decimals === "number"
				? j.decimals
				: typeof h?.decimals === "number"
				? h.decimals
				: hint?.decimals ?? 6;

		return { symbol: currencyCode(sym), decimals: dec };
	};
}

function toAmountText(n: number): string {
	return numberToPlain(n).replace(/\.?0+$/, "") || "0";
}

function amountFromTransfer(
	t: TokenTransferPlus,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number }
): {
	amountNum: number;
	amountText: string;
	symbol: string;
	decimals: number;
} {
	const { symbol, decimals } = resolveSymDec(t.mint, t.tokenSymbol, t.decimals);

	const raw = t.rawTokenAmount?.tokenAmount;
	const rawDec = t.rawTokenAmount?.decimals;

	if (typeof raw === "string" && raw.length > 0) {
		const d = typeof rawDec === "number" ? rawDec : decimals;
		const text = shiftDecString(raw, d);
		return {
			amountNum: Number(text) || 0,
			amountText: text,
			symbol,
			decimals: d
		};
	}

	if (typeof t.tokenAmount === "string" || typeof t.tokenAmount === "number") {
		const str = String(t.tokenAmount).replace(/,/g, "");
		const num = Number(str);
		const text = Number.isFinite(num) ? numberToPlain(num) : "0";
		return { amountNum: Number(text) || 0, amountText: text, symbol, decimals };
	}

	return { amountNum: 0, amountText: "0", symbol, decimals };
}

/* ========== Combine swap sides (token-first; include native SOL only if WSOL not present) ========== */

function pickSwapSides(
	tokenTransfers: TokenTransferPlus[],
	nativeTransfers: NativeTransfer[],
	includeNFT: boolean,
	address: string,
	myATAs: Set<string>,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number }
): { inAmt: number; inSym: string; outAmt: number; outSym: string } | null {
	const inTotals = new Map<string, number>();
	const outTotals = new Map<string, number>();

	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? myATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? myATAs.has(t.toTokenAccount) : false);

	let hasTokenSOL = false;

	for (const t of tokenTransfers) {
		if (!includeNFT && (t.tokenStandard === "nft" || (t as any).isNFT))
			continue;
		const { amountNum, symbol } = amountFromTransfer(t, resolveSymDec);
		if (!Number.isFinite(amountNum) || amountNum === 0) continue;
		if (symbol === "SOL") hasTokenSOL = true;

		if (ownsTo(t))
			inTotals.set(symbol, (inTotals.get(symbol) ?? 0) + amountNum);
		if (ownsFrom(t))
			outTotals.set(symbol, (outTotals.get(symbol) ?? 0) + amountNum);
	}

	if (!hasTokenSOL) {
		const solOut = nativeTransfers
			.filter((n) => n.fromUserAccount === address)
			.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0);
		const solIn = nativeTransfers
			.filter((n) => n.toUserAccount === address)
			.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0);
		if (solIn > 0) inTotals.set("SOL", (inTotals.get("SOL") ?? 0) + solIn);
		if (solOut > 0) outTotals.set("SOL", (outTotals.get("SOL") ?? 0) + solOut);
	}

	if (inTotals.size === 0 || outTotals.size === 0) return null;

	const inList = [...inTotals.entries()].sort((a, b) => b[1] - a[1]);
	const outList = [...outTotals.entries()].sort((a, b) => b[1] - a[1]);

	const [inSym, inAmt] = inList[0];
	const outDifferent = outList.find(([sym]) => sym !== inSym);
	const [outSym, outAmt] = outDifferent ?? outList[0];

	if (!inSym || !outSym || inSym === outSym) return null;
	if (!(inAmt > 0 && outAmt > 0)) return null;

	return { inAmt, inSym, outAmt, outSym };
}

/* ================= Dust helpers ================= */

type DustMode = "off" | "remove" | "aggregate";
type DustInterval = "day" | "week" | "month" | "year";

function decStrToNum(s: string): number {
	const n = parseFloat(s || "0");
	return Number.isFinite(n) ? n : 0;
}

function isTransferRow(r: KSRow): boolean {
	return r.Type === "Overføring-Inn" || r.Type === "Overføring-Ut";
}

function directionAndCurrency(
	r: KSRow
): { dir: "INN" | "UT"; amt: number; sym: string } | null {
	const inn = decStrToNum(r.Inn);
	const ut = decStrToNum(r.Ut);
	if (inn > 0 && ut === 0)
		return { dir: "INN", amt: inn, sym: r["Inn-Valuta"] };
	if (ut > 0 && inn === 0) return { dir: "UT", amt: ut, sym: r["Ut-Valuta"] };
	return null;
}

function bucketKeyFromTidspunkt(ts: string, interval: DustInterval): string {
	const d = ts.slice(0, 10); // YYYY-MM-DD
	if (interval === "day") return d;

	const y = d.slice(0, 4);
	const m = d.slice(5, 7);

	if (interval === "month") return `${y}-${m}`;
	if (interval === "year") return y;

	// week -> use ISO week start (Monday) date as key (YYYY-MM-DD)
	const base = new Date(`${d}T00:00:00Z`);
	const dow = base.getUTCDay(); // 0..6 (Sun..Sat)
	const deltaToMonday = (dow + 6) % 7;
	const start = new Date(base);
	start.setUTCDate(start.getUTCDate() - deltaToMonday);
	const sy = start.getUTCFullYear();
	const sm = String(start.getUTCMonth() + 1).padStart(2, "0");
	const sd = String(start.getUTCDate()).padStart(2, "0");
	return `${sy}-${sm}-${sd}`;
}

function bucketEndDateMs(key: string, interval: DustInterval): number {
	if (interval === "day") {
		const dt = new Date(`${key}T23:59:59.999Z`);
		return dt.getTime();
	}
	if (interval === "month") {
		const [y, m] = key.split("-");
		const year = parseInt(y, 10);
		const month = parseInt(m, 10);
		const firstNext = new Date(Date.UTC(year, month, 1, 23, 59, 59, 999));
		return firstNext.getTime() - 1;
	}
	if (interval === "year") {
		const year = parseInt(key, 10);
		const firstNext = new Date(Date.UTC(year + 1, 0, 1, 23, 59, 59, 999));
		return firstNext.getTime() - 1;
	}
	// week: key is ISO week start date (YYYY-MM-DD), end = Sunday 23:59:59.999Z
	const start = new Date(`${key}T00:00:00Z`);
	const end = new Date(
		Date.UTC(
			start.getUTCFullYear(),
			start.getUTCMonth(),
			start.getUTCDate() + 6,
			23,
			59,
			59,
			999
		)
	);
	return end.getTime();
}

function processDust(
	rows: KSRow[],
	opts: {
		mode: DustMode;
		threshold: number;
		interval: DustInterval;
		useOslo: boolean;
	}
): KSRow[] {
	const { mode, threshold, interval, useOslo } = opts;
	if (mode === "off" || threshold <= 0) return rows;

	if (mode === "remove") {
		return rows.filter((r) => {
			if (!isTransferRow(r)) return true;
			const info = directionAndCurrency(r);
			if (!info) return true;
			return info.amt >= threshold;
		});
	}

	// aggregate
	type AggKey = string; // `${bucket}|${dir}|${sym}`
	type AggVal = {
		count: number;
		totalAmt: number;
		totalFeeSOL: number;
		bucketMs: number;
		dir: "INN" | "UT";
		sym: string;
	};
	const keep: KSRow[] = [];
	const agg = new Map<AggKey, AggVal>();

	for (const r of rows) {
		if (!isTransferRow(r)) {
			keep.push(r);
			continue;
		}
		const info = directionAndCurrency(r);
		if (!info) {
			keep.push(r);
			continue;
		}
		if (info.amt >= threshold) {
			keep.push(r);
			continue;
		}

		const bucket = bucketKeyFromTidspunkt(r.Tidspunkt, interval);
		const key = `${bucket}|${info.dir}|${info.sym}`;
		const fee = decStrToNum(r.Gebyr);
		const existing = agg.get(key);
		if (existing) {
			existing.count += 1;
			existing.totalAmt += info.amt;
			existing.totalFeeSOL += fee;
		} else {
			agg.set(key, {
				count: 1,
				totalAmt: info.amt,
				totalFeeSOL: fee,
				bucketMs: bucketEndDateMs(bucket, interval),
				dir: info.dir,
				sym: info.sym
			});
		}
	}

	const aggRows: KSRow[] = [];
	for (const [, v] of agg.entries()) {
		// cap to now to avoid future timestamps in current period
		const nowMs = Date.now();
		const cappedMs = Math.min(v.bucketMs, nowMs);
		const ts = toNorwayTimeString(cappedMs, useOslo);

		const type: KSRow["Type"] =
			v.dir === "INN" ? "Overføring-Inn" : "Overføring-Ut";
		const inn = v.dir === "INN" ? numberToPlain(v.totalAmt) : "0";
		const ut = v.dir === "UT" ? numberToPlain(v.totalAmt) : "0";
		const gebyr = v.totalFeeSOL > 0 ? numberToPlain(v.totalFeeSOL) : "0";

		aggRows.push({
			Tidspunkt: ts,
			Type: type,
			Inn: toAmountString(inn),
			"Inn-Valuta": v.dir === "INN" ? currencyCode(v.sym) : "",
			Ut: toAmountString(ut),
			"Ut-Valuta": v.dir === "UT" ? currencyCode(v.sym) : "",
			Gebyr: toAmountString(gebyr),
			"Gebyr-Valuta": v.totalFeeSOL > 0 ? "SOL" : "",
			Marked: "AGGREGERT",
			Notat: `agg:${v.count} støv < ${opts.threshold}`
		});
	}

	const out = [...keep, ...aggRows].sort((a, b) =>
		a.Tidspunkt < b.Tidspunkt ? -1 : a.Tidspunkt > b.Tidspunkt ? 1 : 0
	);
	return out;
}

/* ================= Wallet tag for Notat ================= */
// CHANGED: no "WALLET:" prefix — just the provided name, or a short address.
function walletTag(address: string, walletName?: string): string {
	if (walletName && walletName.trim()) {
		return walletName.trim();
	}
	return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

/* ================= Liquidity detection (CLMM + CPMM/fungible LP) ================= */

type LiquidityKind =
	| "clmm-add"
	| "clmm-remove"
	| "cpmm-add"
	| "cpmm-remove"
	| "amm-add"
	| "amm-remove";

type LiquidityDetection = {
	kind: LiquidityKind;
	protocol: "RAYDIUM" | "ORCA" | "METEORA" | "SABER" | "UNKNOWN";
	note: "LIQUIDITY ADD" | "LIQUIDITY REMOVE";
	outs?: Array<{ sym: string; amount: number | string }>;
	ins?: Array<{ sym: string; amount: number | string }>;
	nft?: { symbol: string; amountText: string } | null; // CLMM position NFT if present
};

function isLikelyNFT(t: TokenTransferPlus): boolean {
	if (t.tokenStandard === "nft" || (t as any).isNFT) return true;
	const raw = t.rawTokenAmount?.tokenAmount ?? String(t.tokenAmount ?? "");
	const dec =
		typeof t.rawTokenAmount?.decimals === "number"
			? (t.rawTokenAmount!.decimals as number)
			: t.decimals;
	// Position NFTs are often Token-2022 mints with decimals=0 and amount=1
	return dec === 0 && (raw === "1" || raw === "1.0");
}

function protocolFromSource(source: string): LiquidityDetection["protocol"] {
	const s = String(source || "").toUpperCase();
	if (s.includes("RAYDIUM")) return "RAYDIUM";
	if (s.includes("ORCA")) return "ORCA";
	if (s.includes("METEORA") || s.includes("DLMM")) return "METEORA";
	if (s.includes("SABER")) return "SABER";
	return "UNKNOWN";
}

function looksCLMM(source: string): boolean {
	const s = String(source || "").toUpperCase();
	// Heuristics for concentrated models
	return (
		s.includes("CLMM") ||
		s.includes("CONCENTRATED") ||
		s.includes("WHIRLPOOL") ||
		s.includes("DLMM")
	);
}

function looksCPMM(source: string): boolean {
	const s = String(source || "").toUpperCase();
	// Heuristics for classic AMM/constant-product implementations
	return (
		s.includes("AMM") ||
		s.includes("TOKEN-SWAP") ||
		(s.includes("RAYDIUM") && !looksCLMM(source)) ||
		(s.includes("ORCA") && !looksCLMM(source)) ||
		s.includes("SABER")
	);
}

function extractSigFromNotat(notat: string): string | undefined {
	const m = /sig:([A-Za-z0-9]+)/.exec(notat);
	return m ? m[1] : undefined;
}

/**
 * Detects CLMM/CPMM/AMM liquidity add/remove and returns the legs + optional position NFT.
 * Works mostly from transfers; protocol/model is a best-effort guess from tx.source.
 */
function detectLiquidityEvent(
	tokenTransfers: TokenTransferPlus[],
	nativeTransfers: NativeTransfer[],
	address: string,
	myATAs: Set<string>,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number },
	source: string
): LiquidityDetection | null {
	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? myATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? myATAs.has(t.toTokenAccount) : false);

	// Split NFTs vs fungibles
	const nftIn = tokenTransfers.filter((t) => ownsTo(t) && isLikelyNFT(t));
	const nftOut = tokenTransfers.filter((t) => ownsFrom(t) && isLikelyNFT(t));
	const fIn = tokenTransfers.filter((t) => ownsTo(t) && !isLikelyNFT(t));
	const fOut = tokenTransfers.filter((t) => ownsFrom(t) && !isLikelyNFT(t));

	// Include native SOL legs when WSOL isn’t present
	const nativeInSOL = nativeTransfers
		.filter((n) => n.toUserAccount === address)
		.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0);
	const nativeOutSOL = nativeTransfers
		.filter((n) => n.fromUserAccount === address)
		.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0);

	// Build normalized legs
	const ins = [
		...fIn.map((t) => {
			const { amountText, symbol } = amountFromTransfer(t, resolveSymDec);
			return { sym: symbol, amount: amountText };
		}),
		...(nativeInSOL > 0
			? [{ sym: "SOL", amount: numberToPlain(nativeInSOL) }]
			: [])
	];
	const outs = [
		...fOut.map((t) => {
			const { amountText, symbol } = amountFromTransfer(t, resolveSymDec);
			return { sym: symbol, amount: amountText };
		}),
		...(nativeOutSOL > 0
			? [{ sym: "SOL", amount: numberToPlain(nativeOutSOL) }]
			: [])
	];

	// Distinct mint counts to avoid swapping false positives
	const distinctIns = new Set(ins.map((x) => x.sym)).size;
	const distinctOuts = new Set(outs.map((x) => x.sym)).size;

	const protocol = protocolFromSource(source);
	const modelCLMM = looksCLMM(source);

	// --- Preferred: explicit CLMM (when NFT is visible)
	if (nftIn.length >= 1 && distinctOuts >= 2) {
		const firstNFT = nftIn[0];
		const { symbol } = amountFromTransfer(firstNFT, resolveSymDec);
		return {
			kind: "clmm-add",
			protocol,
			note: "LIQUIDITY ADD",
			outs,
			nft: { symbol: symbol || "LP-NFT", amountText: "1" }
		};
	}
	if (nftOut.length >= 1 && distinctIns >= 2) {
		return {
			kind: "clmm-remove",
			protocol,
			note: "LIQUIDITY REMOVE",
			ins
		};
	}

	// --- NFT not visible? Use leg patterns (prevents swaps from matching)
	// ADD with 2+ outs and no ins → CLMM if source looks concentrated, else CPMM/AMM
	if (distinctOuts >= 2 && distinctIns === 0) {
		return {
			kind: modelCLMM ? "clmm-add" : "cpmm-add",
			protocol,
			note: "LIQUIDITY ADD",
			outs
		};
	}
	// REMOVE with 2+ ins and no outs
	if (distinctIns >= 2 && distinctOuts === 0) {
		return {
			kind: modelCLMM ? "clmm-remove" : "cpmm-remove",
			protocol,
			note: "LIQUIDITY REMOVE",
			ins
		};
	}

	// --- Conservative CPMM path (LP mint/burn visible): require 2+ legs on the opposite side
	const insMints = new Set(fIn.map((t) => t.mint));
	const outsMints = new Set(fOut.map((t) => t.mint));
	const insHasMintNotInOuts = [...insMints].some((m) => !outsMints.has(m));
	const outsHasMintNotInIns = [...outsMints].some((m) => !insMints.has(m));

	// CPMM ADD: LP minted in + >=2 distinct outs
	if (insHasMintNotInOuts && distinctOuts >= 2) {
		return { kind: "cpmm-add", protocol, note: "LIQUIDITY ADD", outs };
	}
	// CPMM REMOVE: LP burned out + >=2 distinct ins
	if (outsHasMintNotInIns && distinctIns >= 2) {
		return { kind: "cpmm-remove", protocol, note: "LIQUIDITY REMOVE", ins };
	}

	return null;
}

/* ================= Core classification helper ================= */

type RowInput = Partial<Omit<KSRow, "Inn" | "Ut" | "Gebyr" | "Notat">> & {
	Inn?: number | string;
	Ut?: number | string;
	Gebyr?: number | string;
};

function ensureStringAmount(v: number | string | undefined): string {
	return typeof v === "string"
		? toAmountString(v)
		: typeof v === "number"
		? toAmountString(numberToPlain(v))
		: "";
}

function classifyTxToRows(opts: {
	tx: HeliusTx;
	address: string;
	myATAs: Set<string>;
	includeNFT: boolean;
	useOslo: boolean;
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number };
}): KSRow[] {
	const { tx, address, myATAs, includeNFT, useOslo, resolveSymDec } = opts;

	const tsSec = tx.timestamp ?? Math.floor(Date.now() / 1000);
	const tsMs = tsSec * 1000;
	const time = toNorwayTimeString(tsMs, useOslo);

	const sig = tx.signature;

	const feePayer =
		typeof (tx as any).feePayer === "string" ? (tx as any).feePayer : "";
	const userPaidFee =
		feePayer && feePayer.toLowerCase() === address.toLowerCase();
	let feeLeftSOL = userPaidFee && tx.fee ? lamportsToSol(tx.fee) : 0;

	const nativeTransfers: NativeTransfer[] = Array.isArray(tx.nativeTransfers)
		? tx.nativeTransfers
		: [];

	const tokenTransfers: TokenTransferPlus[] = Array.isArray(tx.tokenTransfers)
		? (tx.tokenTransfers as TokenTransferPlus[])
		: [];

	const type: string = tx.type || tx.description || "UNKNOWN";
	const source: string =
		(tx as any).source || (tx as any).programId || "solana";
	const isSwapMeta = type.toUpperCase().includes("SWAP");

	const rows: KSRow[] = [];

	const pushRow = (r: RowInput, noteSuffix?: string): void => {
		const gebyr =
			feeLeftSOL > 0 ? toAmountString(toAmountText(feeLeftSOL)) : "";
		const gebyrVal = feeLeftSOL > 0 ? "SOL" : "";
		if (feeLeftSOL > 0) feeLeftSOL = 0;

		rows.push({
			Tidspunkt: time,
			Type: r.Type as KSRow["Type"],
			Inn: ensureStringAmount(r.Inn),
			"Inn-Valuta": r["Inn-Valuta"]
				? currencyCode(String(r["Inn-Valuta"]))
				: "",
			Ut: ensureStringAmount(r.Ut),
			"Ut-Valuta": r["Ut-Valuta"] ? currencyCode(String(r["Ut-Valuta"])) : "",
			Gebyr: gebyr || "0",
			"Gebyr-Valuta": gebyrVal,
			Marked: String(r.Marked ?? source ?? "solana"),
			// Keep Notat starting with sig: to preserve existing behavior; append note after it
			Notat: `${noteSuffix ? `${noteSuffix} ` : ""}sig:${sig}`
		});
	};

	// 1) Liquidity add/remove detection first (CLMM + CPMM + others)
	const liq = detectLiquidityEvent(
		tokenTransfers,
		nativeTransfers,
		address,
		myATAs,
		resolveSymDec,
		source
	);

	if (liq) {
		const market = `${liq.protocol}-LIQUIDITY`;

		if (
			liq.kind === "clmm-add" ||
			liq.kind === "cpmm-add" ||
			liq.kind === "amm-add"
		) {
			// Outgoing underlyings -> TAP
			for (const leg of liq.outs ?? []) {
				pushRow(
					{
						Type: "Tap" as KSRow["Type"],
						Inn: 0,
						"Inn-Valuta": "",
						Ut: leg.amount,
						"Ut-Valuta": leg.sym,
						Marked: market
					},
					liq.note
				);
			}
			// Include the position NFT as an asset if requested
			if (includeNFT && liq.nft) {
				pushRow(
					{
						Type: "Erverv",
						Inn: liq.nft.amountText,
						"Inn-Valuta": currencyCode(liq.nft.symbol || "LP-NFT"),
						Ut: 0,
						"Ut-Valuta": "",
						Marked: "SOLANA-NFT"
					},
					liq.note
				);
			}
		} else {
			// Remove: incoming underlyings -> Erverv
			for (const leg of liq.ins ?? []) {
				pushRow(
					{
						Type: "Erverv",
						Inn: leg.amount,
						"Inn-Valuta": leg.sym,
						Ut: 0,
						"Ut-Valuta": "",
						Marked: market
					},
					liq.note
				);
			}
			// Skip explicit LP burn/NFT close rows to keep CSV clean
		}

		return rows; // handled
	}

	// 2) Try to combine into Handel (generic swap) if no liquidity pattern matched
	const sides =
		pickSwapSides(
			tokenTransfers,
			nativeTransfers,
			includeNFT,
			address,
			myATAs,
			resolveSymDec
		) ||
		(isSwapMeta
			? pickSwapSides(
					tokenTransfers,
					[],
					includeNFT,
					address,
					myATAs,
					resolveSymDec
			  )
			: null);

	if (sides) {
		pushRow({
			Type: "Handel",
			Inn: sides.inAmt,
			"Inn-Valuta": sides.inSym,
			Ut: sides.outAmt,
			"Ut-Valuta": sides.outSym,
			Marked: "SOLANA DEX"
		});
		return rows;
	}

	// 3) Native SOL transfers
	const solSent = nativeTransfers.filter((n) => n.fromUserAccount === address);
	const solRecv = nativeTransfers.filter((n) => n.toUserAccount === address);

	if (solSent.length) {
		const amt = sum(solSent, (n) => lamportsToSol(n.amount ?? 0));
		if (amt) {
			pushRow({
				Type: "Overføring-Ut",
				Inn: 0,
				"Inn-Valuta": "",
				Ut: amt,
				"Ut-Valuta": "SOL",
				Marked: "SOLANA"
			});
		}
	}
	if (solRecv.length) {
		const amt = sum(solRecv, (n) => lamportsToSol(n.amount ?? 0));
		if (amt) {
			pushRow({
				Type: "Overføring-Inn",
				Inn: amt,
				"Inn-Valuta": "SOL",
				Ut: 0,
				"Ut-Valuta": "",
				Marked: "SOLANA"
			});
		}
	}

	// 4) SPL token transfers
	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? myATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? myATAs.has(t.toTokenAccount) : false);

	for (const t of tokenTransfers) {
		if (!includeNFT && (t.tokenStandard === "nft" || (t as any).isNFT))
			continue;

		const { amountNum, amountText, symbol } = amountFromTransfer(
			t,
			resolveSymDec
		);
		if (amountNum === 0) continue;

		if (ownsFrom(t)) {
			pushRow({
				Type: "Overføring-Ut",
				Inn: 0,
				"Inn-Valuta": "",
				Ut: amountText,
				"Ut-Valuta": symbol,
				Marked: String(source).toUpperCase() || "SPL"
			});
		} else if (ownsTo(t)) {
			pushRow({
				Type: "Overføring-Inn",
				Inn: amountText,
				"Inn-Valuta": symbol,
				Ut: 0,
				"Ut-Valuta": "",
				Marked: String(source).toUpperCase() || "SPL"
			});
		}
	}

	// 5) Airdrops -> Erverv
	if (type.toUpperCase().includes("AIRDROP")) {
		const recvToken = tokenTransfers.find((t) => ownsTo(t));
		if (recvToken) {
			const { amountText, symbol } = amountFromTransfer(
				recvToken,
				resolveSymDec
			);
			if (amountText !== "0") {
				pushRow({
					Type: "Erverv",
					Inn: amountText,
					"Inn-Valuta": symbol,
					Ut: 0,
					"Ut-Valuta": "",
					Marked: String(source).toUpperCase() || "AIRDROP"
				});
			}
		}
	}

	// 6) Staking rewards -> Inntekt
	const rewardLamports = (tx.events as any)?.stakingReward?.amount ?? 0;
	if (rewardLamports > 0 || String(type).toUpperCase().includes("REWARD")) {
		const amt = lamportsToSol(rewardLamports);
		if (amt) {
			pushRow({
				Type: "Inntekt",
				Inn: amt,
				"Inn-Valuta": "SOL",
				Ut: 0,
				"Ut-Valuta": "",
				Marked: "STAKE"
			});
		}
	}

	return rows;
}

/* ================= Overrides ================= */

type OverridesPayload = {
	/** Rename token symbols as-displayed in rows (UPPERCASE, e.g. TOKEN-ABC123 → USDC) */
	tokenSymbols?: Record<string, string>;
	/** Also accept client alias: { symbols: {...} } */
	symbols?: Record<string, string>;
	/** Rename market strings (free text) */
	markets?: Record<string, string>;
};

function applyOverridesToRows(
	rows: KSRow[],
	overrides?: OverridesPayload
): KSRow[] {
	if (!overrides) return rows;

	// accept both shapes: { tokenSymbols } or { symbols }
	const tokenMapRaw = overrides.tokenSymbols ?? overrides.symbols ?? {};

	const marketMap = overrides.markets ?? {};

	// Normalize token keys because CSV uses currencyCode (UPPERCASE, [A-Z0-9-], max 16)
	const normTokenMap: Record<string, string> = {};
	for (const [k, v] of Object.entries(tokenMapRaw)) {
		const fromKey = currencyCode(k);
		const toVal = currencyCode(v);
		if (fromKey && toVal) normTokenMap[fromKey] = toVal;
	}

	return rows.map((r) => {
		const inn = r["Inn-Valuta"];
		const ut = r["Ut-Valuta"];
		const mkt = r.Marked;

		const innNew = inn && normTokenMap[inn] ? normTokenMap[inn] : inn;
		const utNew = ut && normTokenMap[ut] ? normTokenMap[ut] : ut;
		const mktNew = mkt && marketMap[mkt] !== undefined ? marketMap[mkt]! : mkt;

		if (innNew === inn && utNew === ut && mktNew === mkt) return r;
		return {
			...r,
			"Inn-Valuta": innNew,
			"Ut-Valuta": utNew,
			Marked: mktNew
		};
	});
}

/* ================= Route ================= */

interface Body {
	address?: string;
	walletName?: string;
	fromISO?: string;
	toISO?: string;
	includeNFT?: boolean;
	dustMode?: DustMode;
	dustThreshold?: string | number;
	dustInterval?: DustInterval;
	useOslo?: boolean; // <-- honor timezone toggle
	overrides?: OverridesPayload;
}

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as Body;

		const address = String(body.address || "").trim();
		if (!address) {
			return NextResponse.json({ error: "Missing address" }, { status: 400 });
		}

		const fromISO = body.fromISO
			? new Date(body.fromISO).toISOString()
			: undefined;
		const toISO = body.toISO ? new Date(body.toISO).toISOString() : undefined;

		const includeNFT = Boolean(body.includeNFT ?? false);
		const useOslo = Boolean(body.useOslo ?? false);

		// Dust params with defaults
		const dustMode: DustMode = (body.dustMode ?? "off") as DustMode;
		const dustThresholdNum =
			typeof body.dustThreshold === "number"
				? body.dustThreshold
				: typeof body.dustThreshold === "string"
				? parseFloat(body.dustThreshold)
				: 0;
		const dustThreshold = Number.isFinite(dustThresholdNum)
			? dustThresholdNum
			: 0;
		const dustInterval: DustInterval = (body.dustInterval ??
			"day") as DustInterval;

		// query params
		const sp = req.nextUrl?.searchParams;
		const wantNDJSON = sp?.get("format")?.toLowerCase() === "ndjson";
		const wantJSON = sp?.get("format")?.toLowerCase() === "json";
		const useCache = sp?.get("useCache") === "1";

		// Local guard on time range (in addition to Helius server filter)
		const fromMs = fromISO ? new Date(fromISO).getTime() : undefined;
		const toMs = toISO ? new Date(toISO).getTime() : undefined;

		// Build cache key (note: walletName NOT included; we prefix Notat at the end)
		const ckey = mkCacheKey({
			address,
			fromISO,
			toISO,
			includeNFT,
			dustMode,
			dustThreshold,
			dustInterval,
			useOslo
		});

		/* ---------- Clear cache for this request key ---------- */
		const clearCache = req.nextUrl?.searchParams.get("clearCache") === "1";
		if (clearCache) {
			const cleared = CACHE.delete(ckey);
			return NextResponse.json({ ok: true, cleared, cacheKey: ckey });
		}

		/* ---------- NDJSON streaming (preview with progress) ---------- */
		if (wantNDJSON) {
			const stream = new ReadableStream({
				async start(controller) {
					const enc = new TextEncoder();
					const send = (obj: any) =>
						controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

					const cached = getCache(ckey);
					if (cached) {
						// Serve from cache quickly
						const tag = walletTag(address, body.walletName);
						const rowsPreview = cached.rowsProcessed.slice(0, 500).map((r) => {
							const withTag = { ...r, Notat: `${tag} ${r.Notat}` };
							return {
								...withTag,
								signature: extractSigFromNotat(r.Notat)
							};
						});

						await send({
							type: "log",
							message: "Treff i cache – henter forhåndsvisning."
						});
						await send({
							type: "done",
							data: {
								rowsPreview,
								count: cached.count,
								rawCount: cached.rawCount,
								cacheKey: ckey
							}
						});
						controller.close();
						return;
					}

					// No cache => compute with progress logs
					try {
						await send({
							type: "log",
							message: "Henter token-kontoer (ATAer) …"
						});
						const tokenAccounts = await getTokenAccountsByOwner(
							address,
							process.env.HELIUS_API_KEY
						);
						const myATAs = new Set<string>(tokenAccounts);
						myATAs.add(address);

						await send({
							type: "log",
							message: `Fant ${tokenAccounts.length} tilknyttede token-kontoer (ATAer). Skanner alle for å få med SPL-bevegelser.`
						});

						const addressesToQuery = [address, ...tokenAccounts];
						const sigMap = new Map<string, HeliusTx>();
						const maxPages = 50;

						for (let ai = 0; ai < addressesToQuery.length; ai++) {
							const who = addressesToQuery[ai];
							const isMain = ai === 0;
							let pages = 0;

							if (isMain) {
								await send({ type: "log", message: "Skanner hovedadresse …" });
							} else if (ai === 1) {
								await send({ type: "log", message: "Skanner ATAer …" });
							}

							for await (const page of fetchEnhancedTxs({
								address: who,
								fromISO,
								toISO,
								apiKey: process.env.HELIUS_API_KEY,
								limit: 100,
								maxPages
							})) {
								pages++;
								for (const tx of page) {
									if (!tx?.signature) continue;
									sigMap.set(tx.signature, tx);
								}
								const short = `${who.slice(0, 5)}…${who.slice(-5)}`;
								await send({
									type: "page",
									page: pages,
									maxPages,
									addressShort: short,
									kind: isMain ? "main" : "ata",
									idx: isMain ? 0 : ai - 1,
									totalATAs: tokenAccounts.length
								});
								if (pages >= maxPages) break;
							}

							const short = `${who.slice(0, 5)}…${who.slice(-5)}`;
							await send({
								type: "addrDone",
								pages,
								kind: isMain ? "main" : "ata",
								idx: isMain ? 0 : ai - 1,
								totalATAs: tokenAccounts.length,
								addressShort: short
							});
						}

						const allTxs = [...sigMap.values()].sort(
							(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
						);

						// Collect mints
						await send({ type: "log", message: "Henter token metadata …" });
						const mintsNeeding: Set<string> = new Set();
						for (const tx of allTxs) {
							for (const t of tx.tokenTransfers ?? []) {
								if (!t?.mint) continue;
								const hasSym =
									typeof (t as any).tokenSymbol === "string" &&
									(t as any).tokenSymbol.length > 0;
								const hasHint = Boolean(hintFor(t.mint));
								if (!hasSym && !hasHint) mintsNeeding.add(t.mint);
							}
						}

						const jupMeta =
							mintsNeeding.size > 0
								? await fetchJupiterTokenMetadataMap([...mintsNeeding])
								: new Map<string, { symbol?: string; decimals?: number }>();

						const stillMissing = [...mintsNeeding].filter(
							(m) => !jupMeta.has(m)
						);
						const helMeta =
							stillMissing.length > 0
								? await fetchTokenMetadataMap(
										stillMissing,
										process.env.HELIUS_API_KEY
								  )
								: new Map<string, { symbol?: string; decimals?: number }>();

						const resolveSymDec = makeSymDecResolver(jupMeta, helMeta);

						/* ---------- Classify into KS rows ---------- */
						const rows: KSRow[] = [];
						for (const tx of allTxs as HeliusTx[]) {
							try {
								const tsSec = tx.timestamp ?? Math.floor(Date.now() / 1000);
								const tsMs = tsSec * 1000;
								if (
									(fromMs !== undefined && tsMs < fromMs) ||
									(toMs !== undefined && tsMs > toMs)
								) {
									continue;
								}
								const classified = classifyTxToRows({
									tx,
									address,
									myATAs,
									includeNFT,
									useOslo,
									resolveSymDec
								});
								rows.push(...classified);
							} catch {
								// skip one bad tx and continue
							}
						}

						const rawCount = rows.length;
						const processed = processDust(rows, {
							mode: dustMode,
							threshold: dustThreshold,
							interval: dustInterval,
							useOslo
						});
						const count = processed.length;

						setCache(ckey, {
							rowsProcessed: processed,
							count,
							rawCount,
							createdAt: Date.now()
						});

						const tag = walletTag(address, body.walletName);
						const rowsPreview = processed.slice(0, 500).map((r) => {
							const withTag = { ...r, Notat: `${tag} ${r.Notat}` };
							return {
								...withTag,
								signature: extractSigFromNotat(r.Notat)
							};
						});

						await send({
							type: "done",
							data: { rowsPreview, count, rawCount, cacheKey: ckey }
						});
					} catch (err: any) {
						await send({
							type: "log",
							message: `❌ Feil: ${err?.message || err}`
						});
					} finally {
						controller.close();
					}
				}
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "application/x-ndjson; charset=utf-8",
					"Cache-Control": "no-store"
				}
			});
		}

		/* ---------- JSON (non-stream) ---------- */
		if (wantJSON) {
			const cached = getCache(ckey);
			if (cached) {
				const tag = walletTag(address, body.walletName);
				const rowsOutRaw = cached.rowsProcessed.map((r) => {
					const withTag = { ...r, Notat: `${tag} ${r.Notat}` };
					return {
						...withTag,
						signature: extractSigFromNotat(r.Notat)
					};
				});
				const rowsOut = applyOverridesToRows(rowsOutRaw, body.overrides);
				return NextResponse.json({
					rows: rowsOut,
					count: cached.count,
					rawCount: cached.rawCount,
					cacheKey: ckey
				});
			}

			// Fallback: compute (no progress)
			const tokenAccounts = await getTokenAccountsByOwner(
				address,
				process.env.HELIUS_API_KEY
			);
			const myATAs = new Set<string>(tokenAccounts);
			myATAs.add(address);

			const addressesToQuery = [address, ...tokenAccounts];
			const sigMap = new Map<string, HeliusTx>();
			for (const who of addressesToQuery) {
				let pages = 0;
				for await (const page of fetchEnhancedTxs({
					address: who,
					fromISO,
					toISO,
					apiKey: process.env.HELIUS_API_KEY,
					limit: 100,
					maxPages: 50
				})) {
					pages++;
					for (const tx of page) {
						if (!tx?.signature) continue;
						sigMap.set(tx.signature, tx);
					}
					if (pages >= 50) break;
				}
			}

			const allTxs = [...sigMap.values()].sort(
				(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
			);

			const mintsNeeding: Set<string> = new Set();
			for (const tx of allTxs) {
				for (const t of tx.tokenTransfers ?? []) {
					if (!t?.mint) continue;
					const hasSym =
						typeof (t as any).tokenSymbol === "string" &&
						(t as any).tokenSymbol.length > 0;
					const hasHint = Boolean(hintFor(t.mint));
					if (!hasSym && !hasHint) mintsNeeding.add(t.mint);
				}
			}
			const jupMeta =
				mintsNeeding.size > 0
					? await fetchJupiterTokenMetadataMap([...mintsNeeding])
					: new Map<string, { symbol?: string; decimals?: number }>();
			const stillMissing = [...mintsNeeding].filter((m) => !jupMeta.has(m));
			const helMeta =
				stillMissing.length > 0
					? await fetchTokenMetadataMap(
							stillMissing,
							process.env.HELIUS_API_KEY
					  )
					: new Map<string, { symbol?: string; decimals?: number }>();
			const resolveSymDec = makeSymDecResolver(jupMeta, helMeta);

			const rows: KSRow[] = [];
			for (const tx of allTxs as HeliusTx[]) {
				try {
					const tsSec = tx.timestamp ?? Math.floor(Date.now() / 1000);
					const tsMs = tsSec * 1000;
					if (
						(fromMs !== undefined && tsMs < fromMs) ||
						(toMs !== undefined && tsMs > toMs)
					) {
						continue;
					}
					const classified = classifyTxToRows({
						tx,
						address,
						myATAs,
						includeNFT,
						useOslo,
						resolveSymDec
					});
					rows.push(...classified);
				} catch {}
			}

			const rawCount = rows.length;
			const processed = processDust(rows, {
				mode: dustMode,
				threshold: dustThreshold,
				interval: dustInterval,
				useOslo
			});
			const count = processed.length;

			setCache(ckey, {
				rowsProcessed: processed,
				count,
				rawCount,
				createdAt: Date.now()
			});

			const tag = walletTag(address, body.walletName);
			const rowsOutRaw = processed.map((r) => {
				const withTag = { ...r, Notat: `${tag} ${r.Notat}` };
				return {
					...withTag,
					signature: extractSigFromNotat(r.Notat)
				};
			});

			const rowsOut = applyOverridesToRows(rowsOutRaw, body.overrides);

			return NextResponse.json({
				rows: rowsOut,
				count,
				rawCount,
				cacheKey: ckey
			});
		}

		/* ---------- CSV (use cache if available) ---------- */
		// If useCache=1 and cache exists, return quickly; else compute (and cache)
		const cached = useCache ? getCache(ckey) : null;
		const tag = walletTag(address, body.walletName);

		if (cached) {
			const rowsWithTag = cached.rowsProcessed.map((r) => ({
				...r,
				Notat: `${tag} ${r.Notat}`
			}));
			const rowsForCsv = applyOverridesToRows(rowsWithTag, body.overrides);
			const csv = rowsToCSV(rowsForCsv);
			return new NextResponse(csv, {
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename=solana_${address}_kryptosekken.csv`
				}
			});
		}

		// Fallback: compute once (no streaming)
		const tokenAccounts = await getTokenAccountsByOwner(
			address,
			process.env.HELIUS_API_KEY
		);
		const myATAs = new Set<string>(tokenAccounts);
		myATAs.add(address);

		const addressesToQuery = [address, ...tokenAccounts];
		const sigMap = new Map<string, HeliusTx>();
		for (const who of addressesToQuery) {
			let pages = 0;
			for await (const page of fetchEnhancedTxs({
				address: who,
				fromISO,
				toISO,
				apiKey: process.env.HELIUS_API_KEY,
				limit: 100,
				maxPages: 50
			})) {
				pages++;
				for (const tx of page) {
					if (!tx?.signature) continue;
					sigMap.set(tx.signature, tx);
				}
				if (pages >= 50) break;
			}
		}

		const allTxs = [...sigMap.values()].sort(
			(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
		);

		const mintsNeeding: Set<string> = new Set();
		for (const tx of allTxs) {
			for (const t of tx.tokenTransfers ?? []) {
				if (!t?.mint) continue;
				const hasSym =
					typeof (t as any).tokenSymbol === "string" &&
					(t as any).tokenSymbol.length > 0;
				const hasHint = Boolean(hintFor(t.mint));
				if (!hasSym && !hasHint) mintsNeeding.add(t.mint);
			}
		}

		const jupMeta =
			mintsNeeding.size > 0
				? await fetchJupiterTokenMetadataMap([...mintsNeeding])
				: new Map<string, { symbol?: string; decimals?: number }>();

		const stillMissing = [...mintsNeeding].filter((m) => !jupMeta.has(m));
		const helMeta =
			stillMissing.length > 0
				? await fetchTokenMetadataMap(stillMissing, process.env.HELIUS_API_KEY)
				: new Map<string, { symbol?: string; decimals?: number }>();

		const resolveSymDec = makeSymDecResolver(jupMeta, helMeta);

		const rows: KSRow[] = [];
		for (const tx of allTxs as HeliusTx[]) {
			try {
				const tsSec = tx.timestamp ?? Math.floor(Date.now() / 1000);
				const tsMs = tsSec * 1000;
				if (
					(fromMs !== undefined && tsMs < fromMs) ||
					(toMs !== undefined && tsMs > toMs)
				) {
					continue;
				}
				const classified = classifyTxToRows({
					tx,
					address,
					myATAs,
					includeNFT,
					useOslo,
					resolveSymDec
				});
				rows.push(...classified);
			} catch {}
		}

		const rawCount = rows.length;
		const processed = processDust(rows, {
			mode: dustMode,
			threshold: dustThreshold,
			interval: dustInterval,
			useOslo
		});
		const count = processed.length;

		setCache(ckey, {
			rowsProcessed: processed,
			count,
			rawCount,
			createdAt: Date.now()
		});

		const rowsWithTag = processed.map((r) => ({
			...r,
			Notat: `${tag} ${r.Notat}`
		}));
		const rowsForCsv = applyOverridesToRows(rowsWithTag, body.overrides);
		const csv = rowsToCSV(rowsForCsv);
		return new NextResponse(csv, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename=solana_${address}_kryptosekken.csv`
			}
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "Unknown error";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
