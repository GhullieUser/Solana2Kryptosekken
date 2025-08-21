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
	TokenTransfer,
	fetchFeePayer
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
	rowsProcessed: KSRow[];
	rawCount: number;
	count: number;
	createdAt: number;
	sigToSigner?: Record<string, string>;
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
	useOslo: boolean;
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

function numberToPlain(n: number): string {
	if (!Number.isFinite(n)) return "0";
	const s = String(n);
	if (!/e/i.test(s)) return s;
	const f = n.toFixed(18);
	return f.replace(/\.?0+$/, "");
}

function shiftDecString(raw: string, decimals: number): string {
	const neg = raw.startsWith("-");
	let s = neg ? raw.slice(1) : raw;
	s = s.replace(/^0+/, "") || "0";
	if (decimals > 0) {
		if (s.length <= decimals) s = `0.${"0".repeat(decimals - s.length)}${s}`;
		else
			s = `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
	}
	s = s.replace(/\.?0+$/, "");
	return (neg ? "-" : "") + s;
}

function nativeSolInOut(
	nativeTransfers: NativeTransfer[],
	address: string
): { inSOL: number; outSOL: number; outs: number[]; ins: number[] } {
	const ins: number[] = [];
	const outs: number[] = [];
	for (const n of nativeTransfers) {
		const amt = lamportsToSol(n.amount ?? 0);
		if (!amt) continue;
		if (n.toUserAccount === address) ins.push(amt);
		if (n.fromUserAccount === address) outs.push(amt);
	}
	return { inSOL: sum(ins, (x) => x), outSOL: sum(outs, (x) => x), outs, ins };
}

/** Try to derive the user's SOL delta (post - pre) in SOL. */
function getUserLamportsDeltaSOL(tx: HeliusTx, address: string): number | null {
	const anyTx = tx as any;

	// meta.pre/post + accountKeys
	const meta = anyTx?.meta;
	const keysRaw =
		anyTx?.transaction?.message?.accountKeys || anyTx?.accountKeys || null;
	if (
		meta &&
		Array.isArray(meta.preBalances) &&
		Array.isArray(meta.postBalances) &&
		Array.isArray(keysRaw)
	) {
		const keys: string[] = keysRaw.map((k: any) =>
			typeof k === "string" ? k : k?.pubkey || ""
		);
		const idx = keys.findIndex(
			(k) => typeof k === "string" && k.toLowerCase() === address.toLowerCase()
		);
		if (
			idx >= 0 &&
			typeof meta.preBalances[idx] === "number" &&
			typeof meta.postBalances[idx] === "number"
		) {
			const deltaLamports = meta.postBalances[idx] - meta.preBalances[idx];
			return lamportsToSol(deltaLamports);
		}
	}

	// accountData entries
	if (Array.isArray(anyTx?.accountData)) {
		const rec = anyTx.accountData.find(
			(r: any) =>
				(typeof r?.account === "string" &&
					r.account.toLowerCase() === address.toLowerCase()) ||
				(typeof r?.pubkey === "string" &&
					r.pubkey.toLowerCase() === address.toLowerCase())
		);
		if (rec) {
			if (
				rec?.pre?.lamports != null &&
				rec?.post?.lamports != null &&
				Number.isFinite(rec.pre.lamports) &&
				Number.isFinite(rec.post.lamports)
			) {
				return lamportsToSol(rec.post.lamports - rec.pre.lamports);
			}
			if (
				rec?.nativeBalanceChange != null &&
				Number.isFinite(rec.nativeBalanceChange)
			) {
				return lamportsToSol(rec.nativeBalanceChange);
			}
			if (rec?.lamportsChange != null && Number.isFinite(rec.lamportsChange)) {
				return lamportsToSol(rec.lamportsChange);
			}
		}
	}

	return null;
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

/* ========== Swap helpers ========== */

function buildTxATAsSet(
	tokenTransfers: TokenTransferPlus[] | undefined,
	address: string,
	myATAs: Set<string>
): Set<string> {
	const s = new Set<string>(myATAs);
	if (!Array.isArray(tokenTransfers)) return s;
	for (const t of tokenTransfers) {
		if (t?.fromUserAccount === address && t.fromTokenAccount)
			s.add(t.fromTokenAccount);
		if (t?.toUserAccount === address && t.toTokenAccount)
			s.add(t.toTokenAccount);
	}
	return s;
}

/** Token-only net (ignores native SOL for leg selection). */
function tokenNetBySymbol(
	tokenTransfers: TokenTransferPlus[],
	address: string,
	txATAs: Set<string>,
	includeNFT: boolean,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number }
) {
	const net = new Map<string, number>();
	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? txATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? txATAs.has(t.toTokenAccount) : false);

	for (const t of tokenTransfers) {
		if (!includeNFT && (t.tokenStandard === "nft" || (t as any).isNFT))
			continue;
		const { amountNum, symbol } = amountFromTransfer(t, resolveSymDec);
		if (!Number.isFinite(amountNum) || amountNum === 0) continue;
		if (ownsTo(t)) net.set(symbol, (net.get(symbol) ?? 0) + amountNum);
		if (ownsFrom(t)) net.set(symbol, (net.get(symbol) ?? 0) - amountNum);
	}
	return net;
}

/** Collapse any tx that has both token inflows and outflows into ONE Handel; fold SOL tips into Gebyr. */
function collapseTokenNetToSingleHandel(
	tokenTransfers: TokenTransferPlus[],
	nativeTransfers: NativeTransfer[],
	address: string,
	txATAs: Set<string>,
	includeNFT: boolean,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number }
): {
	inAmt: number;
	inSym: string;
	outAmt: number;
	outSym: string;
	extraTipSOL: number;
} | null {
	const net = tokenNetBySymbol(
		tokenTransfers,
		address,
		txATAs,
		includeNFT,
		resolveSymDec
	);

	const EPS = 1e-12;
	const positives: Array<[string, number]> = [];
	const negatives: Array<[string, number]> = [];
	for (const [sym, v] of net.entries()) {
		if (Math.abs(v) <= EPS) continue;
		if (v > 0) positives.push([sym, v]);
		else negatives.push([sym, -v]);
	}

	if (!positives.length || !negatives.length) return null;

	positives.sort((a, b) => b[1] - a[1]);
	negatives.sort((a, b) => b[1] - a[1]);

	const [inSym, inAmt] = positives[0];
	const [outSym, outAmt] = negatives[0];
	if (!inSym || !outSym || inSym === outSym) return null;

	// Fold SOL priority/tip into fee — but do NOT let it influence leg selection.
	const { inSOL: nativeInSOL, outSOL: nativeOutSOL } = nativeSolInOut(
		nativeTransfers,
		address
	);
	const tokenSolOut = tokenTransfers.reduce((acc, t) => {
		const { amountNum, symbol } = amountFromTransfer(t, resolveSymDec);
		const isFrom =
			t.fromUserAccount === address ||
			(t.fromTokenAccount ? txATAs.has(t.fromTokenAccount) : false);
		return (
			acc +
			(isFrom && symbol === "SOL"
				? Number.isFinite(amountNum)
					? amountNum
					: 0
				: 0)
		);
	}, 0);
	let extraTipSOL = nativeOutSOL - tokenSolOut - nativeInSOL;
	if (!Number.isFinite(extraTipSOL)) extraTipSOL = 0;
	if (extraTipSOL < 0) extraTipSOL = 0;
	if (extraTipSOL > 0.5) extraTipSOL = 0; // sanity

	return { inAmt, inSym, outAmt, outSym, extraTipSOL };
}

/** NEW: Handle Pump.fun-style (token-in + native SOL-out) or the reverse (token-out + native SOL-in). */
function collapseHybridTokenNativeSwap(
	tokenTransfers: TokenTransferPlus[],
	nativeTransfers: NativeTransfer[],
	address: string,
	txATAs: Set<string>,
	includeNFT: boolean,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number },
	srcU: string
): {
	inAmt: number;
	inSym: string;
	outAmt: number;
	outSym: string;
	extraTipSOL: number;
} | null {
	const net = tokenNetBySymbol(
		tokenTransfers,
		address,
		txATAs,
		includeNFT,
		resolveSymDec
	);

	const EPS = 1e-12;
	const positives: Array<[string, number]> = [];
	const negatives: Array<[string, number]> = [];
	for (const [sym, v] of net.entries()) {
		if (Math.abs(v) <= EPS) continue;
		if (v > 0) positives.push([sym, v]);
		else negatives.push([sym, -v]);
	}

	// Native SOL flows
	const {
		inSOL: nativeInSOL,
		outSOL: nativeOutSOL,
		outs,
		ins
	} = nativeSolInOut(nativeTransfers, address);
	const maxOut = outs.length ? Math.max(...outs) : 0;
	const maxIn = ins.length ? Math.max(...ins) : 0;

	// --- BUY heuristic: 1 token in, 0 token out, with native SOL out
	if (positives.length === 1 && negatives.length === 0 && nativeOutSOL > 0) {
		// require the largest native out to dominate (real swap payment), or be a Pump/GMGN tx
		const dominates =
			maxOut >= 0.01 ||
			maxOut >= 0.5 * nativeOutSOL ||
			srcU.includes("PUMP") ||
			srcU.includes("GMGN");
		if (!dominates) return null;

		const [inSym, inAmt] = positives[0];
		const outSym = "SOL";
		const outAmt = maxOut; // treat the biggest native out as the swap payment
		let extraTipSOL = nativeOutSOL - outAmt - nativeInSOL; // leftover -> fees (tips/rent)
		if (!Number.isFinite(extraTipSOL) || extraTipSOL < 0) extraTipSOL = 0;
		// sanity cap for weird cases (we don't expect > ~0.5 SOL in tips)
		if (extraTipSOL > 0.5) extraTipSOL = 0;

		return { inAmt, inSym, outAmt, outSym, extraTipSOL };
	}

	// --- SELL heuristic: 1 token out, 0 token in, with native SOL in
	if (negatives.length === 1 && positives.length === 0 && nativeInSOL > 0) {
		const dominates =
			maxIn >= 0.01 ||
			maxIn >= 0.5 * nativeInSOL ||
			srcU.includes("PUMP") ||
			srcU.includes("GMGN");
		if (!dominates) return null;

		const [outSym, outAmt] = negatives[0];
		const inSym = "SOL";
		const inAmt = maxIn; // treat the biggest native in as proceeds
		// fees likely appear as small native outs (priority/aggregator/rent)
		let extraTipSOL = sum(outs, (x) => x);
		if (!Number.isFinite(extraTipSOL) || extraTipSOL < 0) extraTipSOL = 0;
		if (extraTipSOL > 0.5) extraTipSOL = 0;

		return { inAmt, inSym, outAmt, outSym, extraTipSOL };
	}

	return null;
}

/** Derive two swap legs for routed swaps (fallback). */
function deriveRoutedSwapLegs(
	tokenTransfers: TokenTransferPlus[],
	address: string,
	myATAs: Set<string>,
	includeNFT: boolean,
	resolveSymDec: (
		mint: string,
		symbol?: string,
		decimals?: number
	) => { symbol: string; decimals: number }
): Array<{ inAmt: number; inSym: string; outAmt: number; outSym: string }> {
	const inTotals = new Map<string, number>();
	const outTotals = new Map<string, number>();

	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? myATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? myATAs.has(t.toTokenAccount) : false);

	for (const t of tokenTransfers) {
		if (!includeNFT && (t.tokenStandard === "nft" || (t as any).isNFT))
			continue;
		const { amountNum, symbol } = amountFromTransfer(t, resolveSymDec);
		if (!Number.isFinite(amountNum) || amountNum === 0) continue;
		if (ownsTo(t))
			inTotals.set(symbol, (inTotals.get(symbol) ?? 0) + amountNum);
		if (ownsFrom(t))
			outTotals.set(symbol, (outTotals.get(symbol) ?? 0) + amountNum);
	}

	if (inTotals.size < 2 || outTotals.size < 2) return [];

	// AFTER
	const bridges: Array<{ sym: string; flow: number }> = [];
	for (const [sym, inAmt] of inTotals.entries()) {
		const outAmt = outTotals.get(sym) ?? 0;
		if (inAmt > 0 && outAmt > 0) {
			const rel = Math.abs(inAmt - outAmt) / Math.max(inAmt, outAmt);
			if (rel <= 0.01) {
				bridges.push({ sym: sym, flow: Math.max(inAmt, outAmt) });
			}
		}
	}

	if (bridges.length === 0) return [];
	bridges.sort((a, b) => b.flow - a.flow);
	const bridgeSym = bridges[0].sym;

	const outsNonBridge = [...outTotals.entries()]
		.filter(([s]) => s !== bridgeSym)
		.sort((a, b) => b[1] - a[1]);
	const insNonBridge = [...inTotals.entries()]
		.filter(([s]) => s !== bridgeSym)
		.sort((a, b) => b[1] - a[1]);

	if (outsNonBridge.length === 0 || insNonBridge.length === 0) return [];

	const firstSpend =
		outsNonBridge.find(([s]) => s === "SOL") ?? outsNonBridge[0];

	const leg1 = {
		outSym: firstSpend[0],
		outAmt: firstSpend[1],
		inSym: bridgeSym,
		inAmt: inTotals.get(bridgeSym) || 0
	};

	const gain = insNonBridge[0];
	const leg2 = {
		outSym: bridgeSym,
		outAmt: outTotals.get(bridgeSym) || 0,
		inSym: gain[0],
		inAmt: gain[1]
	};

	const legs = [leg1, leg2].filter(
		(l) => l.inAmt > 0 && l.outAmt > 0 && l.inSym !== l.outSym
	);

	if (
		legs.length === 2 &&
		legs[0].inSym === legs[1].inSym &&
		legs[0].outSym === legs[1].outSym
	) {
		return [legs[0]];
	}
	return legs;
}

/* ================= Dust helpers ================= */

type DustMode =
	| "off"
	| "remove"
	| "aggregate-signer"
	| "aggregate-period"
	| "aggregate";
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

	// week -> ISO Monday
	const base = new Date(`${d}T00:00:00Z`);
	const dow = base.getUTCDay(); // 0..6
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
	// week end = Sunday
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
		getSigner?: (sig: string) => string | undefined;
		selfAddress?: string;
	}
): KSRow[] {
	const { mode, threshold, interval, useOslo, getSigner, selfAddress } = opts;

	if (mode === "off" || threshold <= 0) return rows;

	if (mode === "remove") {
		return rows.filter((r) => {
			if (!isTransferRow(r)) return true;
			const info = directionAndCurrency(r);
			if (!info) return true;
			return info.amt >= threshold;
		});
	}

	const finish = (keep: KSRow[], aggRows: KSRow[]) =>
		[...keep, ...aggRows].sort((a, b) =>
			a.Tidspunkt < b.Tidspunkt ? -1 : a.Tidspunkt > b.Tidspunkt ? 1 : 0
		);

	if (mode === "aggregate-signer" || mode === "aggregate") {
		type AggKey = string; // `${bucket}|${dir}|${sym}|${signer}`
		type AggVal = {
			count: number;
			totalAmt: number;
			totalFeeSOL: number;
			bucketMs: number;
			dir: "INN" | "UT";
			sym: string;
			signer: string;
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

			const sig = extractSigFromNotat(r.Notat || "");
			const signer =
				(sig && getSigner?.(sig)) ||
				(info.dir === "UT" ? selfAddress : undefined) ||
				"UNKNOWN";

			const bucket = bucketKeyFromTidspunkt(r.Tidspunkt, interval);
			const key = `${bucket}|${info.dir}|${info.sym}|${signer}`;
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
					sym: info.sym,
					signer
				});
			}
		}

		const aggRows: KSRow[] = [];
		const short = (a: string) =>
			a && a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

		for (const [, v] of agg.entries()) {
			const nowMs = Date.now();
			const cappedMs = Math.min(v.bucketMs, nowMs);
			const ts = toNorwayTimeString(cappedMs, useOslo);

			const type: KSRow["Type"] = v.dir === "INN" ? "Erverv" : "Overføring-Ut";
			const inn = v.dir === "INN" ? numberToPlain(v.totalAmt) : "0";
			const ut = v.dir === "UT" ? numberToPlain(v.totalAmt) : "0";
			const gebyr = v.totalFeeSOL > 0 ? numberToPlain(v.totalFeeSOL) : "0";
			const signerNote =
				v.signer && v.signer !== "UNKNOWN" ? short(v.signer) : "ukjent";

			aggRows.push({
				Tidspunkt: ts,
				Type: type,
				Inn: toAmountString(inn),
				"Inn-Valuta": v.dir === "INN" ? currencyCode(v.sym) : "",
				Ut: toAmountString(ut),
				"Ut-Valuta": v.dir === "UT" ? currencyCode(v.sym) : "",
				Gebyr: toAmountString(gebyr),
				"Gebyr-Valuta": v.totalFeeSOL > 0 ? "SOL" : "",
				Marked: "AGGREGERT-STØV",
				Notat: `agg:${v.count} støv < ${threshold} fra:${signerNote}`
			});
		}

		return finish(keep, aggRows);
	}

	if (mode === "aggregate-period") {
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

			if (info.amt < threshold) {
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
				continue;
			}

			// >= threshold
			keep.push(r);
		}

		const aggRows: KSRow[] = [];
		for (const [, v] of agg.entries()) {
			const nowMs = Date.now();
			const cappedMs = Math.min(v.bucketMs, nowMs);
			const ts = toNorwayTimeString(cappedMs, useOslo);

			// aggregate-period: prefer Erverv for INN
			const type: KSRow["Type"] = v.dir === "INN" ? "Erverv" : "Overføring-Ut";

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
				Marked: "AGGREGERT-STØV",
				Notat: `agg:${v.count} støv < ${threshold}`
			});
		}

		return finish(keep, aggRows);
	}

	return rows;
}

/* ================= Wallet tag for Notat ================= */
function walletTag(address: string, walletName?: string): string {
	if (walletName && walletName.trim()) return walletName.trim();
	return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

/* ================= Liquidity detection (CLMM + CPMM) ================= */

type LiquidityKind =
	| "clmm-add"
	| "clmm-remove"
	| "cpmm-add"
	| "cpmm-remove"
	| "amm-add"
	| "amm-remove";

type LiquidityDetection = {
	kind: LiquidityKind;
	protocol: "RAYDIUM" | "ORCA" | "METEORA" | "SABER" | "PUMPFUN" | "UNKNOWN";
	note: "LIQUIDITY ADD" | "LIQUIDITY REMOVE";
	outs?: Array<{ sym: string; amount: number | string }>;
	ins?: Array<{ sym: string; amount: number | string }>;
	nft?: { symbol: string; amountText: string } | null;
};

function isLikelyNFT(t: TokenTransferPlus): boolean {
	if (t.tokenStandard === "nft" || (t as any).isNFT) return true;
	const raw = t.rawTokenAmount?.tokenAmount ?? String(t.tokenAmount ?? "");
	const dec =
		typeof t.rawTokenAmount?.decimals === "number"
			? (t.rawTokenAmount!.decimals as number)
			: t.decimals;
	return dec === 0 && (raw === "1" || raw === "1.0");
}

function protocolFromSource(source: string): LiquidityDetection["protocol"] {
	const s = String(source || "").toUpperCase();
	if (s.includes("PUMP")) return "PUMPFUN";
	if (s.includes("RAYDIUM")) return "RAYDIUM";
	if (s.includes("ORCA")) return "ORCA";
	if (s.includes("METEORA") || s.includes("DLMM")) return "METEORA";
	if (s.includes("SABER")) return "SABER";
	return "UNKNOWN";
}

function looksCLMM(source: string): boolean {
	const s = String(source || "").toUpperCase();
	return (
		s.includes("CLMM") ||
		s.includes("CONCENTRATED") ||
		s.includes("WHIRLPOOL") ||
		s.includes("DLMM")
	);
}

function extractSigFromNotat(notat: string): string | undefined {
	const m = /sig:([A-Za-z0-9]+)/.exec(notat);
	return m ? m[1] : undefined;
}

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
	const srcU = String(source || "").toUpperCase();

	// Never classify aggregator flows OR Pump.fun swaps as liquidity
	if (
		srcU.includes("JUPITER") ||
		srcU.includes("AGGREGATOR") ||
		srcU.includes("GMGN")
	) {
		return null;
	}

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

	// Detect if SOL is already represented as token (WSOL), then ignore native legs to avoid ATA rent noise
	let hasTokenSOL = false;
	for (const t of [...fIn, ...fOut]) {
		const { symbol } = amountFromTransfer(t, resolveSymDec);
		if (symbol === "SOL") {
			hasTokenSOL = true;
			break;
		}
	}

	// Include native SOL legs only if WSOL not present
	const nativeInSOL = !hasTokenSOL
		? nativeTransfers
				.filter((n) => n.toUserAccount === address)
				.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0)
		: 0;
	const nativeOutSOL = !hasTokenSOL
		? nativeTransfers
				.filter((n) => n.fromUserAccount === address)
				.reduce((a, n) => a + lamportsToSol(n.amount ?? 0), 0)
		: 0;

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

	const distinctIns = new Set(ins.map((x) => x.sym)).size;
	const distinctOuts = new Set(outs.map((x) => x.sym)).size;

	// If this looks like a simple swap (1 in, 1 out), do not treat as liquidity
	if (distinctIns === 1 && distinctOuts === 1) return null;

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

	// Fungible LP heuristics
	const lpIn = fIn.filter((t) => {
		const { symbol } = amountFromTransfer(t, resolveSymDec);
		return symbol.includes("LP");
	});
	const lpOut = fOut.filter((t) => {
		const { symbol } = amountFromTransfer(t, resolveSymDec);
		return symbol.includes("LP");
	});

	if (lpIn.length >= 1 && distinctOuts >= 2) {
		return {
			kind: modelCLMM ? "clmm-add" : "cpmm-add",
			protocol: srcU.includes("PUMP") ? "PUMPFUN" : protocol,
			note: "LIQUIDITY ADD",
			outs
		};
	}
	if (lpOut.length >= 1 && distinctIns >= 2) {
		return {
			kind: modelCLMM ? "clmm-remove" : "cpmm-remove",
			protocol: srcU.includes("PUMP") ? "PUMPFUN" : protocol,
			note: "LIQUIDITY REMOVE",
			ins
		};
	}

	// Strict leg patterns (prevents swaps from matching)
	if (distinctOuts >= 2 && distinctIns === 0) {
		return {
			kind: modelCLMM ? "clmm-add" : "cpmm-add",
			protocol,
			note: "LIQUIDITY ADD",
			outs
		};
	}
	if (distinctIns >= 2 && distinctOuts === 0) {
		return {
			kind: modelCLMM ? "clmm-remove" : "cpmm-remove",
			protocol,
			note: "LIQUIDITY REMOVE",
			ins
		};
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

	const txATAs = buildTxATAsSet(tokenTransfers, address, myATAs);

	const source: string =
		(tx as any).source || (tx as any).programId || "solana";
	const srcU = String(source || "").toUpperCase();

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
			Notat: `${noteSuffix ? `${noteSuffix} ` : ""}sig:${sig}`
		});
	};

	// === 1) Liquidity detection (ignore aggregators) ===
	const liq = detectLiquidityEvent(
		tokenTransfers,
		nativeTransfers,
		address,
		txATAs,
		resolveSymDec,
		source
	);
	if (liq) {
		const market =
			liq.protocol === "PUMPFUN"
				? "Pump.fun-LIQUIDITY"
				: `${liq.protocol}-LIQUIDITY`;

		if (
			liq.kind === "clmm-add" ||
			liq.kind === "cpmm-add" ||
			liq.kind === "amm-add"
		) {
			for (const leg of liq.outs ?? []) {
				pushRow(
					{
						Type: "Tap",
						Inn: 0,
						"Inn-Valuta": "",
						Ut: leg.amount,
						"Ut-Valuta": leg.sym,
						Marked: market
					},
					liq.note
				);
			}
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
		}
		return rows;
	}

	// === 2) Primary collapse: token ↔ token (already works for routed swaps)
	{
		const collapsed = collapseTokenNetToSingleHandel(
			tokenTransfers,
			nativeTransfers,
			address,
			txATAs,
			includeNFT,
			resolveSymDec
		);
		if (collapsed) {
			const { inAmt, inSym, outAmt, outSym, extraTipSOL } = collapsed;
			if (extraTipSOL > 0) feeLeftSOL += extraTipSOL;

			const market = srcU.includes("GMGN")
				? "GMGN"
				: srcU.includes("JUPITER")
				? "JUPITER"
				: srcU.includes("RAYDIUM")
				? "RAYDIUM"
				: srcU.includes("ORCA")
				? "ORCA"
				: srcU.includes("METEORA")
				? "METEORA"
				: srcU.includes("PUMP")
				? "Pump.fun"
				: "SOLANA DEX";

			pushRow({
				Type: "Handel",
				Inn: inAmt,
				"Inn-Valuta": inSym,
				Ut: outAmt,
				"Ut-Valuta": outSym,
				Marked: market
			});
			return rows;
		}
	}

	// === 2b) NEW collapse: token ↔ native SOL (Pump.fun buys/sells)
	{
		const hybrid = collapseHybridTokenNativeSwap(
			tokenTransfers,
			nativeTransfers,
			address,
			txATAs,
			includeNFT,
			resolveSymDec,
			srcU
		);
		if (hybrid) {
			const { inAmt, inSym, outAmt, outSym, extraTipSOL } = hybrid;
			if (extraTipSOL > 0) feeLeftSOL += extraTipSOL;

			const market = srcU.includes("PUMP")
				? "Pump.fun"
				: srcU.includes("GMGN")
				? "GMGN"
				: "SOLANA DEX";

			pushRow({
				Type: "Handel",
				Inn: inAmt,
				"Inn-Valuta": inSym,
				Ut: outAmt,
				"Ut-Valuta": outSym,
				Marked: market
			});
			return rows;
		}
	}

	// === 3) Fallback: routed legs → single Handel
	{
		const legs = deriveRoutedSwapLegs(
			tokenTransfers,
			address,
			txATAs,
			includeNFT,
			resolveSymDec
		);

		if (legs.length >= 2) {
			const ownsFrom = (t: TokenTransferPlus) =>
				t.fromUserAccount === address ||
				(t.fromTokenAccount ? txATAs.has(t.fromTokenAccount) : false);
			const tokenSolOut = (tokenTransfers || []).reduce((acc, t) => {
				if (!ownsFrom(t)) return acc;
				const { amountNum, symbol } = amountFromTransfer(t, resolveSymDec);
				return (
					acc +
					(symbol === "SOL" ? (Number.isFinite(amountNum) ? amountNum : 0) : 0)
				);
			}, 0);
			const { inSOL: nativeInSOL, outSOL: nativeOutSOL } = nativeSolInOut(
				nativeTransfers,
				address
			);
			let extraTipSOL = nativeOutSOL - tokenSolOut - nativeInSOL;
			if (!Number.isFinite(extraTipSOL)) extraTipSOL = 0;
			if (extraTipSOL < 0) extraTipSOL = 0;
			if (extraTipSOL > 0.5) extraTipSOL = 0;
			if (extraTipSOL > 0) feeLeftSOL += extraTipSOL;

			const market = srcU.includes("GMGN")
				? "GMGN"
				: srcU.includes("JUPITER")
				? "JUPITER"
				: "SOLANA DEX";

			const first = legs[0];
			const last = legs[legs.length - 1];

			pushRow({
				Type: "Handel",
				Inn: last.inAmt,
				"Inn-Valuta": last.inSym,
				Ut: first.outAmt,
				"Ut-Valuta": first.outSym,
				Marked: market
			});
			return rows;
		}
	}

	// === 4) Native SOL transfers (fallback) ===
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

	// === 5) SPL token transfers (fallback) ===
	const ownsFrom = (t: TokenTransferPlus) =>
		t.fromUserAccount === address ||
		(t.fromTokenAccount ? txATAs.has(t.fromTokenAccount) : false);
	const ownsTo = (t: TokenTransferPlus) =>
		t.toUserAccount === address ||
		(t.toTokenAccount ? txATAs.has(t.toTokenAccount) : false);

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

	// 6) Airdrops -> Erverv
	if ((tx.type || "").toUpperCase().includes("AIRDROP")) {
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

	// 7) Staking rewards -> Inntekt
	const rewardLamports = (tx.events as any)?.stakingReward?.amount ?? 0;
	if (
		rewardLamports > 0 ||
		String(tx.type || "")
			.toUpperCase()
			.includes("REWARD")
	) {
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
	tokenSymbols?: Record<string, string>;
	symbols?: Record<string, string>;
	markets?: Record<string, string>;
};

function applyOverridesToRows<T extends KSRow>(
	rows: T[],
	overrides?: OverridesPayload
): T[] {
	if (!overrides) return rows;

	const tokenMapRaw = overrides.tokenSymbols ?? overrides.symbols ?? {};
	const marketMap = overrides.markets ?? {};

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

/* ================= Shared pipeline ================= */

type Ctx = {
	address: string;
	walletTag: string;
	fromISO?: string;
	toISO?: string;
	includeNFT: boolean;
	useOslo: boolean;
	dustMode: DustMode;
	dustThreshold: number;
	dustInterval: DustInterval;
	cacheKey: string;
};

type ScanResult = {
	myATAs: Set<string>;
	sigMap: Map<string, HeliusTx>;
	sigToSigner: Map<string, string>;
};

type MetaResult = {
	resolveSymDec: ReturnType<typeof makeSymDecResolver>;
};

type ClassifyResult = {
	rowsRaw: KSRow[];
	rowsProcessed: KSRow[];
	count: number;
	rawCount: number;
};

const MAX_PAGES = 50;

const shortAddr = (a: string) =>
	a && a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

const parseDustThreshold = (v: unknown) =>
	typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : 0;

const asISO = (v?: string) => (v ? new Date(v).toISOString() : undefined);

const attachSigAndSigner = (
	rows: KSRow[],
	tag: string,
	sigToSigner: Map<string, string> | Record<string, string>
) => {
	const map =
		sigToSigner instanceof Map
			? sigToSigner
			: new Map(Object.entries(sigToSigner || {}));
	return rows.map((r) => {
		const withTag = { ...r, Notat: `${tag} - ${r.Notat}` };
		const sig = extractSigFromNotat(withTag.Notat || "");
		const signer = sig ? map.get(sig) : undefined;
		return { ...withTag, signature: sig, signer };
	});
};

const getOrNull = (key: string) => {
	const v = getCache(key);
	return v ? { ...v, sigToSigner: v.sigToSigner ?? {} } : null;
};
const putCache = (key: string, payload: Omit<CacheVal, "createdAt">) =>
	setCache(key, { ...payload, createdAt: Date.now() });

type Progress =
	| { type: "log"; message: string }
	| {
			type: "page";
			page: number;
			maxPages: number;
			addressShort: string;
			kind: "main" | "ata";
			idx: number;
			totalATAs: number;
	  }
	| {
			type: "addrDone";
			pages: number;
			kind: "main" | "ata";
			idx: number;
			totalATAs: number;
			addressShort: string;
	  };

async function scanAddresses(
	address: string,
	fromISO: string | undefined,
	toISO: string | undefined,
	onProgress?: (p: Progress) => void
): Promise<ScanResult> {
	onProgress?.({ type: "log", message: "Henter token-kontoer (ATAer) …" });
	const tokenAccounts = await getTokenAccountsByOwner(
		address,
		process.env.HELIUS_API_KEY
	);
	const myATAs = new Set<string>(tokenAccounts);
	myATAs.add(address);

	onProgress?.({
		type: "log",
		message: `Fant ${tokenAccounts.length} tilknyttede token-kontoer (ATAer). Skanner alle for å få med SPL-bevegelser.`
	});

	const addressesToQuery = [address, ...tokenAccounts];
	const sigMap = new Map<string, HeliusTx>();
	const sigToSigner = new Map<string, string>();
	const missing = new Set<string>();

	for (let ai = 0; ai < addressesToQuery.length; ai++) {
		const who = addressesToQuery[ai];
		const isMain = ai === 0;
		let pages = 0;

		if (isMain)
			onProgress?.({ type: "log", message: "Skanner hovedadresse …" });
		else if (ai === 1)
			onProgress?.({ type: "log", message: "Skanner ATAer …" });

		for await (const txPage of fetchEnhancedTxs({
			address: who,
			fromISO,
			toISO,
			apiKey: process.env.HELIUS_API_KEY,
			limit: 100,
			maxPages: MAX_PAGES
		})) {
			pages++;
			for (const tx of txPage) {
				if (!tx?.signature) continue;
				sigMap.set(tx.signature, tx);

				const fpRaw: unknown = (tx as any).feePayer;
				if (typeof fpRaw === "string" && fpRaw) {
					sigToSigner.set(tx.signature, fpRaw);
				} else {
					missing.add(tx.signature);
				}
			}
			onProgress?.({
				type: "page",
				page: pages,
				maxPages: MAX_PAGES,
				addressShort: shortAddr(who),
				kind: isMain ? "main" : "ata",
				idx: isMain ? 0 : ai - 1,
				totalATAs: tokenAccounts.length
			});
			if (pages >= MAX_PAGES) break;
		}

		onProgress?.({
			type: "addrDone",
			pages,
			kind: isMain ? "main" : "ata",
			idx: isMain ? 0 : ai - 1,
			totalATAs: tokenAccounts.length,
			addressShort: shortAddr(who)
		});
	}

	if (missing.size > 0) {
		onProgress?.({
			type: "log",
			message: "Henter manglende signer-adresser …"
		});
		const jobs = [...missing].map(async (s) => {
			try {
				const fp = await fetchFeePayer(s, process.env.HELIUS_API_KEY);
				if (fp) sigToSigner.set(s, fp);
			} catch {}
		});
		await Promise.allSettled(jobs);
	}

	return { myATAs, sigMap, sigToSigner };
}

function collectMints(allTxs: HeliusTx[]): string[] {
	const set = new Set<string>();
	for (const tx of allTxs) {
		for (const t of tx.tokenTransfers ?? []) {
			if (!t?.mint) continue;
			const hasSym =
				typeof (t as any).tokenSymbol === "string" &&
				(t as any).tokenSymbol.length > 0;
			const hasHint = Boolean(hintFor(t.mint));
			if (!hasSym && !hasHint) set.add(t.mint);
		}
	}
	return [...set];
}

async function getResolver(mints: string[]): Promise<MetaResult> {
	const jupMeta = mints.length
		? await fetchJupiterTokenMetadataMap(mints)
		: new Map<string, { symbol?: string; decimals?: number }>();
	const still = mints.filter((m) => !jupMeta.has(m));
	const helMeta = still.length
		? await fetchTokenMetadataMap(still, process.env.HELIUS_API_KEY)
		: new Map<string, { symbol?: string; decimals?: number }>();
	return { resolveSymDec: makeSymDecResolver(jupMeta, helMeta) };
}

function classifyAll({
	allTxs,
	address,
	myATAs,
	includeNFT,
	useOslo,
	resolveSymDec,
	fromISO,
	toISO
}: {
	allTxs: HeliusTx[];
	address: string;
	myATAs: Set<string>;
	includeNFT: boolean;
	useOslo: boolean;
	resolveSymDec: MetaResult["resolveSymDec"];
	fromISO?: string;
	toISO?: string;
}): KSRow[] {
	const fromMs = fromISO ? new Date(fromISO).getTime() : undefined;
	const toMs = toISO ? new Date(toISO).getTime() : undefined;
	const out: KSRow[] = [];
	for (const tx of allTxs) {
		try {
			const tsSec = tx.timestamp ?? Math.floor(Date.now() / 1000);
			const tsMs = tsSec * 1000;
			if (
				!(
					(fromMs === undefined || tsMs >= fromMs) &&
					(toMs === undefined || tsMs <= toMs)
				)
			)
				continue;
			out.push(
				...classifyTxToRows({
					tx,
					address,
					myATAs,
					includeNFT,
					useOslo,
					resolveSymDec
				})
			);
		} catch {}
	}
	return out;
}

function postProcessAndCache(
	ctx: Ctx,
	rows: KSRow[],
	sigMapOrSigner: Map<string, HeliusTx> | Map<string, string>,
	selfSignerMap?: Map<string, string>
) {
	const getSigner = selfSignerMap
		? (s: string) => (s ? selfSignerMap.get(s) : undefined)
		: (s: string) => {
				const tx = s
					? (sigMapOrSigner as Map<string, HeliusTx>).get(s)
					: undefined;
				const fp = (tx as any)?.feePayer;
				return typeof fp === "string" && fp ? fp : undefined;
		  };

	const processed = processDust(rows, {
		mode: ctx.dustMode,
		threshold: ctx.dustThreshold,
		interval: ctx.dustInterval,
		useOslo: ctx.useOslo,
		getSigner,
		selfAddress: ctx.address
	});

	const res: ClassifyResult = {
		rowsRaw: rows,
		rowsProcessed: processed,
		count: processed.length,
		rawCount: rows.length
	};

	putCache(ctx.cacheKey, {
		rowsProcessed: processed,
		count: res.count,
		rawCount: res.rawCount,
		sigToSigner: selfSignerMap
			? Object.fromEntries(selfSignerMap.entries())
			: undefined
	});

	return res;
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
	useOslo?: boolean;
	overrides?: OverridesPayload;
}

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as Body;

		const address = String(body.address || "").trim();
		if (!address) {
			return NextResponse.json({ error: "Missing address" }, { status: 400 });
		}

		const fromISO = asISO(body.fromISO);
		const toISO = asISO(body.toISO);

		const includeNFT = Boolean(body.includeNFT ?? false);
		const useOslo = Boolean(body.useOslo ?? false);

		const rawDustMode = (body.dustMode ?? "off") as DustMode;
		const dustMode: DustMode = (
			rawDustMode === "aggregate" ? "aggregate-period" : rawDustMode
		) as DustMode;
		const dustThresholdNum = parseDustThreshold(body.dustThreshold);
		const dustThreshold = Number.isFinite(dustThresholdNum)
			? dustThresholdNum
			: 0;
		const dustInterval: DustInterval = (body.dustInterval ??
			"day") as DustInterval;

		const sp = req.nextUrl?.searchParams;
		const wantNDJSON = sp?.get("format")?.toLowerCase() === "ndjson";
		const wantJSON = sp?.get("format")?.toLowerCase() === "json";
		const useCache = sp?.get("useCache") === "1";

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

		const walletTagStr = walletTag(address, body.walletName);
		const ctx: Ctx = {
			address,
			walletTag: walletTagStr,
			fromISO,
			toISO,
			includeNFT,
			useOslo,
			dustMode,
			dustThreshold,
			dustInterval,
			cacheKey: ckey
		};

		/* ---------- NDJSON streaming (preview with progress) ---------- */
		if (wantNDJSON) {
			const stream = new ReadableStream({
				async start(controller) {
					const enc = new TextEncoder();
					const send = (obj: any) =>
						controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

					const cached = getOrNull(ckey);
					if (cached) {
						const rowsPreview = attachSigAndSigner(
							cached.rowsProcessed.slice(0, 500),
							walletTagStr,
							cached.sigToSigner
						);

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

					try {
						await send({
							type: "log",
							message: "Henter token-kontoer (ATAer) …"
						});
						const scan = await scanAddresses(address, fromISO, toISO, (p) =>
							send(p)
						);
						const allTxs = [...scan.sigMap.values()].sort(
							(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
						);

						await send({ type: "log", message: "Henter token metadata …" });
						const mints = collectMints(allTxs);
						const { resolveSymDec } = await getResolver(mints);

						/* ---------- Classify into KS rows ---------- */
						const rows = classifyAll({
							allTxs,
							address,
							myATAs: scan.myATAs,
							includeNFT,
							useOslo,
							resolveSymDec,
							fromISO,
							toISO
						});

						const result = postProcessAndCache(
							ctx,
							rows,
							scan.sigMap,
							scan.sigToSigner
						);
						const rowsPreview = attachSigAndSigner(
							result.rowsProcessed.slice(0, 500),
							walletTagStr,
							scan.sigToSigner
						);

						await send({
							type: "done",
							data: {
								rowsPreview,
								count: result.count,
								rawCount: result.rawCount,
								cacheKey: ckey
							}
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
			const cached = getOrNull(ckey);
			if (cached) {
				const rowsOutRaw = attachSigAndSigner(
					cached.rowsProcessed,
					walletTagStr,
					cached.sigToSigner
				);
				const rowsOut = applyOverridesToRows(rowsOutRaw, body.overrides);
				return NextResponse.json({
					rows: rowsOut,
					count: cached.count,
					rawCount: cached.rawCount,
					cacheKey: ckey
				});
			}

			const scan = await scanAddresses(address, fromISO, toISO);
			const allTxs = [...scan.sigMap.values()].sort(
				(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
			);

			const { resolveSymDec } = await getResolver(collectMints(allTxs));
			const rows = classifyAll({
				allTxs,
				address,
				myATAs: scan.myATAs,
				includeNFT,
				useOslo,
				resolveSymDec,
				fromISO,
				toISO
			});

			const result = postProcessAndCache(
				ctx,
				rows,
				scan.sigMap,
				scan.sigToSigner
			);
			const rowsOutRaw = attachSigAndSigner(
				result.rowsProcessed,
				walletTagStr,
				scan.sigToSigner
			);
			const rowsOut = applyOverridesToRows(rowsOutRaw, body.overrides);

			return NextResponse.json({
				rows: rowsOut,
				count: result.count,
				rawCount: result.rawCount,
				cacheKey: ckey
			});
		}

		/* ---------- CSV (use cache if available) ---------- */
		const cached = useCache ? getOrNull(ckey) : null;
		if (cached) {
			const rowsWithTag = cached.rowsProcessed.map((r) => ({
				...r,
				Notat: `${walletTagStr} - ${r.Notat}`
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
		const scan = await scanAddresses(address, fromISO, toISO);
		const allTxs = [...scan.sigMap.values()].sort(
			(a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
		);

		const { resolveSymDec } = await getResolver(collectMints(allTxs));
		const rows = classifyAll({
			allTxs,
			address,
			myATAs: scan.myATAs,
			includeNFT,
			useOslo,
			resolveSymDec,
			fromISO,
			toISO
		});

		const result = postProcessAndCache(
			ctx,
			rows,
			scan.sigMap /* fee payer via tx */
		);
		const rowsWithTag = result.rowsProcessed.map((r) => ({
			...r,
			Notat: `${walletTagStr} - ${r.Notat}`
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
