// app/api/kryptosekken/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
	fetchEnhancedTxs,
	fetchTokenMetadataMap,
	fetchJupiterTokenMetadataMap,
	getTokenAccountsByOwner,
	HeliusTx,
	NativeTransfer,
	TokenTransfer,
	fetchFeePayer,
	getOwnersOfTokenAccounts,
	fetchAnchorIdlName
} from "@/lib/helius";
import {
	KSRow,
	rowsToCSV,
	toAmountString,
	toNorwayTimeString,
	currencyCode
} from "@/lib/kryptosekken";
import { hintFor } from "@/lib/tokenMap";
import { programLabelFor } from "@/lib/programMap";

/** Ensure env vars are readable at runtime (no static optimization). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ================= In-memory cache ================= */
type ScanResume = {
	nextAddressIndex: number;
	beforeByAddress: Record<string, string>;
};

type CacheVal = {
	rowsProcessed: KSRow[];
	rawCount: number;
	count: number;
	createdAt: number;
	partial?: boolean;
	sigMap?: Record<string, HeliusTx>;
	resume?: ScanResume;
	scanSessionId?: string;
	sigToSigner?: Record<string, string>;
	recipients?: Record<string, string>;
	programIds?: Record<string, string>;
	programNames?: Record<string, string>;
};

const CACHE = new Map<string, CacheVal>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_FREE_GRANT = 50;

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function sha256Hex(value: string) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function isEmailVerified(user: any) {
	return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

async function ensureFreeGrant(
	admin: ReturnType<typeof createSupabaseAdminClient>,
	user: any
) {
	const email = user?.email as string | undefined;
	if (!email || !isEmailVerified(user)) {
		if (process.env.NODE_ENV === "development") {
			console.log("[ensureFreeGrant] No grant:", {
				hasEmail: !!email,
				emailVerified: isEmailVerified(user),
				email_confirmed_at: user?.email_confirmed_at,
				confirmed_at: user?.confirmed_at
			});
		}
		return { grant: 0, rawUsed: 0, emailHash: null as string | null };
	}
	const emailHash = sha256Hex(normalizeEmail(email));
	const { data: existing } = await admin
		.from("billing_email_grants")
		.select("credits_granted, raw_used")
		.eq("email_hash", emailHash)
		.maybeSingle();
	if (existing) {
		return {
			grant: existing.credits_granted ?? DEFAULT_FREE_GRANT,
			rawUsed: existing.raw_used ?? 0,
			emailHash
		};
	}
	const { error: insertError } = await admin
		.from("billing_email_grants")
		.insert({
			email_hash: emailHash,
			raw_used: 0,
			credits_granted: DEFAULT_FREE_GRANT
		});
	if (insertError) {
		if (insertError.code === "23505") {
			const { data: retry } = await admin
				.from("billing_email_grants")
				.select("credits_granted, raw_used")
				.eq("email_hash", emailHash)
				.maybeSingle();
			return {
				grant: retry?.credits_granted ?? DEFAULT_FREE_GRANT,
				rawUsed: retry?.raw_used ?? 0,
				emailHash
			};
		}
		return { grant: 0, rawUsed: 0, emailHash };
	}
	return { grant: DEFAULT_FREE_GRANT, rawUsed: 0, emailHash };
}

async function ensureUsageRow(
	supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>,
	userId: string
) {
	const { data } = await supabase
		.from("billing_user_usage")
		.select("raw_tx_used")
		.eq("user_id", userId)
		.maybeSingle();
	if (data) return data.raw_tx_used ?? 0;
	const { data: inserted } = await supabase
		.from("billing_user_usage")
		.insert({ user_id: userId })
		.select("raw_tx_used")
		.single();
	return inserted?.raw_tx_used ?? 0;
}

async function ensureCreditsRow(
	supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>,
	userId: string
) {
	const { data } = await supabase
		.from("billing_user_credits")
		.select("credits_remaining")
		.eq("user_id", userId)
		.maybeSingle();
	if (data) return data.credits_remaining ?? 0;
	const { data: inserted } = await supabase
		.from("billing_user_credits")
		.insert({ user_id: userId })
		.select("credits_remaining")
		.single();
	return inserted?.credits_remaining ?? 0;
}

async function getAvailableRawTx(
	supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>,
	userId: string,
	freeGrant: number,
	freeUsed: number
) {
	const rawUsed = await ensureUsageRow(supabase, userId);
	const creditsRemaining = await ensureCreditsRow(supabase, userId);
	const { data: usageEvents } = await supabase
		.from("billing_usage_events")
		.select("raw_count")
		.eq("user_id", userId);
	const totalBilled = Array.isArray(usageEvents)
		? usageEvents.reduce((sum, row) => sum + (row.raw_count ?? 0), 0)
		: 0;
	const effectiveRawUsed = Math.max(rawUsed, totalBilled);
	const freeRemaining = Math.max(0, freeGrant - freeUsed);
	const availableRawTx = freeRemaining + creditsRemaining;
	return {
		rawUsed: effectiveRawUsed,
		freeRemaining,
		creditsRemaining,
		availableRawTx
	};
}

async function consumeRawUsage(
	supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>,
	admin: ReturnType<typeof createSupabaseAdminClient>,
	userId: string,
	rawCount: number,
	cacheKey: string,
	freeGrant: number,
	freeUsed: number,
	emailHash: string | null
) {
	if (!Number.isFinite(rawCount) || rawCount <= 0) {
		return { ok: true, charged: 0, freeRemaining: 0, creditsRemaining: 0 };
	}

	const { data: existing } = await supabase
		.from("billing_usage_events")
		.select("id, raw_count")
		.eq("user_id", userId)
		.eq("cache_key", cacheKey)
		.maybeSingle();
	const alreadyBilled = existing?.raw_count ?? 0;
	const rawUsed = await ensureUsageRow(supabase, userId);
	const creditsRemaining = await ensureCreditsRow(supabase, userId);
	const { data: usageEvents } = await supabase
		.from("billing_usage_events")
		.select("raw_count")
		.eq("user_id", userId);
	const totalBilled = Array.isArray(usageEvents)
		? usageEvents.reduce((sum, row) => sum + (row.raw_count ?? 0), 0)
		: 0;
	const effectiveRawUsed = Math.max(rawUsed, alreadyBilled, totalBilled);
	const freeRemaining = Math.max(0, freeGrant - freeUsed);
	const deltaRaw = Math.max(0, rawCount - alreadyBilled);
	if (deltaRaw <= 0) {
		if (effectiveRawUsed > rawUsed) {
			const now = new Date().toISOString();
			const { error: usageErr } = await supabase
				.from("billing_user_usage")
				.update({ raw_tx_used: effectiveRawUsed, updated_at: now })
				.eq("user_id", userId);
			if (usageErr) {
				return {
					ok: false,
					error: usageErr.message,
					freeRemaining,
					creditsRemaining
				};
			}
		}
		return { ok: true, charged: 0, freeRemaining, creditsRemaining };
	}

	const requiredCredits = Math.max(0, deltaRaw - freeRemaining);

	if (requiredCredits > creditsRemaining) {
		return {
			ok: false,
			requiredCredits,
			creditsRemaining,
			freeRemaining
		};
	}

	const now = new Date().toISOString();
	const targetRawUsed = effectiveRawUsed + deltaRaw;
	const targetCredits = creditsRemaining - requiredCredits;
	const { error: usageErr } = await supabase
		.from("billing_user_usage")
		.update({ raw_tx_used: targetRawUsed, updated_at: now })
		.eq("user_id", userId);
	if (usageErr) {
		return {
			ok: false,
			error: usageErr.message,
			freeRemaining,
			creditsRemaining
		};
	}

	if (requiredCredits > 0) {
		const { error: creditsErr } = await supabase
			.from("billing_user_credits")
			.update({
				credits_remaining: targetCredits,
				updated_at: now
			})
			.eq("user_id", userId);
		if (creditsErr) {
			// rollback usage update if credits update fails
			await supabase
				.from("billing_user_usage")
				.update({ raw_tx_used: effectiveRawUsed, updated_at: now })
				.eq("user_id", userId);
			return {
				ok: false,
				error: creditsErr.message,
				freeRemaining,
				creditsRemaining
			};
		}
	}

	if (emailHash && freeGrant > 0 && deltaRaw > 0) {
		const consumedFree = Math.max(0, Math.min(deltaRaw, freeRemaining));
		await admin
			.from("billing_email_grants")
			.update({ raw_used: freeUsed + consumedFree })
			.eq("email_hash", emailHash);
	}

	if (existing) {
		const { error: eventErr } = await supabase
			.from("billing_usage_events")
			.update({ raw_count: rawCount, created_at: now })
			.eq("user_id", userId)
			.eq("cache_key", cacheKey);
		if (eventErr) {
			// rollback usage/credits if event update fails
			await supabase
				.from("billing_user_usage")
				.update({ raw_tx_used: effectiveRawUsed, updated_at: now })
				.eq("user_id", userId);
			if (requiredCredits > 0) {
				await supabase
					.from("billing_user_credits")
					.update({ credits_remaining: creditsRemaining, updated_at: now })
					.eq("user_id", userId);
			}
			return {
				ok: false,
				error: eventErr.message,
				freeRemaining,
				creditsRemaining
			};
		}
	} else {
		const { error: eventErr } = await supabase
			.from("billing_usage_events")
			.insert({
				user_id: userId,
				cache_key: cacheKey,
				raw_count: rawCount
			});
		if (eventErr) {
			// rollback usage/credits if event insert fails
			await supabase
				.from("billing_user_usage")
				.update({ raw_tx_used: effectiveRawUsed, updated_at: now })
				.eq("user_id", userId);
			if (requiredCredits > 0) {
				await supabase
					.from("billing_user_credits")
					.update({ credits_remaining: creditsRemaining, updated_at: now })
					.eq("user_id", userId);
			}
			return {
				ok: false,
				error: eventErr.message,
				freeRemaining,
				creditsRemaining
			};
		}
	}

	return {
		ok: true,
		charged: requiredCredits,
		freeRemaining: Math.max(0, freeRemaining - deltaRaw),
		creditsRemaining: creditsRemaining - requiredCredits
	};
}

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

function mapFromRecord<T>(rec?: Record<string, T>): Map<string, T> {
	return new Map(Object.entries(rec ?? {}));
}

/* ================= Numbers & helpers ================= */

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsToSol(l: number | string): number {
	const n = typeof l === "string" ? parseInt(l, 10) : l;
	return n / LAMPORTS_PER_SOL;
}
// Debug flag: set DEBUG_KS=1 to emit classification traces.
const DEBUG_KS = process.env.DEBUG_KS === "1";
function dbg(label: string, payload: any) {
	if (!DEBUG_KS) return;
	try {
		console.log(`[KS-DEBUG] ${label}: ${JSON.stringify(payload)}`);
	} catch {
		console.log(`[KS-DEBUG] ${label}`);
	}
}
function pickNativeRecipient(tx: HeliusTx, self: string): string | undefined {
	const outs = (tx.nativeTransfers ?? []).filter(
		(n) => n?.fromUserAccount === self
	);
	if (!outs.length) return undefined;
	outs.sort((a, b) => Number(b?.amount ?? 0) - Number(a?.amount ?? 0));
	return outs[0]?.toUserAccount;
}

// CHANGE this helper to NOT fall back to token account
function pickTokenRecipient(tx: HeliusTx, self: string): string | undefined {
	const outs = (tx.tokenTransfers ?? []).filter(
		(t: any) => t?.fromUserAccount === self
	);
	if (!outs.length) return undefined;
	const amt = (t: any) =>
		Number(t?.rawTokenAmount?.tokenAmount ?? t?.tokenAmount ?? 0);
	outs.sort((a: any, b: any) => amt(b) - amt(a));
	return outs[0]?.toUserAccount || undefined; // <-- only real wallet
}

function pickAnyRecipient(tx: HeliusTx, self: string): string | undefined {
	return pickNativeRecipient(tx, self) ?? pickTokenRecipient(tx, self);
}

function pickAnySender(tx: HeliusTx, self: string): string | undefined {
	// largest native in
	const insN = (tx.nativeTransfers ?? []).filter(
		(n) => n?.toUserAccount === self
	);
	if (insN.length) {
		insN.sort((a, b) => Number(b?.amount ?? 0) - Number(a?.amount ?? 0));
		return insN[0]?.fromUserAccount;
	}
	// largest token in
	const insT = (tx.tokenTransfers ?? []).filter(
		(t: any) => t?.toUserAccount === self
	);
	if (insT.length) {
		const amt = (t: any) =>
			Number(t?.rawTokenAmount?.tokenAmount ?? t?.tokenAmount ?? 0);
		insT.sort((a: any, b: any) => amt(b) - amt(a));
		// prefer user account, else token account
		return insT[0]?.fromUserAccount ?? insT[0]?.fromTokenAccount;
	}
	return undefined;
}

function pickAnyCounterparty(tx: HeliusTx, self: string): string | undefined {
	// Outgoing → recipient; Incoming → sender
	return pickAnyRecipient(tx, self) ?? pickAnySender(tx, self);
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

		let sym =
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
						: (hint?.decimals ?? 6);

		// Guard: only the native SOL mint should resolve to SOL.
		if (
			mint !== "So11111111111111111111111111111111111111112" &&
			String(sym || "")
				.trim()
				.toUpperCase() === "SOL"
		) {
			sym = `TOKEN-${mint.slice(0, 6)}`;
		}

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

// Some indexers omit tokenTransfers for balance deltas surfaced in accountData; synthesize lightweight transfers so swaps can still be classified.
function synthesizeTokenTransfersFromAccountData(
	tx: HeliusTx,
	address: string,
	existing?: TokenTransferPlus[]
): TokenTransferPlus[] {
	const out: TokenTransferPlus[] = [];
	const data = (tx as any)?.accountData;
	if (!Array.isArray(data)) return out;

	const addrLc = address.toLowerCase();
	const existingTokenAccounts = new Set<string>();
	for (const t of existing ?? []) {
		if (t?.fromTokenAccount) existingTokenAccounts.add(t.fromTokenAccount);
		if (t?.toTokenAccount) existingTokenAccounts.add(t.toTokenAccount);
	}

	for (const entry of data) {
		const changes = entry?.tokenBalanceChanges;
		if (!Array.isArray(changes)) continue;

		for (const ch of changes) {
			const user =
				typeof ch?.userAccount === "string" ? ch.userAccount : undefined;
			if (!user || user.toLowerCase() !== addrLc) continue;

			const mint = typeof ch?.mint === "string" ? ch.mint : undefined;
			const tokenAccount =
				typeof ch?.tokenAccount === "string" ? ch.tokenAccount : undefined;
			const rawObj = ch?.rawTokenAmount || {};
			const tokenAmountRaw =
				typeof rawObj?.tokenAmount === "string"
					? rawObj.tokenAmount
					: typeof ch?.tokenAmount === "string"
						? ch.tokenAmount
						: undefined;
			const decimals =
				typeof rawObj?.decimals === "number"
					? rawObj.decimals
					: typeof ch?.decimals === "number"
						? ch.decimals
						: undefined;

			if (!mint || !tokenAmountRaw) continue;
			if (tokenAccount && existingTokenAccounts.has(tokenAccount)) continue; // already have a concrete transfer for this ATA
			const trimmed = tokenAmountRaw.trim();
			if (!trimmed) continue;

			const isOut = trimmed.startsWith("-");
			const absRaw = isOut ? trimmed.slice(1) : trimmed;
			if (!absRaw || Number(absRaw) === 0) continue;

			out.push({
				mint,
				rawTokenAmount: { tokenAmount: absRaw, decimals },
				fromUserAccount: isOut ? address : undefined,
				toUserAccount: isOut ? undefined : address,
				fromTokenAccount: isOut ? tokenAccount : undefined,
				toTokenAccount: isOut ? undefined : tokenAccount,
				tokenStandard: ch?.tokenStandard,
				isNFT: ch?.isNFT
			});
		}
	}

	return out;
}

function mergeTokenTransfers(
	base: TokenTransferPlus[],
	extras: TokenTransferPlus[]
): TokenTransferPlus[] {
	const sig = (t: TokenTransferPlus) =>
		[
			t.mint,
			t.fromUserAccount || "",
			t.toUserAccount || "",
			t.fromTokenAccount || "",
			t.toTokenAccount || "",
			t.rawTokenAmount?.tokenAmount || t.tokenAmount || ""
		].join("|");

	const seen = new Set<string>(base.map(sig));
	const out = [...base];
	for (const t of extras) {
		const k = sig(t);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(t);
	}
	return out;
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
	srcU: string,
	lamportsDeltaSOL?: number
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
	const totalPos = positives.reduce((a, [, v]) => a + v, 0);
	const totalNeg = negatives.reduce((a, [, v]) => a + v, 0);

	// Native SOL flows
	const base = nativeSolInOut(nativeTransfers, address);
	let nativeInSOL = base.inSOL;
	let nativeOutSOL = base.outSOL;
	const outs = [...base.outs];
	const ins = [...base.ins];

	// If no native in/out is present but lamports delta indicates net flow, synthesize it (helps Pump.fun sells without nativeTransfers in the record).
	if (
		typeof lamportsDeltaSOL === "number" &&
		Math.abs(lamportsDeltaSOL) > 1e-9
	) {
		if (lamportsDeltaSOL > 0 && nativeInSOL === 0) {
			nativeInSOL = lamportsDeltaSOL;
			ins.push(lamportsDeltaSOL);
		} else if (lamportsDeltaSOL < 0 && nativeOutSOL === 0) {
			const amt = -lamportsDeltaSOL;
			nativeOutSOL = amt;
			outs.push(amt);
		}
	}

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
		// Guard: never emit Handel with identical currencies (e.g. SOL in/out)
		if (inSym === outSym) return null;
		let extraTipSOL = nativeOutSOL - outAmt - nativeInSOL; // leftover -> fees (tips/rent)
		if (!Number.isFinite(extraTipSOL) || extraTipSOL < 0) extraTipSOL = 0;
		// sanity cap for weird cases (we don't expect > ~0.5 SOL in tips)
		if (extraTipSOL > 0.5) extraTipSOL = 0;

		return { inAmt, inSym, outAmt, outSym, extraTipSOL };
	}

	// --- SELL heuristic: 1 token out, 0 token in, with native SOL in
	if (negatives.length === 1 && positives.length === 0 && nativeInSOL > 0) {
		// Require net SOL inflow; otherwise it's likely a stake/lock transfer, not a sale.
		if (nativeInSOL <= nativeOutSOL + 1e-9) return null;
		const dominates =
			maxIn >= 0.01 ||
			maxIn >= 0.5 * nativeInSOL ||
			srcU.includes("PUMP") ||
			srcU.includes("GMGN");
		if (!dominates) return null;

		const [outSym, outAmt] = negatives[0];
		const inSym = "SOL";
		const inAmt = maxIn; // treat the biggest native in as proceeds
		// Guard: never emit Handel with identical currencies (e.g. SOL in/out)
		if (inSym === outSym) return null;
		// fees likely appear as small native outs (priority/aggregator/rent)
		let extraTipSOL = sum(outs, (x) => x);
		if (!Number.isFinite(extraTipSOL) || extraTipSOL < 0) extraTipSOL = 0;
		if (extraTipSOL > 0.5) extraTipSOL = 0;

		return { inAmt, inSym, outAmt, outSym, extraTipSOL };
	}

	// --- SELL heuristic (relaxed for Pump/GMGN): dominant token out, small token-in noise allowed
	if (
		negatives.length >= 1 &&
		nativeInSOL > 0 &&
		(srcU.includes("PUMP") || srcU.includes("GMGN"))
	) {
		if (nativeInSOL <= nativeOutSOL + 1e-9) return null;
		const sortedNeg = [...negatives].sort((a, b) => b[1] - a[1]);
		const [outSym, outAmt] = sortedNeg[0];
		const otherNeg = totalNeg - outAmt;
		const posNoise = totalPos;
		const dominant = outAmt >= 0.7 * totalNeg;
		const noiseSmall = posNoise <= 0.05 * outAmt && otherNeg <= 0.05 * outAmt;
		if (dominant && noiseSmall) {
			const inSym = "SOL";
			const inAmt = maxIn;
			let extraTipSOL = sum(outs, (x) => x);
			if (!Number.isFinite(extraTipSOL) || extraTipSOL < 0) extraTipSOL = 0;
			if (extraTipSOL > 0.5) extraTipSOL = 0;
			return { inAmt, inSym, outAmt, outSym, extraTipSOL };
		}
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

function bucketStartDateMs(key: string, interval: DustInterval): number {
	if (interval === "day") {
		const dt = new Date(`${key}T00:00:00Z`);
		return dt.getTime();
	}
	if (interval === "month") {
		const [y, m] = key.split("-");
		const year = parseInt(y, 10);
		const month = parseInt(m, 10);
		const first = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
		return first.getTime();
	}
	if (interval === "year") {
		const year = parseInt(key, 10);
		const first = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
		return first.getTime();
	}
	// week -> key is Monday start
	const start = new Date(`${key}T00:00:00Z`);
	return start.getTime();
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
			if (
				String(r.Marked || "")
					.toUpperCase()
					.includes("LIQUIDITY")
			)
				return true;
			const info = directionAndCurrency(r);
			if (!info) return true;
			return info.amt >= threshold; // Keep rows above threshold
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
			bucketKey: string;
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

			if (
				String(r.Marked || "")
					.toUpperCase()
					.includes("LIQUIDITY")
			) {
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
					bucketKey: bucket,
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

			const startMs = bucketStartDateMs(v.bucketKey, interval);
			const startCappedMs = Math.min(startMs, cappedMs);
			const startTs = toNorwayTimeString(startCappedMs, useOslo);
			const endTs = toNorwayTimeString(cappedMs, useOslo);

			aggRows.push({
				Tidspunkt: ts,
				Type: type,
				Inn: toAmountString(inn),
				"Inn-Valuta": v.dir === "INN" ? currencyCode(v.sym) : "",
				Ut: toAmountString(ut),
				"Ut-Valuta": v.dir === "UT" ? currencyCode(v.sym) : "",
				Gebyr: toAmountString(gebyr),
				"Gebyr-Valuta": v.totalFeeSOL > 0 ? "SOL" : "",
				Marked: "AGG-DUST",
				Notat: `Aggregert: ${v.count} støv mindre enn ${threshold} fra:${signerNote} tidsrom: ${startTs} - ${endTs}`
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
			bucketKey: string;
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
						bucketKey: bucket,
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

			const startMs = bucketStartDateMs(v.bucketKey, interval);
			const startCappedMs = Math.min(startMs, cappedMs);
			const startTs = toNorwayTimeString(startCappedMs, useOslo);
			const endTs = toNorwayTimeString(cappedMs, useOslo);

			aggRows.push({
				Tidspunkt: ts,
				Type: type,
				Inn: toAmountString(inn),
				"Inn-Valuta": v.dir === "INN" ? currencyCode(v.sym) : "",
				Ut: toAmountString(ut),
				"Ut-Valuta": v.dir === "UT" ? currencyCode(v.sym) : "",
				Gebyr: toAmountString(gebyr),
				"Gebyr-Valuta": v.totalFeeSOL > 0 ? "SOL" : "",
				Marked: "AGG-DUST",
				Notat: `Aggregert: ${v.count} støv mindre enn ${threshold} tidsrom: ${startTs} - ${endTs}`
			});
		}

		return finish(keep, aggRows);
	}

	return rows;
}
function consolidateRowsBySignature(
	rows: KSRow[],
	txBySig: Map<string, HeliusTx> | undefined,
	address: string,
	dustThreshold?: number
): KSRow[] {
	const groups = new Map<string, KSRow[]>();
	const specials: KSRow[] = [];

	for (const r of rows) {
		const sig = extractSigFromNotat(r.Notat || "");
		// keep dust aggregates or rows without a signature as-is
		if (
			!sig ||
			r.Marked === "AGG-DUST" ||
			r.Notat.startsWith("agg:") ||
			r.Notat.startsWith("Aggregert:")
		) {
			specials.push(r);
			continue;
		}
		const arr = groups.get(sig) || [];
		arr.push(r);
		groups.set(sig, arr);
	}

	const dec = (s: string) => {
		const n = parseFloat((s || "0").replace(/,/g, ""));
		return Number.isFinite(n) ? n : 0;
	};

	const preferMarket = (cands: string[]): string => {
		// preference order
		const rank = (mkt: string) => {
			const u = (mkt || "").toUpperCase();
			if (u.includes("LIQUIDITY")) return 10;
			if (u.includes("PUMP")) return 9;
			if (u.includes("GMGN")) return 8;
			if (u.includes("JUPITER")) return 7;
			if (u.includes("RAYDIUM")) return 6;
			if (u.includes("ORCA")) return 5;
			if (u.includes("METEORA")) return 4;
			if (u.includes("SABER")) return 3;
			if (u.includes("SOLANA DEX")) return 2;
			if (u === "SOLANA" || u === "SPL" || u === "SOLANA-NFT") return 1;
			return 0;
		};
		let best = "";
		let bestScore = -1;
		// most frequent, then by rank
		const freq = new Map<string, number>();
		for (const m of cands) freq.set(m, (freq.get(m) || 0) + 1);
		for (const [m, f] of freq.entries()) {
			const s = f * 100 + rank(m);
			if (s > bestScore) {
				bestScore = s;
				best = m;
			}
		}
		return best || (cands[0] ?? "");
	};

	const isDexy = (m: string) => {
		const u = (m || "").toUpperCase();
		return (
			u.includes("JUPITER") ||
			u.includes("DEX") ||
			u.includes("RAYDIUM") ||
			u.includes("ORCA") ||
			u.includes("METEORA") ||
			u.includes("GMGN") ||
			u.includes("PUMP")
		);
	};

	const out: KSRow[] = [...specials];
	const dustT =
		typeof dustThreshold === "number" && dustThreshold > 0 ? dustThreshold : 0;

	for (const [sig, arr] of groups.entries()) {
		if (arr.length === 1) {
			out.push(arr[0]);
			continue;
		}

		// Keep liquidity rows separate; they represent per-asset swaps vs LP token.
		if (
			arr.some(
				(r) =>
					String(r.Marked || "")
						.toUpperCase()
						.includes("LIQUIDITY") ||
					String(r.Notat || "")
						.toUpperCase()
						.includes("LIQUIDITY")
			)
		) {
			for (const r of arr) out.push(r);
			continue;
		}

		// If this signature contains *only* transfer rows and all legs are below the dust threshold,
		// keep them as separate IN/OUT rows (do not collapse into a single net row).
		if (dustT > 0 && arr.every(isTransferRow)) {
			const legs = arr.map((r) => directionAndCurrency(r));
			if (legs.every(Boolean) && legs.every((l) => (l as any).amt < dustT)) {
				for (const r of arr) out.push(r);
				continue;
			}
		}

		// gather totals
		const pos = new Map<string, number>(); // Inn by symbol
		const neg = new Map<string, number>(); // Ut by symbol
		let feeSOL = 0;
		const markets: string[] = [];
		let time = arr[0].Tidspunkt;

		// keep a helpful note prefix if present, e.g. "LIQUIDITY ADD"
		const notePrefix = (
			arr
				.find((r) => r.Notat.toUpperCase().includes("LIQUIDITY"))
				?.Notat.split("sig:")[0] || ""
		).trim();

		for (const r of arr) {
			time = r.Tidspunkt > time ? r.Tidspunkt : time;
			markets.push(r.Marked);
			feeSOL += dec(r.Gebyr);

			const inn = dec(r.Inn);
			const innSym = (r["Inn-Valuta"] || "").trim();
			const ut = dec(r.Ut);
			const utSym = (r["Ut-Valuta"] || "").trim();

			if (inn > 0 && innSym) pos.set(innSym, (pos.get(innSym) || 0) + inn);
			if (ut > 0 && utSym) neg.set(utSym, (neg.get(utSym) || 0) + ut);
		}

		const market = preferMarket(markets);

		const pickLargest = (m: Map<string, number>) => {
			let best: [string, number] | null = null;
			for (const [sym, val] of m.entries()) {
				if (!best || val > best[1]) best = [sym, val];
			}
			return best;
		};

		const hasPos = pos.size > 0;
		const hasNeg = neg.size > 0;

		// If it looks like a plain transfer (no DEX/AMM-like market), use real native delta.
		const treatAsTransfer = !Array.from(new Set(markets)).some(isDexy);

		const tx = txBySig ? txBySig.get(sig) : undefined;
		const nativeDelta = tx ? getUserLamportsDeltaSOL(tx, address) : null;
		const posHasNonSOL = [...pos.keys()].some((s) => s !== "SOL");
		const negNonSolEntries = [...neg.entries()].filter(([s]) => s !== "SOL");

		let type: KSRow["Type"];
		let innAmt = 0,
			innSym = "";
		let utAmt = 0,
			utSym = "";

		if (hasPos && hasNeg) {
			const forcedTransfer =
				nativeDelta != null &&
				nativeDelta <= 0 &&
				!posHasNonSOL &&
				negNonSolEntries.length > 0;

			if (forcedTransfer) {
				const [sym, amt] = negNonSolEntries.reduce(
					(best, curr) => (!best || curr[1] > best[1] ? curr : best),
					null as [string, number] | null
				)!;
				type = "Overføring-Ut";
				utSym = sym;
				utAmt = amt;
			} else if (treatAsTransfer && txBySig) {
				if (nativeDelta != null && nativeDelta !== 0) {
					// 🔁 Changed: classify as Overføring-Inn / Overføring-Ut (not Erverv/Tap) for non-liquidity signatures
					if (nativeDelta > 0) {
						type = "Overføring-Inn";
						innAmt = nativeDelta + feeSOL; // gross in; net = innAmt - feeSOL = nativeDelta
						innSym = "SOL";
					} else {
						type = "Overføring-Ut";
						utAmt = Math.max(0, -nativeDelta - feeSOL); // gross out; net = -utAmt - feeSOL = nativeDelta
						utSym = "SOL";
					}
				} else {
					// fallback to swap-like
					const p = pickLargest(pos)!;
					const n = pickLargest(neg)!;
					// Guard: never emit Handel with identical currencies (e.g. SOL vs WSOL collapse)
					if (p[0] === n[0]) {
						const net = p[1] - n[1];
						if (Math.abs(net) < 1e-9) {
							// No meaningful movement; keep original rows
							for (const r of arr) out.push(r);
							continue;
						}
						type = net > 0 ? "Overføring-Inn" : "Overføring-Ut";
						if (net > 0) {
							innSym = p[0];
							innAmt = net;
						} else {
							utSym = n[0];
							utAmt = -net;
						}
					} else {
						type = "Handel";
						innSym = p[0];
						innAmt = p[1];
						utSym = n[0];
						utAmt = n[1];
					}
				}
			} else {
				// swap-like
				const p = pickLargest(pos)!;
				const n = pickLargest(neg)!;
				// Guard: never emit Handel with identical currencies (e.g. SOL vs WSOL collapse)
				if (p[0] === n[0]) {
					const net = p[1] - n[1];
					if (Math.abs(net) < 1e-9) {
						for (const r of arr) out.push(r);
						continue;
					}
					type = net > 0 ? "Overføring-Inn" : "Overføring-Ut";
					if (net > 0) {
						innSym = p[0];
						innAmt = net;
					} else {
						utSym = n[0];
						utAmt = -net;
					}
				} else {
					type = "Handel";
					innSym = p[0];
					innAmt = p[1];
					utSym = n[0];
					utAmt = n[1];
				}
			}
		} else if (hasPos) {
			const p = pickLargest(pos)!;
			// 🔁 Changed: Overføring-Inn instead of Erverv
			type = "Overføring-Inn";
			innSym = p[0];
			innAmt = p[1];
		} else if (hasNeg) {
			const n = pickLargest(neg)!;
			// 🔁 Changed: Overføring-Ut instead of Tap
			type = "Overføring-Ut";
			utSym = n[0];
			utAmt = n[1];
		} else {
			// nothing meaningful — keep first row
			out.push(arr[0]);
			continue;
		}

		const prefix = notePrefix ? notePrefix + " " : "";
		out.push({
			Tidspunkt: time,
			Type: type,
			Inn: innAmt > 0 ? toAmountString(numberToPlain(innAmt)) : "0",
			"Inn-Valuta": innAmt > 0 ? currencyCode(innSym) : "",
			Ut: utAmt > 0 ? toAmountString(numberToPlain(utAmt)) : "0",
			"Ut-Valuta": utAmt > 0 ? currencyCode(utSym) : "",
			Gebyr: feeSOL > 0 ? toAmountString(numberToPlain(feeSOL)) : "0",
			"Gebyr-Valuta": feeSOL > 0 ? "SOL" : "",
			Marked: market || "SOLANA",
			Notat: `${prefix}sig:${sig}`
		});
	}

	// keep stable order
	out.sort((a, b) =>
		a.Tidspunkt < b.Tidspunkt ? -1 : a.Tidspunkt > b.Tidspunkt ? 1 : 0
	);
	return out;
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
	protocol:
		| "RAYDIUM"
		| "ORCA"
		| "METEORA"
		| "SABER"
		| "PUMPFUN"
		| "LIFINITY"
		| "ALDRIN"
		| "MERCURIAL"
		| "CREMA"
		| "UNKNOWN";
	note: "LIQUIDITY ADD" | "LIQUIDITY REMOVE";
	outs?: Array<{ sym: string; amount: number | string }>;
	ins?: Array<{ sym: string; amount: number | string }>;
	lpToken?: { symbol: string; amountText: string } | null;
	nft?: { symbol: string; amountText: string } | null;
};

function buildLpSymbol(
	outs: Array<{ sym: string; amount: number | string }>,
	ins: Array<{ sym: string; amount: number | string }>,
	fallback?: string
): string | undefined {
	const isLpSymbol = (sym: string) =>
		/(^LP$|[-_ ]LP$|\bLP\b|LP TOKEN)/i.test(String(sym || "").trim());
	const norm = (s: string | undefined) => currencyCode(s || "");
	const all = [...outs, ...ins]
		.map((x) => ({
			sym: norm(x.sym),
			amt: decStrToNum(String(x.amount ?? "0"))
		}))
		.filter((x) => x.sym && !isLpSymbol(x.sym) && x.sym !== "UNKNOWN");
	all.sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
	const uniq: string[] = [];
	for (const x of all) {
		if (!uniq.includes(x.sym)) uniq.push(x.sym);
		if (uniq.length >= 2) break;
	}
	const hasSOL = all.some((x) => x.sym === "SOL");
	if (uniq.length === 2) return `${uniq[0]}-${uniq[1]}-LP`;
	if (uniq.length === 1) {
		if (hasSOL && uniq[0] !== "SOL") return `${uniq[0]}-SOL-LP`;
		return `${uniq[0]}-LP`;
	}
	return fallback || undefined;
}

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
	if (s.includes("LIFINITY")) return "LIFINITY";
	if (s.includes("ALDRIN")) return "ALDRIN";
	if (s.includes("MERCURIAL")) return "MERCURIAL";
	if (s.includes("CREMA")) return "CREMA";
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
	source: string,
	sig?: string
): LiquidityDetection | null {
	const srcU = String(source || "").toUpperCase();

	// Never classify aggregator flows or GMGN as liquidity
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
	const nftInOwned = tokenTransfers.filter((t) => ownsTo(t) && isLikelyNFT(t));
	const nftOut = tokenTransfers.filter((t) => ownsFrom(t) && isLikelyNFT(t));
	// Some CLMM position NFTs are minted to a fresh ATA in the same tx without toUserAccount set; pick them up as inbound evidence.
	const nftMinted = tokenTransfers.filter(
		(t) => !ownsTo(t) && !ownsFrom(t) && isLikelyNFT(t)
	);
	const nftIn = [...nftInOwned, ...nftMinted];
	const fIn = tokenTransfers.filter((t) => ownsTo(t) && !isLikelyNFT(t));
	const fOut = tokenTransfers.filter((t) => ownsFrom(t) && !isLikelyNFT(t));

	// Detect if SOL is present as token (WSOL) -> ignore native legs to avoid ATA rent noise
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
	const isKnownAMM =
		protocol === "RAYDIUM" ||
		protocol === "ORCA" ||
		protocol === "METEORA" ||
		protocol === "SABER" ||
		protocol === "PUMPFUN" ||
		protocol === "LIFINITY" ||
		protocol === "ALDRIN" ||
		protocol === "MERCURIAL" ||
		protocol === "CREMA";

	// --- LP token detection
	// IMPORTANT: Do NOT use a broad "mint not in other side" heuristic for lpIn on remove,
	// otherwise we can accidentally pick the *underlying* token as the LP token.
	const isLpSymbol = (sym: string) =>
		/(^LP$|[-_ ]LP$|\bLP\b|LP TOKEN)/i.test(String(sym || "").trim());
	const outMints = new Set(fOut.map((t) => String(t.mint || "")));
	const inMints = new Set(fIn.map((t) => String(t.mint || "")));

	const pickLargest = <T>(arr: T[], score: (t: T) => number) =>
		arr.length ? [...arr].sort((a, b) => score(b) - score(a))[0] : undefined;
	const pickLpFromSide = (side: "in" | "out") => {
		const arr = side === "in" ? fIn : fOut;
		const otherMints = side === "in" ? outMints : inMints;
		const bySym = arr.filter((t) =>
			isLpSymbol(amountFromTransfer(t, resolveSymDec).symbol)
		);
		if (bySym.length) {
			return pickLargest(
				bySym,
				(x) => amountFromTransfer(x, resolveSymDec).amountNum
			);
		}
		// Structural fallback: often LP is the only token transfer on the minority side
		if (arr.length === 1) return arr[0];
		// Conservative mint-unique fallback: only if there is exactly one unique mint candidate
		const uniq = arr.filter((t) => {
			const mint = String(t.mint || "");
			return mint && !otherMints.has(mint);
		});
		const uniqMintCount = new Set(uniq.map((t) => String(t.mint || ""))).size;
		if (uniq.length && uniqMintCount === 1) {
			return pickLargest(
				uniq,
				(x) => amountFromTransfer(x, resolveSymDec).amountNum
			);
		}
		return undefined;
	};

	// Candidates (side-aware)
	const lpTokAdd = distinctOuts >= 2 ? pickLpFromSide("in") : undefined;
	const lpTokRemove = distinctIns >= 2 ? pickLpFromSide("out") : undefined;
	const hasLPToken = Boolean(lpTokAdd || lpTokRemove);
	let hasLPNFT = nftIn.length > 0 || nftOut.length > 0;

	// Fallback: some CLMM/Token-2022 mints may not surface as owned yet; infer a position NFT when a 0-decimal, qty≈1 mint is present anywhere in the tx.
	let inferredNFT: LiquidityDetection["nft"] = null;
	if (!hasLPToken && !hasLPNFT) {
		const nftCand = tokenTransfers.find((t) => {
			const dec =
				typeof t.rawTokenAmount?.decimals === "number"
					? t.rawTokenAmount.decimals
					: t.decimals;
			if (dec !== 0) return false;
			const amt = amountFromTransfer(t, resolveSymDec).amountNum;
			return Math.abs(amt - 1) <= 1e-6;
		});
		if (nftCand) {
			const { symbol, amountText } = amountFromTransfer(nftCand, resolveSymDec);
			inferredNFT = {
				symbol: symbol || `${protocol} LP`,
				amountText: amountText || "1"
			};
			hasLPNFT = true;
		}
	}

	const lpTokenFor = (side: "in" | "out"): LiquidityDetection["lpToken"] => {
		const t = side === "in" ? lpTokAdd : lpTokRemove;
		if (!t) return null;
		const { symbol, amountText } = amountFromTransfer(t, resolveSymDec);
		return { symbol, amountText };
	};

	// If the protocol is UNKNOWN and there is no LP token/NFT evidence, don't mark as liquidity.
	if (!isKnownAMM && !hasLPToken && !hasLPNFT) {
		return null;
	}

	// Structural liquidity rules (program-agnostic)
	const lpMintToken = lpTokenFor("in");
	const lpBurnToken = lpTokenFor("out");
	const lpNftMint = nftIn.length
		? nftIn[0]
		: inferredNFT
			? ({
					amountText: inferredNFT.amountText,
					symbol: inferredNFT.symbol
				} as any)
			: null;
	const lpNftBurn = nftOut.length ? nftOut[0] : null;
	const lpMintEvidence = Boolean(lpMintToken || lpNftMint);
	const lpBurnEvidence = Boolean(lpBurnToken || lpNftBurn);

	const lpSymAdd =
		lpMintToken?.symbol ||
		(lpNftMint
			? amountFromTransfer(lpNftMint as any, resolveSymDec).symbol
			: undefined);
	const lpSymRemove =
		lpBurnToken?.symbol ||
		(lpNftBurn
			? amountFromTransfer(lpNftBurn as any, resolveSymDec).symbol
			: undefined);

	const lpLabel = buildLpSymbol(outs, ins, lpSymAdd || lpSymRemove);
	const withLpLabel = <T extends LiquidityDetection["lpToken"]>(lp: T) =>
		lp ? { ...lp, symbol: lpLabel || lp.symbol } : lp;

	const nonLpOutSyms = new Set(
		outs
			.map((o) => String(o.sym || ""))
			.filter(
				(s) =>
					s &&
					!isLpSymbol(s) &&
					(!lpSymAdd || s.toUpperCase() !== String(lpSymAdd).toUpperCase())
			)
	);

	const nonLpInSyms = new Set(
		ins
			.map((i) => String(i.sym || ""))
			.filter(
				(s) =>
					s &&
					!isLpSymbol(s) &&
					(!lpSymRemove ||
						s.toUpperCase() !== String(lpSymRemove).toUpperCase())
			)
	);

	const isAddStruct =
		lpMintEvidence && nonLpOutSyms.size >= 2 && !lpBurnEvidence;
	const isRemoveStruct =
		lpBurnEvidence && nonLpInSyms.size >= 2 && !lpMintEvidence;
	const isRemoveNoLp =
		!lpMintEvidence &&
		!lpBurnEvidence &&
		nonLpInSyms.size >= 2 &&
		distinctOuts === 0;

	const lpTokAddSymbol = lpTokAdd
		? amountFromTransfer(lpTokAdd, resolveSymDec).symbol
		: null;
	const lpTokRemoveSymbol = lpTokRemove
		? amountFromTransfer(lpTokRemove, resolveSymDec).symbol
		: null;

	dbg("liq-detect", {
		sig,
		source,
		protocol,
		distinctIns,
		distinctOuts,
		lpMintEvidence,
		lpBurnEvidence,
		lpTokAdd: lpTokAddSymbol,
		lpTokRemove: lpTokRemoveSymbol,
		nftIn: nftIn.length,
		nftOut: nftOut.length,
		inferredNFT: Boolean(inferredNFT),
		lpLabel,
		isAddStruct,
		isRemoveStruct,
		outs: outs.map((o) => o.sym),
		ins: ins.map((i) => i.sym)
	});

	// Pump.fun: if no LP evidence, let swap path handle it (avoid mislabeling sells as liquidity)
	if (protocol === "PUMPFUN" && !isAddStruct && !isRemoveStruct) return null;

	if (isRemoveNoLp) {
		return {
			kind: modelCLMM ? "clmm-remove" : "amm-remove",
			protocol,
			note: "LIQUIDITY REMOVE",
			ins,
			outs,
			lpToken: null,
			nft: null
		};
	}

	if (isAddStruct) {
		return {
			kind: modelCLMM ? "clmm-add" : "cpmm-add",
			protocol,
			note: "LIQUIDITY ADD",
			outs,
			lpToken: withLpLabel(
				lpMintToken ??
					(lpNftMint
						? amountFromTransfer(lpNftMint as any, resolveSymDec)
						: null)
			),
			nft: lpNftMint
				? {
						symbol:
							lpLabel ||
							amountFromTransfer(lpNftMint as any, resolveSymDec).symbol ||
							"LP-NFT",
						amountText: amountFromTransfer(lpNftMint as any, resolveSymDec)
							.amountText
					}
				: undefined
		};
	}

	if (isRemoveStruct) {
		return {
			kind: modelCLMM ? "clmm-remove" : "cpmm-remove",
			protocol,
			note: "LIQUIDITY REMOVE",
			lpToken: withLpLabel(
				lpBurnToken ??
					(lpNftBurn
						? amountFromTransfer(lpNftBurn as any, resolveSymDec)
						: null)
			),
			nft: lpNftBurn
				? {
						symbol:
							lpLabel ||
							amountFromTransfer(lpNftBurn as any, resolveSymDec).symbol ||
							"LP-NFT",
						amountText: amountFromTransfer(lpNftBurn as any, resolveSymDec)
							.amountText
					}
				: undefined,
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

	const tokenTransfersRaw: TokenTransferPlus[] = Array.isArray(
		tx.tokenTransfers
	)
		? (tx.tokenTransfers as TokenTransferPlus[])
		: [];
	const tokenTransfers = mergeTokenTransfers(
		tokenTransfersRaw,
		synthesizeTokenTransfersFromAccountData(tx, address, tokenTransfersRaw)
	);

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
		source,
		sig
	);
	if (liq) {
		const market =
			liq.protocol === "PUMPFUN"
				? "Pump.fun LIQUIDITY"
				: `${liq.protocol} LIQUIDITY`;

		const isAdd =
			liq.kind === "clmm-add" ||
			liq.kind === "cpmm-add" ||
			liq.kind === "amm-add";

		// Required: represent add/remove liquidity as swaps vs the LP token.
		// ADD: sell each deposited token, buy equal share of LP token.
		// REMOVE: buy each received token, sell equal share of LP token.
		// Use explicit LP token when available; otherwise fall back to CLMM NFT positions as LP token.
		const lp =
			liq.lpToken ??
			(liq.nft
				? { symbol: liq.nft.symbol, amountText: liq.nft.amountText }
				: null);
		const hasRealLP = Boolean(liq.lpToken && liq.lpToken.symbol);
		// Pump.fun: allow Handel only when a real LP token is present; otherwise stay Tap/Erverv.
		const lpSwapAllowed = liq.protocol !== "PUMPFUN" || hasRealLP;
		if (lpSwapAllowed && lp?.symbol && lp?.amountText) {
			const lpSym = currencyCode(lp.symbol);
			let lpTotal = decStrToNum(lp.amountText);
			if (!Number.isFinite(lpTotal) || lpTotal <= 0) lpTotal = 1; // fallback for position NFTs
			const isLpSymbol = (sym: string) =>
				/(^LP$|[-_ ]LP$|\bLP\b|LP TOKEN)/i.test(String(sym || "").trim());

			const legsRaw = (isAdd ? liq.outs : liq.ins) ?? [];
			const legsMap = new Map<string, number>();
			for (const leg of legsRaw) {
				const symRaw = String(leg.sym || "").trim();
				const sym = symRaw || "UNKNOWN";
				if (sym.toUpperCase() === lpSym.toUpperCase()) continue;
				if (isLpSymbol(sym)) continue;
				const amt =
					typeof leg.amount === "number"
						? leg.amount
						: decStrToNum(String(leg.amount));
				if (!Number.isFinite(amt) || amt <= 0) continue;
				legsMap.set(sym, (legsMap.get(sym) || 0) + amt);
			}

			let syms = [...legsMap.keys()];
			if (!syms.length && legsRaw.length) {
				// Fallback: use raw legs even if symbols were blank
				for (const leg of legsRaw) {
					const sym = String(leg.sym || "UNKNOWN").trim() || "UNKNOWN";
					const amt =
						typeof leg.amount === "number"
							? leg.amount
							: decStrToNum(String(leg.amount));
					if (!Number.isFinite(amt) || amt <= 0) continue;
					legsMap.set(sym, (legsMap.get(sym) || 0) + amt);
				}
				syms = [...legsMap.keys()];
			}

			const parts = syms.length;
			const lpPer = parts > 0 ? lpTotal / parts : 0;
			if (lpPer > 0 && parts > 0) {
				for (const sym of syms) {
					const amt = legsMap.get(sym) || 0;
					pushRow(
						isAdd
							? {
									Type: "Handel",
									Inn: lpPer,
									"Inn-Valuta": lpSym,
									Ut: amt,
									"Ut-Valuta": sym,
									Marked: market
								}
							: {
									Type: "Handel",
									Inn: amt,
									"Inn-Valuta": sym,
									Ut: lpPer,
									"Ut-Valuta": lpSym,
									Marked: market
								},
						liq.note
					);
				}
				return rows;
			}
		}

		// Fallback if LP token cannot be determined
		if (!isAdd) {
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
			return rows;
		}

		// Fallback if LP token cannot be determined
		if (isAdd) {
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
		const lamDelta = getUserLamportsDeltaSOL(tx, address);
		const ownsFromTok = (t: TokenTransferPlus) =>
			t.fromUserAccount === address ||
			(t.fromTokenAccount ? txATAs.has(t.fromTokenAccount) : false);
		const ownsToTok = (t: TokenTransferPlus) =>
			t.toUserAccount === address ||
			(t.toTokenAccount ? txATAs.has(t.toTokenAccount) : false);
		const anyTokenOut = tokenTransfers.some(
			(t) => ownsFromTok(t) && !ownsToTok(t)
		);
		const anyTokenIn = tokenTransfers.some((t) => ownsToTok(t));
		const feeTol = userPaidFee && tx.fee ? lamportsToSol(tx.fee) + 1e-9 : 1e-9;
		// Stake/lock: only token OUT, no token IN, native net ~= fee → treat as Overføring-Ut
		if (
			anyTokenOut &&
			!anyTokenIn &&
			lamDelta != null &&
			Math.abs(lamDelta) <= feeTol
		) {
			for (const t of tokenTransfers) {
				if (!ownsFromTok(t) || ownsToTok(t)) continue;
				const { amountText, symbol } = amountFromTransfer(t, resolveSymDec);
				if (amountText === "0") continue;
				pushRow({
					Type: "Overføring-Ut",
					Inn: 0,
					"Inn-Valuta": "",
					Ut: amountText,
					"Ut-Valuta": symbol,
					Marked: srcU.includes("PUMP")
						? "Pump.fun"
						: String(source).toUpperCase() || "SPL"
				});
			}
			return rows;
		}

		// Unstake/claim pattern: only token coming IN, no token going out, native delta is just the fee → treat as Overføring-Inn.
		const feeOnlyNative =
			!nativeTransfers.length &&
			lamDelta &&
			Math.abs(lamDelta) <=
				(userPaidFee && tx.fee ? lamportsToSol(tx.fee) + 1e-9 : 1e-9);
		if (feeOnlyNative && anyTokenIn && !anyTokenOut) {
			for (const t of tokenTransfers) {
				if (!ownsToTok(t)) continue;
				const { amountText, symbol } = amountFromTransfer(t, resolveSymDec);
				if (amountText === "0") continue;
				pushRow({
					Type: "Overføring-Inn",
					Inn: amountText,
					"Inn-Valuta": symbol,
					Ut: 0,
					"Ut-Valuta": "",
					Marked: srcU.includes("PUMP")
						? "Pump.fun"
						: String(source).toUpperCase() || "SPL"
				});
			}
			return rows;
		}
		// Some PUMP/GMGN swaps lack nativeTransfers; fall back to lamport delta so we still classify as Handel.
		let hybridNative = nativeTransfers;
		// If the user only sends out a token and the native delta is just the fee, treat it as a transfer (staking/lockup), not a swap.
		if (feeOnlyNative && anyTokenOut && !anyTokenIn) {
			// Skip hybrid collapse so fallback SPL transfer emits Overføring-Ut.
			// (hybridNative remains as-is, which will skip collapseHybridTokenNativeSwap when empty)
			hybridNative = [];
		}

		if (
			!hybridNative.length &&
			lamDelta &&
			Math.abs(lamDelta) > 1e-9 &&
			!(feeOnlyNative && !anyTokenOut)
		) {
			const lamports = Math.round(lamDelta * LAMPORTS_PER_SOL);
			hybridNative = [
				lamDelta > 0
					? ({ amount: lamports, toUserAccount: address } as NativeTransfer)
					: ({
							amount: Math.abs(lamports),
							fromUserAccount: address
						} as NativeTransfer)
			];
		}

		const hybrid = collapseHybridTokenNativeSwap(
			tokenTransfers,
			hybridNative,
			address,
			txATAs,
			includeNFT,
			resolveSymDec,
			srcU,
			lamDelta ?? undefined
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
	// === 8) Safety net: if user's SOL balance changed, emit a transfer row
	{
		const delta = getUserLamportsDeltaSOL(tx, address);
		if (rows.length === 0 && delta && delta !== 0) {
			const feeSol = userPaidFee && tx.fee ? lamportsToSol(tx.fee) : 0;

			if (delta > 0) {
				// meta delta includes fee; add it back so amounts + Gebyr reconcile
				const grossIn = delta + feeSol;
				pushRow({
					Type: "Overføring-Inn",
					Inn: grossIn,
					"Inn-Valuta": "SOL",
					Ut: 0,
					"Ut-Valuta": "",
					Marked: "SOLANA"
				});
			} else {
				// meta delta includes fee; remove it so Gebyr carries the fee separately
				const grossOut = Math.max(0, -delta - feeSol);
				pushRow({
					Type: "Overføring-Ut",
					Inn: 0,
					"Inn-Valuta": "",
					Ut: grossOut,
					"Ut-Valuta": "SOL",
					Marked: "SOLANA"
				});
			}
			return rows;
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

type ScanSeed = {
	sigMap: Map<string, HeliusTx>;
	sigToSigner: Map<string, string>;
	sigToProgramId: Map<string, string>;
	sigToProgramName: Map<string, string>;
};

type ScanResult = {
	myATAs: Set<string>;
	sigMap: Map<string, HeliusTx>;
	sigToSigner: Map<string, string>;
	sigToProgramId: Map<string, string>;
	sigToProgramName: Map<string, string>;
	rawTxCount: number;
	partial: boolean;
	resume?: ScanResume;
};

type MetaResult = {
	resolveSymDec: ReturnType<typeof makeSymDecResolver>;
};

type ClassifyResult = {
	rowsRaw: KSRow[];
	rowsProcessed: KSRow[];
	count: number;
	rawCount: number;
	partial: boolean;
};

const MAX_PAGES = 50;

const shortAddr = (a: string) =>
	a && a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

const parseDustThreshold = (v: unknown) =>
	typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : 0;

const asISO = (v?: string) => (v ? new Date(v).toISOString() : undefined);

/** Stable row id for *tagged* rows (wallet tag already injected into Notat). */
function rowIdOfTagged(r: KSRow) {
	const sig = extractSigFromNotat(r.Notat || "") || "";
	const raw = [
		r.Tidspunkt,
		r.Type,
		r.Inn,
		r["Inn-Valuta"],
		r.Ut,
		r["Ut-Valuta"],
		r.Gebyr,
		r["Gebyr-Valuta"],
		r.Marked,
		sig
	].join("|");
	return crypto.createHash("sha1").update(raw).digest("hex");
}

const attachSigAndSigner = (
	rows: KSRow[],
	tag: string,
	sigToSigner: Map<string, string> | Record<string, string>,
	sigToOtherParty?: Map<string, string> | Record<string, string>,
	selfAddress?: string,
	sigToProgramId?: Map<string, string> | Record<string, string>,
	sigToProgramName?: Map<string, string> | Record<string, string>,
	sigMap?: Map<string, HeliusTx>
) => {
	const signerMap =
		sigToSigner instanceof Map
			? sigToSigner
			: new Map(Object.entries(sigToSigner || {}));
	const otherMap =
		sigToOtherParty instanceof Map
			? sigToOtherParty
			: new Map(Object.entries(sigToOtherParty || {}));
	const programMap =
		sigToProgramId instanceof Map
			? sigToProgramId
			: new Map(Object.entries(sigToProgramId || {}));
	const programNameMap =
		sigToProgramName instanceof Map
			? sigToProgramName
			: new Map(Object.entries(sigToProgramName || {}));

	return rows.map((r) => {
		const withTag = { ...r, Notat: `${tag} - ${r.Notat}` };
		const sig = extractSigFromNotat(withTag.Notat || "");
		const signer = sig ? signerMap.get(sig!) : undefined;
		const programId = sig ? programMap.get(sig!) : undefined;
		const programName = sig ? programNameMap.get(sig!) : undefined;
		const debugTx = sig ? sigMap?.get(sig) : undefined;

		// If this is a transfer and market is generic, prefer a known program name.
		const genericMarket = new Set(["SOLANA", "SPL", "UNKNOWN", "SOLANA DEX"]);
		const markedUpper = String(withTag.Marked || "")
			.trim()
			.toUpperCase();
		const isTransfer =
			r.Type === "Overføring-Inn" || r.Type === "Overføring-Ut";
		const isStakingProgram =
			typeof programName === "string" &&
			programName.toUpperCase().includes("STAKING");
		if (programName && isTransfer) {
			if (genericMarket.has(markedUpper) || markedUpper === "") {
				withTag.Marked = programName;
			} else if (isStakingProgram) {
				// Prefer staking program label even if source reports a DEX
				withTag.Marked = programName;
			}
		}

		// Recipient shown per *row*:
		// - Overføring-Ut  -> actual counterparty (resolved)
		// - everything else (Overføring-Inn, Handel, Erverv, Inntekt, Tap, …) -> self
		let recipient: string | undefined;
		let sender: string | undefined;

		if (r.Type === "Overføring-Ut") {
			recipient = sig ? otherMap.get(sig!) : undefined;
			sender = signer; // For outgoing, sender is the signer (self)
		} else if (r.Type === "Overføring-Inn") {
			recipient = selfAddress || undefined; // For incoming, recipient is self
			sender = sig ? otherMap.get(sig!) : undefined; // Sender is the counterparty
		} else {
			recipient = selfAddress || undefined;
			sender = signer; // For other types, sender is typically the signer
		}

		const rowId = rowIdOfTagged(withTag);

		// For transfers, append counterparty last 5 chars to Notat
		const last5 = (addr?: string) =>
			typeof addr === "string" && addr.length >= 5 ? addr.slice(-5) : "";
		if (r.Type === "Overføring-Ut") {
			const tail = last5(recipient);
			if (tail) {
				const sig = extractSigFromNotat(withTag.Notat || "") || "";
				withTag.Notat = `${tag} - Sent to: ${tail} - sig:${sig}`.trim();
			}
		} else if (r.Type === "Overføring-Inn") {
			const tail = last5(sender);
			if (tail) {
				const sig = extractSigFromNotat(withTag.Notat || "") || "";
				withTag.Notat = `${tag} - Sender: ${tail} - sig:${sig}`.trim();
			}
		}

		return {
			...withTag,
			signature: sig,
			signer,
			recipient,
			sender,
			programId,
			programName,
			rowId,
			debugTx
		} as any;
	});
};

/** Apply client-side edited patches by rowId (before overrides/CSV). */
function applyClientEdits<T extends KSRow>(
	rows: T[],
	edits?: Record<string, Partial<KSRow>>
): T[] {
	if (!edits) return rows;
	return rows.map((r) => {
		const id = rowIdOfTagged(r);
		const patch = edits[id];
		return patch ? ({ ...r, ...patch } as T) : r;
	});
}

const getOrNull = (key: string) => {
	const v = getCache(key);
	return v
		? {
				...v,
				sigToSigner: v.sigToSigner ?? {},
				recipients: v.recipients ?? {},
				programIds: v.programIds ?? {},
				programNames: v.programNames ?? {}
			}
		: null;
};

const putCache = (key: string, payload: Omit<CacheVal, "createdAt">) =>
	setCache(key, { ...payload, createdAt: Date.now() });

type Progress =
	| { type: "log"; message: string }
	| { type: "error"; error: string }
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

// ADD THIS helper (place near other helpers)
// Prefer: direct user recipient (rank 3) > token-account owner (rank 3, or 4 if owner===self)
// Fallbacks (rank 1) only apply if nothing better exists.
async function computeSigRecipients(
	sigMap: Map<string, HeliusTx>,
	self: string,
	apiKey?: string
): Promise<Map<string, string>> {
	type Cand = { addr: string; rank: number };
	const cand = new Map<string, Cand>();
	const setCand = (sig: string, addr?: string, rank = 0) => {
		if (!addr) return;
		const prev = cand.get(sig);
		if (!prev || rank > prev.rank) cand.set(sig, { addr, rank });
	};

	// tokenAccount -> { sigs: string[], baseRank: number }
	const tokenAccToSigs = new Map<string, { sigs: string[]; rank: number }>();

	const takeLargest = <T>(arr: T[], score: (t: T) => number) =>
		arr.length ? [...arr].sort((a, b) => score(b) - score(a))[0] : undefined;

	for (const [sig, tx] of sigMap.entries()) {
		const native = (tx.nativeTransfers ?? []) as any[];
		const toks = (tx.tokenTransfers ?? []) as any[];

		// Collect all token-accounts that appear in this tx (to detect WSOL ATAs, pool vaults, etc.)
		const accountsInTx = new Set<string>();
		for (const t of toks) {
			if (t?.fromTokenAccount) accountsInTx.add(t.fromTokenAccount);
			if (t?.toTokenAccount) accountsInTx.add(t.toTokenAccount);
		}

		// ----- OUTGOING -----
		// Native out: try recipient wallet; if it's actually a token account in this tx, resolve owner later.
		const outsN = native.filter((n) => n?.fromUserAccount === self);
		const bestOutN = takeLargest(outsN, (n) => Number(n?.amount ?? 0));
		if (bestOutN?.toUserAccount) {
			const dest = bestOutN.toUserAccount as string;
			if (accountsInTx.has(dest)) {
				const entry = tokenAccToSigs.get(dest) ?? { sigs: [], rank: 3 };
				entry.sigs.push(sig);
				tokenAccToSigs.set(dest, entry);
			} else {
				setCand(sig, dest, 3);
			}
		}

		// Token out
		const outsT = toks.filter((t) => t?.fromUserAccount === self);
		const bestOutT = takeLargest(outsT, (t) =>
			Number(t?.rawTokenAmount?.tokenAmount ?? t?.tokenAmount ?? 0)
		);
		if (bestOutT) {
			if (bestOutT?.toUserAccount) {
				setCand(sig, bestOutT.toUserAccount as string, 3);
			} else if (bestOutT?.toTokenAccount) {
				const acc = bestOutT.toTokenAccount as string;
				const entry = tokenAccToSigs.get(acc) ?? { sigs: [], rank: 3 };
				entry.sigs.push(sig);
				tokenAccToSigs.set(acc, entry);
			}
		}

		// ----- INCOMING (fallbacks if we didn’t get an outgoing recipient) -----
		// Native in → sender (rank 1)
		const insN = native.filter((n) => n?.toUserAccount === self);
		const bestInN = takeLargest(insN, (n) => Number(n?.amount ?? 0));
		if (bestInN?.fromUserAccount) {
			setCand(sig, bestInN.fromUserAccount as string, 1);
		}

		// Token in → sender (rank 1) or resolve fromTokenAccount owner later (rank 2 baseline)
		const insT = toks.filter((t) => t?.toUserAccount === self);
		const bestInT = takeLargest(insT, (t) =>
			Number(t?.rawTokenAmount?.tokenAmount ?? t?.tokenAmount ?? 0)
		);
		if (bestInT) {
			if (bestInT?.fromUserAccount) {
				setCand(sig, bestInT.fromUserAccount as string, 1);
			} else if (bestInT?.fromTokenAccount) {
				const acc = bestInT.fromTokenAccount as string;
				const entry = tokenAccToSigs.get(acc) ?? { sigs: [], rank: 2 };
				entry.sigs.push(sig);
				tokenAccToSigs.set(acc, entry);
			}
		}
	}

	// Resolve token-account owners and upgrade candidates.
	if (tokenAccToSigs.size) {
		const owners = await getOwnersOfTokenAccounts(
			[...tokenAccToSigs.keys()],
			apiKey ?? process.env.HELIUS_API_KEY
		);
		for (const [acc, { sigs, rank }] of tokenAccToSigs.entries()) {
			const owner = owners.get(acc);
			if (!owner) continue;
			const ownerIsSelf = owner.toLowerCase() === self.toLowerCase();
			const finalRank = ownerIsSelf ? 4 : rank; // self beats everything
			for (const s of sigs) setCand(s, owner, finalRank);
		}
	}

	// Finalize
	const out = new Map<string, string>();
	for (const [s, c] of cand.entries()) out.set(s, c.addr);
	return out;
}

async function scanAddresses(
	address: string,
	fromISO: string | undefined,
	toISO: string | undefined,
	onProgress?: (p: Progress) => void,
	maxRawTx?: number,
	resume?: ScanResume,
	seed?: ScanSeed
): Promise<ScanResult> {
	const rawTxLimit =
		typeof maxRawTx === "number" && Number.isFinite(maxRawTx)
			? Math.max(0, Math.floor(maxRawTx))
			: undefined;
	let hitLimit = false;
	let resumeOut: ScanResume | undefined;
	const fromMs = fromISO ? new Date(fromISO).getTime() : undefined;
	const toMs = toISO ? new Date(toISO).getTime() : undefined;
	const inRange = (tx: HeliusTx) => {
		const ts =
			typeof tx.timestamp === "number" ? tx.timestamp * 1000 : undefined;
		if (typeof ts !== "number") return false;
		if (fromMs !== undefined && ts < fromMs) return false;
		if (toMs !== undefined && ts > toMs) return false;
		return true;
	};
	const beforeByAddress: Record<string, string> = {
		...(resume?.beforeByAddress ?? {})
	};

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
	const sigMap = seed?.sigMap ?? new Map<string, HeliusTx>();
	const sigToSigner = seed?.sigToSigner ?? new Map<string, string>();
	const sigToProgramId = seed?.sigToProgramId ?? new Map<string, string>();
	const sigToProgramName = seed?.sigToProgramName ?? new Map<string, string>();
	const missing = new Set<string>();

	const humanizeIdlName = (name: string): string =>
		name
			.replace(/[_-]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/\b\w/g, (c) => c.toUpperCase());

	const startIndex = resume?.nextAddressIndex ?? 0;
	for (let ai = startIndex; ai < addressesToQuery.length; ai++) {
		if (rawTxLimit !== undefined && sigMap.size >= rawTxLimit) {
			hitLimit = true;
			resumeOut = { nextAddressIndex: ai, beforeByAddress };
			break;
		}
		const who = addressesToQuery[ai];
		const isMain = ai === 0;
		let pages = 0;
		const before = beforeByAddress[who];

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
			maxPages: MAX_PAGES,
			before
		})) {
			pages++;
			for (const tx of txPage) {
				if (rawTxLimit !== undefined && sigMap.size >= rawTxLimit) {
					hitLimit = true;
					break;
				}
				if (!tx || !tx.signature) continue;
				if (!inRange(tx)) continue;
				const isNew = !sigMap.has(tx.signature);
				sigMap.set(tx.signature, tx);
				
				// Update the resume cursor to the last PROCESSED transaction
				// This ensures we don't skip transactions when hitting the credit limit mid-page
				beforeByAddress[who] = tx.signature;

				if (isNew) {
					const fpRaw: unknown = (tx as any).feePayer;
					if (typeof fpRaw === "string" && fpRaw) {
						sigToSigner.set(tx.signature, fpRaw);
					} else {
						missing.add(tx.signature);
					}
				}

				// Extract program address from instructions array + friendly name from source
				let extractedProgramAddress: string | undefined;
				let extractedProgramName: string | undefined;

				const instructions = (tx as any).instructions;
				if (Array.isArray(instructions)) {
					// Common system programs to filter out
					const systemPrograms = new Set([
						"ComputeBudget111111111111111111111111111111",
						"11111111111111111111111111111111", // System Program
						"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
						"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
						"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Program
						"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" // Memo Program
					]);

					// Find first non-system program
					for (const instr of instructions) {
						const pid = instr?.programId;
						if (typeof pid === "string" && pid && !systemPrograms.has(pid)) {
							extractedProgramAddress = pid;
							break;
						}
					}
				}

				// Friendly name (e.g. RAYDIUM/JUPITER) from source, if present
				const source = (tx as any).source;
				if (typeof source === "string" && source.trim()) {
					const lower = source.toLowerCase().trim();
					// Skip generic/system names that don't provide useful info
					const skipNames = new Set([
						"unknown",
						"solana",
						"solana system",
						"solana library",
						"system program",
						"spl"
					]);
					if (!skipNames.has(lower) && lower !== "") {
						extractedProgramName = source.trim();
					}
				}

				// Override with local program registry label when available
				const label = programLabelFor(extractedProgramAddress);
				if (label) extractedProgramName = label;

				if (isNew) {
					if (extractedProgramAddress) {
						sigToProgramId.set(tx.signature, extractedProgramAddress);
					}
					if (extractedProgramName) {
						sigToProgramName.set(tx.signature, extractedProgramName);
					}
				}
				if (rawTxLimit !== undefined && sigMap.size >= rawTxLimit) {
					hitLimit = true;
					break;
				}
			}
			if (hitLimit) break;
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
		if (hitLimit) {
			resumeOut = { nextAddressIndex: ai, beforeByAddress };
			break;
		}
		delete beforeByAddress[who];

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

	// Resolve program names from on-chain Anchor IDL when missing
	const unresolvedProgramIds = new Set<string>();
	for (const [sig, pid] of sigToProgramId.entries()) {
		if (!sigToProgramName.has(sig)) unresolvedProgramIds.add(pid);
	}
	if (unresolvedProgramIds.size > 0) {
		for (const pid of unresolvedProgramIds) {
			try {
				const idlName = await fetchAnchorIdlName(
					pid,
					process.env.HELIUS_API_KEY
				);
				if (!idlName) continue;
				const pretty = humanizeIdlName(idlName);
				for (const [sig, p] of sigToProgramId.entries()) {
					if (p === pid && !sigToProgramName.has(sig)) {
						sigToProgramName.set(sig, pretty);
					}
				}
			} catch {}
		}
	}

	return {
		myATAs,
		sigMap,
		sigToSigner,
		sigToProgramId,
		sigToProgramName,
		rawTxCount: sigMap.size,
		partial: hitLimit,
		resume: hitLimit ? resumeOut : undefined
	};
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
	selfSignerMap?: Map<string, string>,
	precomputedRecipients?: Map<string, string>,
	precomputedProgramIds?: Map<string, string>,
	precomputedProgramNames?: Map<string, string>,
	rawTxCount?: number,
	partial = false,
	cacheExtras?: {
		sigMap?: Map<string, HeliusTx>;
		resume?: ScanResume;
		scanSessionId?: string;
	}
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

	const processedAfterDust = processDust(rows, {
		mode: ctx.dustMode,
		threshold: ctx.dustThreshold,
		interval: ctx.dustInterval,
		useOslo: ctx.useOslo,
		getSigner,
		selfAddress: ctx.address
	});

	const txMap = sigMapOrSigner as Map<string, HeliusTx>;

	const consolidated = consolidateRowsBySignature(
		processedAfterDust,
		txMap,
		ctx.address,
		ctx.dustThreshold
	);

	// NEW: counterparty for in & out
	let sigToRecipient: Map<string, string> | undefined = precomputedRecipients;
	if (!sigToRecipient && txMap && typeof txMap.get === "function") {
		sigToRecipient = new Map<string, string>();
		for (const [sig, tx] of txMap.entries()) {
			const cp = pickAnyCounterparty(tx, ctx.address);
			if (cp) sigToRecipient.set(sig, cp);
		}
	}

	const res: ClassifyResult = {
		rowsRaw: rows,
		rowsProcessed: consolidated,
		count: consolidated.length,
		rawCount: Number.isFinite(rawTxCount)
			? (rawTxCount as number)
			: rows.length,
		partial
	};

	const sigMapCache =
		partial && cacheExtras?.sigMap
			? Object.fromEntries(cacheExtras.sigMap.entries())
			: undefined;
	putCache(ctx.cacheKey, {
		rowsProcessed: consolidated,
		count: res.count,
		rawCount: res.rawCount,
		partial: res.partial,
		sigMap: sigMapCache,
		resume: partial ? cacheExtras?.resume : undefined,
		scanSessionId: partial ? cacheExtras?.scanSessionId : undefined,
		sigToSigner: selfSignerMap
			? Object.fromEntries(selfSignerMap.entries())
			: undefined,
		recipients: sigToRecipient
			? Object.fromEntries(sigToRecipient.entries())
			: undefined,
		programIds: precomputedProgramIds
			? Object.fromEntries(precomputedProgramIds.entries())
			: undefined,
		programNames: precomputedProgramNames
			? Object.fromEntries(precomputedProgramNames.entries())
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
	scanSessionId?: string;
	overrides?: OverridesPayload;
	/** map of rowId -> partial KSRow patches coming from client edits */
	clientEdits?: Record<string, Partial<KSRow>>;
}

export async function POST(req: NextRequest) {
	try {
		const supabase = await createSupabaseRouteClient();
		const admin = createSupabaseAdminClient();
		const { data: userData, error: userError } = await supabase.auth.getUser();
		if (userError || !userData?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		const userId = userData.user.id;
		const {
			grant: freeGrant,
			rawUsed: freeUsed,
			emailHash
		} = await ensureFreeGrant(admin, userData.user);

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
		// Allow client to pass back the exact preview cacheKey
		const cacheKeyParam = sp?.get("cacheKey") || undefined;

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
		const scanSessionId =
			typeof body.scanSessionId === "string" && body.scanSessionId.length > 0
				? body.scanSessionId
				: undefined;
		const chargeKey = scanSessionId ? `${ckey}:${scanSessionId}` : ckey;

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

		const creditState = await getAvailableRawTx(
			supabase,
			userId,
			freeGrant,
			freeUsed
		);
		const availableRawTx = creditState.availableRawTx;
		
		// Debug logging
		if (process.env.NODE_ENV === "development") {
			console.log("[kryptosekken] Credit check:", {
				freeGrant,
				freeUsed,
				freeRemaining: creditState.freeRemaining,
				creditsRemaining: creditState.creditsRemaining,
				availableRawTx,
				emailVerified: isEmailVerified(userData.user)
			});
		}
		
		const noCreditsError = "Not enough TX Credits to perform a search";
		const topUpCta = { label: "Top up", href: "/pricing" };
		const topUpLog = "⚠️ Ikke nok TX Credits. Topp opp for å fortsette.";

		/* ---------- NDJSON streaming (preview with progress) ---------- */
		if (wantNDJSON) {
			const stream = new ReadableStream({
				async start(controller) {
					const enc = new TextEncoder();
					const send = (obj: any) =>
						controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

					const cached = getOrNull(ckey);
					if (cached?.partial && availableRawTx <= 0) {
						await send({
							type: "error",
							error: noCreditsError,
							cta: topUpCta,
							freeRemaining: creditState.freeRemaining,
							creditsRemaining: creditState.creditsRemaining,
							availableRawTx
						});
						await send({
							type: "log",
							message: topUpLog
						});
						controller.close();
						return;
					}
					const shouldResume =
						cached &&
						cached.partial &&
						availableRawTx > 0 &&
						cached.sigMap &&
						cached.resume &&
						scanSessionId &&
						cached.scanSessionId === scanSessionId;
					const canUseCached =
						cached &&
						!shouldResume &&
						(!cached.partial || availableRawTx <= cached.rawCount) &&
						(!cached.partial ||
							!scanSessionId ||
							cached.scanSessionId === scanSessionId);
					if (cached && canUseCached) {
						const billedRawCount = cached.partial
							? Math.min(cached.rawCount ?? 0, availableRawTx)
							: cached.rawCount;
						const billing = await consumeRawUsage(
							supabase,
							admin,
							userId,
							billedRawCount,
							chargeKey,
							freeGrant,
							freeUsed,
							emailHash
						);
						if (!billing.ok) {
							await send({
								type: "error",
								error: noCreditsError,
								cta: topUpCta,
								freeRemaining: creditState.freeRemaining,
								creditsRemaining: creditState.creditsRemaining,
								availableRawTx
							});
							await send({
								type: "log",
								message: topUpLog
							});
							controller.close();
							return;
						}
						const rowsPreview = attachSigAndSigner(
							cached.rowsProcessed,
							walletTagStr,
							cached.sigToSigner,
							cached.recipients,
							address,
							cached.programIds,
							cached.programNames
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
								totalRaw: cached.rawCount,
								totalLogged: cached.count,
								newRaw: 0,
								newLogged: 0,
								cacheKey: ckey,
								partial: cached.partial ?? false,
								fromCache: true,
								chargedCredits: 0
							}
						});
						controller.close();
						return;
					}

					if (availableRawTx <= 0) {
						await send({
							type: "error",
							error: noCreditsError,
							cta: topUpCta,
							freeRemaining: creditState.freeRemaining,
							creditsRemaining: creditState.creditsRemaining,
							availableRawTx
						});
						await send({
							type: "log",
							message: topUpLog
						});
						controller.close();
						return;
					}

					try {
						const seed = shouldResume
							? {
									sigMap: mapFromRecord(cached?.sigMap),
									sigToSigner: mapFromRecord(cached?.sigToSigner),
									sigToProgramId: mapFromRecord(cached?.programIds),
									sigToProgramName: mapFromRecord(cached?.programNames)
								}
							: undefined;
						const maxRawTx = shouldResume
							? (cached?.rawCount ?? 0) + availableRawTx
							: availableRawTx;
						const scan = await scanAddresses(
							address,
							fromISO,
							toISO,
							(p) => send(p),
							maxRawTx,
							shouldResume ? cached?.resume : undefined,
							seed
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

						// compute real recipients (resolve token accounts → owners)
						const recipients = await computeSigRecipients(
							scan.sigMap,
							address,
							process.env.HELIUS_API_KEY
						);

						const result = postProcessAndCache(
							ctx,
							rows,
							scan.sigMap,
							scan.sigToSigner,
							recipients, // ← pass precomputed recipients
							scan.sigToProgramId,
							scan.sigToProgramName,
							scan.rawTxCount,
							scan.partial,
							{ sigMap: scan.sigMap, resume: scan.resume, scanSessionId }
						);
						const rowsPreview = attachSigAndSigner(
							result.rowsProcessed,
							walletTagStr,
							scan.sigToSigner,
							recipients,
							address,
							scan.sigToProgramId,
							scan.sigToProgramName,
							scan.sigMap
						);

						const prevRaw = shouldResume ? (cached?.rawCount ?? 0) : 0;
						const totalRaw = result.rawCount;
						const newRaw = shouldResume
							? totalRaw < prevRaw
								? totalRaw
								: Math.max(0, totalRaw - prevRaw)
							: totalRaw;

						if (shouldResume && cached?.rawCount !== undefined) {
							await supabase
								.from("billing_usage_events")
								.upsert(
									{
										user_id: userId,
										cache_key: chargeKey,
										raw_count: cached.rawCount,
										created_at: new Date().toISOString()
									},
									{ onConflict: "user_id,cache_key" }
								)
								.eq("user_id", userId)
								.eq("cache_key", chargeKey);
						}
						const billedRawCountRaw =
							scan.partial && scan.sigMap?.size
								? scan.sigMap.size
								: result.rawCount;
						const { data: billedEvent } = await supabase
							.from("billing_usage_events")
							.select("raw_count")
							.eq("user_id", userId)
							.eq("cache_key", chargeKey)
							.maybeSingle();
						const alreadyBilled = billedEvent?.raw_count ?? 0;
						const billedRawCount = shouldResume
							? alreadyBilled + newRaw
							: Math.min(billedRawCountRaw, alreadyBilled + availableRawTx);
						const billing = await consumeRawUsage(
							supabase,
							admin,
							userId,
							billedRawCount,
							chargeKey,
							freeGrant,
							freeUsed,
							emailHash
						);
						if (!billing.ok) {
							await send({
								type: "error",
								error: noCreditsError,
								cta: topUpCta,
								freeRemaining: creditState.freeRemaining,
								creditsRemaining: creditState.creditsRemaining,
								availableRawTx
							});
							await send({
								type: "log",
								message: topUpLog
							});
							controller.close();
							return;
						}

						const prevLogged = shouldResume ? (cached?.count ?? 0) : 0;
						const totalLogged = result.count;
						const newLogged = Math.max(0, totalLogged - prevLogged);
						await send({
							type: "done",
							data: {
								rowsPreview,
								count: result.count,
								rawCount: result.rawCount,
								totalRaw,
								totalLogged,
								newRaw,
								newLogged,
								cacheKey: ckey,
								partial: result.partial,
								chargedCredits: newRaw
							}
						});
					} catch (err: any) {
						const msg =
							err instanceof Error
								? err.message
								: typeof err === "string"
									? err
									: "Unknown error";
						await send({ type: "error", error: msg });
						await send({
							type: "log",
							message: `❌ Feil: ${msg}`
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
			if (cached?.partial && availableRawTx <= 0) {
				return NextResponse.json(
					{
						error: noCreditsError,
						cta: topUpCta,
						freeRemaining: creditState.freeRemaining,
						creditsRemaining: creditState.creditsRemaining,
						availableRawTx
					},
					{ status: 402 }
				);
			}
			const shouldResume =
				cached &&
				cached.partial &&
				availableRawTx > 0 &&
				cached.sigMap &&
				cached.resume &&
				scanSessionId &&
				cached.scanSessionId === scanSessionId;
			const canUseCached =
				cached &&
				!shouldResume &&
				(!cached.partial || availableRawTx <= cached.rawCount) &&
				(!cached.partial ||
					!scanSessionId ||
					cached.scanSessionId === scanSessionId);
			if (cached && canUseCached) {
				const billedRawCount = cached.partial
					? Math.min(cached.rawCount ?? 0, availableRawTx)
					: cached.rawCount;
				const billing = await consumeRawUsage(
					supabase,
					admin,
					userId,
					billedRawCount,
					chargeKey,
					freeGrant,
					freeUsed,
					emailHash
				);
				if (!billing.ok) {
					return NextResponse.json(
						{
							error: noCreditsError,
							cta: topUpCta,
							freeRemaining: creditState.freeRemaining,
							creditsRemaining: creditState.creditsRemaining,
							availableRawTx
						},
						{ status: 402 }
					);
				}
				const rowsOutRaw = attachSigAndSigner(
					cached.rowsProcessed,
					walletTagStr,
					cached.sigToSigner,
					cached.recipients,
					address,
					cached.programIds,
					cached.programNames
				);

				// Apply client edits BEFORE overrides so both JSON and CSV stay consistent
				let rowsOut = applyClientEdits(rowsOutRaw, body.clientEdits);
				rowsOut = applyOverridesToRows(rowsOut, body.overrides);
				return NextResponse.json({
					rows: rowsOut,
					count: cached.count,
					rawCount: cached.rawCount,
					cacheKey: ckey,
					partial: cached.partial ?? false
				});
			}

			if (availableRawTx <= 0) {
				return NextResponse.json(
					{
						error: noCreditsError,
						cta: topUpCta,
						freeRemaining: creditState.freeRemaining,
						creditsRemaining: creditState.creditsRemaining,
						availableRawTx
					},
					{ status: 402 }
				);
			}

			const seed = shouldResume
				? {
						sigMap: mapFromRecord(cached?.sigMap),
						sigToSigner: mapFromRecord(cached?.sigToSigner),
						sigToProgramId: mapFromRecord(cached?.programIds),
						sigToProgramName: mapFromRecord(cached?.programNames)
					}
				: undefined;
			const maxRawTx = shouldResume
				? (cached?.rawCount ?? 0) + availableRawTx
				: availableRawTx;
			const scan = await scanAddresses(
				address,
				fromISO,
				toISO,
				undefined,
				maxRawTx,
				shouldResume ? cached?.resume : undefined,
				seed
			);
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

			// compute recipients and pass into cache/post-processing
			const recipients = await computeSigRecipients(
				scan.sigMap,
				address,
				process.env.HELIUS_API_KEY
			);

			const result = postProcessAndCache(
				ctx,
				rows,
				scan.sigMap,
				scan.sigToSigner,
				recipients, // ← pass precomputed recipients
				scan.sigToProgramId, // ← pass precomputed program IDs
				scan.sigToProgramName,
				scan.rawTxCount,
				scan.partial,
				{ sigMap: scan.sigMap, resume: scan.resume, scanSessionId }
			);

			const rowsOutRaw = attachSigAndSigner(
				result.rowsProcessed,
				walletTagStr,
				scan.sigToSigner,
				recipients,
				address,
				scan.sigToProgramId,
				scan.sigToProgramName,
				scan.sigMap
			);

			let rowsOut = applyClientEdits(rowsOutRaw, body.clientEdits);
			rowsOut = applyOverridesToRows(rowsOut, body.overrides);

			if (shouldResume && cached?.rawCount !== undefined) {
				await supabase
					.from("billing_usage_events")
					.upsert(
						{
							user_id: userId,
							cache_key: chargeKey,
							raw_count: cached.rawCount,
							created_at: new Date().toISOString()
						},
						{ onConflict: "user_id,cache_key" }
					)
					.eq("user_id", userId)
					.eq("cache_key", chargeKey);
			}
			const prevRaw = shouldResume ? (cached?.rawCount ?? 0) : 0;
			const totalRaw = result.rawCount;
			const newRaw = shouldResume
				? totalRaw < prevRaw
					? totalRaw
					: Math.max(0, totalRaw - prevRaw)
				: totalRaw;
			const billedRawCountRaw =
				scan.partial && scan.sigMap?.size ? scan.sigMap.size : result.rawCount;
			const { data: billedEvent } = await supabase
				.from("billing_usage_events")
				.select("raw_count")
				.eq("user_id", userId)
				.eq("cache_key", chargeKey)
				.maybeSingle();
			const alreadyBilled = billedEvent?.raw_count ?? 0;
			const billedRawCount = shouldResume
				? alreadyBilled + newRaw
				: Math.min(billedRawCountRaw, alreadyBilled + availableRawTx);
			const billing = await consumeRawUsage(
				supabase,
				admin,
				userId,
				billedRawCount,
				chargeKey,
				freeGrant,
				freeUsed,
				emailHash
			);
			if (!billing.ok) {
				return NextResponse.json(
					{
						error: noCreditsError,
						cta: topUpCta,
						freeRemaining: creditState.freeRemaining,
						creditsRemaining: creditState.creditsRemaining,
						availableRawTx
					},
					{ status: 402 }
				);
			}

			return NextResponse.json({
				rows: rowsOut,
				count: result.count,
				rawCount: result.rawCount,
				cacheKey: ckey,
				partial: result.partial
			});
		}

		/* ---------- CSV (download uses existing preview cache only) ---------- */
		const ckeyToUse = cacheKeyParam || ckey;
		const cached = getOrNull(ckeyToUse);
		if (cached) {
			let rowsWithTag = cached.rowsProcessed.map((r) => ({
				...r,
				Notat: `${walletTagStr} - ${r.Notat}`
			}));

			// Apply client edits BEFORE overrides (so CSV matches what the user sees)
			rowsWithTag = applyClientEdits(rowsWithTag, body.clientEdits);

			const rowsForCsv = applyOverridesToRows(rowsWithTag, body.overrides);
			const csv = rowsToCSV(rowsForCsv);
			return new NextResponse(csv, {
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename=solana_${address}_kryptosekken.csv`
				}
			});
		}

		// No cache => DO NOT scan. Ask the client to open preview first.
		return NextResponse.json(
			{
				error:
					"Ingen bufret forhåndsvisning for denne forespørselen. Åpne forhåndsvisning først, deretter Last ned.",
				cacheKey: ckeyToUse
			},
			{ status: 412 }
		);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "Unknown error";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
