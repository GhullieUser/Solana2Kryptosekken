// src/lib/helius.ts
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

export const SPL_TOKEN_PROGRAM_ID =
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/* ================= Types ================= */

export interface NativeTransfer {
	fromUserAccount?: string;
	toUserAccount?: string;
	amount?: number; // lamports
}

export interface TokenTransfer {
	mint: string;

	// Prefer raw base-unit strings if present:
	rawTokenAmount?: {
		tokenAmount?: string; // integer string
		decimals?: number;
	};

	// Fallbacks (some indexers provide these, may be scaled or raw):
	tokenAmount?: number | string;
	decimals?: number;
	tokenSymbol?: string;

	tokenStandard?: string; // "nft" / "fungible" / etc.
	isNFT?: boolean;

	fromUserAccount?: string;
	toUserAccount?: string;

	fromTokenAccount?: string;
	toTokenAccount?: string;
}

export interface HeliusEvents {
	stakingReward?: { amount?: number };
}

export interface HeliusTx {
	signature: string;
	timestamp?: number; // unix seconds
	fee?: number;
	feePayer?: string;

	nativeTransfers?: NativeTransfer[];
	tokenTransfers?: TokenTransfer[];

	type?: string;
	description?: string;
	source?: string;
	programId?: string;
	events?: HeliusEvents;
}

export type FetchOptions = {
	address: string;
	fromISO?: string;
	toISO?: string;
	apiKey?: string; // falls back to env
	limit?: number; // Helius hard-cap is 100
	maxPages?: number;
	/** optional cursor to start pagination before this signature */
	before?: string;
	/** optional small delay between pages to be gentle with rate limits (ms) */
	pageDelayMs?: number;
};

/* ================= Helpers ================= */

function resolveHeliusKey(apiKey?: string): string {
	const key =
		(apiKey || "").trim() || (process.env.HELIUS_API_KEY || "").trim();
	if (!key) {
		throw new Error(
			"Missing Helius API key. Set HELIUS_API_KEY in .env.local or pass heliusKey."
		);
	}
	return key;
}

function toUnix(iso?: string) {
	if (!iso) return undefined;
	const t = new Date(iso).getTime();
	return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

function parseRetryBody(text: string): string {
	try {
		const j = JSON.parse(text);
		const detail =
			j?.error ||
			j?.message ||
			j?.msg ||
			j?.detail ||
			(typeof j === "string" ? j : "");
		return typeof detail === "string" && detail.length ? detail : text;
	} catch {
		return text;
	}
}

function redactApiKey(u: string) {
	return u.replace(/(api-key=)[^&]+/i, "$1***");
}

const PUBLIC_SOL_RPC = "https://api.mainnet-beta.solana.com";

async function fetchJsonRpcWithTimeout(
	endpoint: string,
	body: unknown,
	timeoutMs: number
): Promise<any> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: ctrl.signal
		});
		const text = await res.text();
		let json: any;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			throw new Error(
				`RPC parse error (${res.status}) — ${text?.slice(0, 300) || "no body"}`
			);
		}
		if (!res.ok) {
			const msg =
				typeof json?.error?.message === "string"
					? json.error.message
					: text || res.statusText;
			throw new Error(`RPC ${res.status} — ${msg}`);
		}
		if (json?.error) {
			throw new Error(
				`RPC error — ${
					typeof json.error?.message === "string"
						? json.error.message
						: JSON.stringify(json.error).slice(0, 300)
				}`
			);
		}
		return json?.result;
	} finally {
		clearTimeout(t);
	}
}

async function rpcCallWithFallback(
	method: string,
	params: any[],
	apiKey?: string,
	prefer: "helius-first" | "public-first" = "helius-first"
): Promise<any> {
	const heliusKey =
		(apiKey || "").trim() || (process.env.HELIUS_API_KEY || "").trim();
	const heliusEndpoint = heliusKey
		? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`
		: null;
	const endpoints =
		prefer === "helius-first"
			? [heliusEndpoint, PUBLIC_SOL_RPC]
			: [PUBLIC_SOL_RPC, heliusEndpoint];
	const body = {
		jsonrpc: "2.0",
		id: Math.floor(Math.random() * 1e9),
		method,
		params
	};

	const errors: string[] = [];
	for (const endpoint of endpoints) {
		if (!endpoint) continue;
		try {
			return await fetchJsonRpcWithTimeout(endpoint, body, 15_000);
		} catch (e: any) {
			errors.push(`${endpoint}: ${e?.message || String(e)}`);
		}
	}
	throw new Error(
		`All RPC endpoints failed for ${method}. Details: ${errors.join(" | ")}`
	);
}

/* ================= Anchor IDL lookup ================= */

const PROGRAM_IDL_NAME_CACHE = new Map<string, string | null>();

function readU32LE(buf: Buffer, offset: number): number {
	return (
		(buf[offset] |
			(buf[offset + 1] << 8) |
			(buf[offset + 2] << 16) |
			(buf[offset + 3] << 24)) >>>
		0
	);
}

/**
 * Best-effort Anchor IDL name lookup for a program.
 * Returns null if no IDL account exists or parsing fails.
 */
export async function fetchAnchorIdlName(
	programId: string,
	apiKey?: string
): Promise<string | null> {
	if (!programId) return null;
	if (PROGRAM_IDL_NAME_CACHE.has(programId)) {
		return PROGRAM_IDL_NAME_CACHE.get(programId) ?? null;
	}

	let label: string | null = null;
	try {
		const programKey = new PublicKey(programId);
		const [idlAddress] = PublicKey.findProgramAddressSync(
			[Buffer.from("anchor:idl"), programKey.toBuffer()],
			programKey
		);

		const info = await rpcCallWithFallback(
			"getAccountInfo",
			[idlAddress.toBase58(), { encoding: "base64" }],
			apiKey
		);
		const data = info?.value?.data;
		const b64 = Array.isArray(data) ? data[0] : null;
		if (typeof b64 !== "string" || !b64) {
			PROGRAM_IDL_NAME_CACHE.set(programId, null);
			return null;
		}

		const raw = Buffer.from(b64, "base64");
		// Anchor IDL account layout: [8 disc][32 authority][4 len][len bytes]
		if (raw.length < 8 + 32 + 4) {
			PROGRAM_IDL_NAME_CACHE.set(programId, null);
			return null;
		}
		const len = readU32LE(raw, 8 + 32);
		const start = 8 + 32 + 4;
		const end = start + len;
		if (end > raw.length) {
			PROGRAM_IDL_NAME_CACHE.set(programId, null);
			return null;
		}
		const jsonText = raw.slice(start, end).toString("utf8");
		const idl = JSON.parse(jsonText);
		const name = typeof idl?.name === "string" ? idl.name.trim() : "";
		label = name || null;
	} catch {
		label = null;
	}

	PROGRAM_IDL_NAME_CACHE.set(programId, label);
	return label;
}

async function throwHelius(res: Response, url: URL): Promise<never> {
	const raw = await res.text().catch(() => "");
	const detail = parseRetryBody(raw);
	const redacted = redactApiKey(url.toString());
	throw new Error(`Helius ${res.status} — ${detail}\nURL: ${redacted}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retries for 429 and 5xx. Respects Retry-After (seconds) header.
 * Exponential backoff with jitter, capped.
 */
async function fetchWithRetry(
	url: URL,
	init: RequestInit,
	tries = 5
): Promise<Response> {
	for (let attempt = 0; attempt <= tries; attempt++) {
		const res = await fetch(url.toString(), init);

		if (res.ok) return res;

		const retriable = res.status === 429 || res.status >= 500;
		if (!retriable) {
			await throwHelius(res, url); // never returns
		}

		// compute wait: Retry-After (s) or exp backoff with jitter
		const retryAfterHeader = res.headers.get("retry-after");
		const retryAfterMs = retryAfterHeader
			? Math.max(0, Number(retryAfterHeader) * 1000)
			: 0;

		const base = Math.min(1000 * 2 ** attempt, 10_000); // cap 10s
		const jitter = Math.floor(Math.random() * 250);
		const waitMs = retryAfterMs || base + jitter;

		if (attempt < tries) {
			await sleep(waitMs);
			continue;
		}

		// exhausted
		await throwHelius(res, url); // never returns
	}

	// Unreachable, but keeps TS happy if control-flow analysis changes
	throw new Error(
		`Helius fetch failed after ${tries + 1} attempts for ${redactApiKey(
			url.toString()
		)}`
	);
}

/* ================= Enhanced transactions (paged stream) ================= */

export async function getOwnersOfTokenAccounts(
	tokenAccounts: string[],
	apiKey?: string
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (!tokenAccounts?.length) return out;

	const chunk = <T>(arr: T[], n: number) =>
		Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
			arr.slice(i * n, i * n + n)
		);

	for (const part of chunk(tokenAccounts, 100)) {
		const result = await rpcCallWithFallback(
			"getMultipleAccounts",
			[part, { encoding: "jsonParsed" }],
			apiKey,
			"helius-first"
		);
		const list: any[] = result?.value ?? [];

		for (let i = 0; i < part.length; i++) {
			const acc = part[i];
			const v = list[i];

			// Prefer parsed owner if available
			const ownerParsed: string | undefined = v?.data?.parsed?.info?.owner;
			let owner = ownerParsed;

			// Fallback: decode base64 data and read bytes [32..64) for owner pubkey
			if (!owner && v?.data?.[0] && v?.data?.[1] === "base64") {
				try {
					const b = Buffer.from(v.data[0], "base64");
					if (b.length >= 64) {
						owner = bs58.encode(b.subarray(32, 64));
					}
				} catch {}
			}

			if (owner) out.set(acc, owner);
		}
	}

	return out;
}

export async function* fetchEnhancedTxs(
	opts: FetchOptions
): AsyncGenerator<HeliusTx[]> {
	const key = resolveHeliusKey(opts.apiKey);

	// normalize time bounds; swap if flipped; clamp end to "now"
	let startTime = toUnix(opts.fromISO);
	let endTime = toUnix(opts.toISO);
	const nowSec = Math.floor(Date.now() / 1000);

	if (
		typeof startTime === "number" &&
		typeof endTime === "number" &&
		startTime > endTime
	) {
		const tmp = startTime;
		startTime = endTime;
		endTime = tmp;
	}
	if (typeof endTime === "number" && endTime > nowSec) {
		endTime = nowSec;
	}

	const base = `https://api.helius.xyz/v0/addresses/${opts.address}/transactions`;
	const pageSize = Math.min(Math.max(opts.limit ?? 100, 1), 100); // cap 100 per Helius
	const perPageDelay =
		typeof opts.pageDelayMs === "number" ? opts.pageDelayMs : 150;

	let before: string | undefined = opts.before;
	let pages = 0;
	const seenBefores = new Set<string>();
	if (before) seenBefores.add(before);

	while (true) {
		const url = new URL(base);
		url.searchParams.set("api-key", key);
		url.searchParams.set("limit", String(pageSize));
		if (before) url.searchParams.set("before", before);
		if (typeof startTime === "number")
			url.searchParams.set("startTime", String(startTime));
		if (typeof endTime === "number")
			url.searchParams.set("endTime", String(endTime));

		let res: Response;

		try {
			res = await fetchWithRetry(
				url,
				{ headers: { accept: "application/json" } },
				5
			);
		} catch (err: any) {
			// Handle 404 pagination-hint: “… query the API again with the `before` parameter set to <sig>”
			const msg = String(err?.message || "");
			const statusMatch = msg.match(/Helius\s+(\d+)/i);
			const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

			if (status === 404 && /before.*set to/i.test(msg)) {
				// extract suggested signature (base58)
				const m =
					msg.match(/set to\s+([1-9A-HJ-NP-Za-km-z]+)/i) ||
					msg.match(/before[`'":\s]+([1-9A-HJ-NP-Za-km-z]+)/i);
				const suggested = m?.[1];

				if (suggested && !seenBefores.has(suggested)) {
					before = suggested;
					seenBefores.add(suggested);
					if (perPageDelay > 0) await sleep(perPageDelay);
					continue; // retry loop with new `before`
				}
			}

			// Not a hint we can use — rethrow
			throw err;
		}

		const list: unknown = await res.json();
		if (!Array.isArray(list) || list.length === 0) return;

		const txs = list as HeliusTx[];
		yield txs;

		const lastSig = txs[txs.length - 1]?.signature;
		if (!lastSig) return;
		if (seenBefores.has(lastSig)) return; // avoid loops
		seenBefores.add(lastSig);
		before = lastSig;

		pages++;
		if (opts.maxPages && pages >= opts.maxPages) return;

		// be gentle between pages
		if (perPageDelay > 0) await sleep(perPageDelay);
	}
}

/* ================= Token accounts by owner (RPC) ================= */

export async function getTokenAccountsByOwner(
	owner: string,
	apiKey?: string
): Promise<string[]> {
	const json = await rpcCallWithFallback(
		"getTokenAccountsByOwner",
		[owner, { programId: SPL_TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }],
		apiKey,
		"helius-first"
	);
	const value: any[] = json?.value;
	if (!Array.isArray(value)) return [];
	return value
		.map((v) => v?.pubkey)
		.filter((s: unknown): s is string => typeof s === "string");
}

/* ================= Token metadata (by mint arrays) ================= */

/**
 * Helius expects:
 * POST /v0/token-metadata
 * body: { "mintAccounts": ["<mint>", ...] }
 */
export async function fetchTokenMetadataMap(
	mints: string[],
	apiKey?: string
): Promise<Map<string, { symbol?: string; decimals?: number }>> {
	const key = resolveHeliusKey(apiKey);
	const out = new Map<string, { symbol?: string; decimals?: number }>();
	if (!mints || mints.length === 0) return out;

	const chunk = <T>(arr: T[], n: number) =>
		Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
			arr.slice(i * n, i * n + n)
		);

	for (const part of chunk(mints, 100)) {
		const url = new URL(
			`https://api.helius.xyz/v0/token-metadata?api-key=${encodeURIComponent(
				key
			)}`
		);

		const res = await fetchWithRetry(
			url,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ mintAccounts: part })
			},
			4
		);

		const arr: any[] = await res.json().catch(() => []);
		if (!Array.isArray(arr)) continue;

		for (const item of arr) {
			try {
				const mint: string =
					item?.mint ??
					item?.mintAddress ??
					item?.id ??
					item?.address ??
					item?.onChainMetadata?.mintAddress;
				if (!mint || typeof mint !== "string") continue;

				const symbol: string | undefined =
					item?.symbol ??
					item?.tokenSymbol ??
					item?.onChainMetadata?.metadata?.symbol ??
					item?.offChainMetadata?.metadata?.symbol ??
					item?.metadata?.symbol;

				const decimalsRaw =
					item?.decimals ??
					item?.tokenDecimals ??
					item?.onChainAccountInfo?.data?.parsed?.info?.decimals ??
					item?.onChainMetadata?.metadata?.decimals ??
					item?.offChainMetadata?.metadata?.decimals;

				const decimals =
					typeof decimalsRaw === "number"
						? decimalsRaw
						: Number.isFinite(parseInt(decimalsRaw))
							? parseInt(decimalsRaw)
							: undefined;

				out.set(mint, {
					symbol:
						typeof symbol === "string" && symbol.length ? symbol : undefined,
					decimals:
						typeof decimals === "number" && Number.isFinite(decimals)
							? decimals
							: undefined
				});
			} catch {
				// ignore item-level parse errors
			}
		}
	}

	return out;
}

/* ================= Jupiter Token API v2 (by mint arrays) ================= */
/**
 * Lite endpoint (no key): https://lite-api.jup.ag/tokens/v2/search?query=<comma-separated mints>
 * - Up to 100 mints per request
 */
export async function fetchJupiterTokenMetadataMap(
	mints: string[]
): Promise<Map<string, { symbol?: string; decimals?: number }>> {
	const out = new Map<string, { symbol?: string; decimals?: number }>();
	if (!mints || mints.length === 0) return out;

	const chunk = <T>(arr: T[], n: number) =>
		Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
			arr.slice(i * n, i * n + n)
		);

	for (const part of chunk(mints, 100)) {
		const query = encodeURIComponent(part.join(","));
		const url = new URL(
			`https://lite-api.jup.ag/tokens/v2/search?query=${query}`
		);

		// soft-retry Jupiter too, but fewer attempts
		let res: Response;
		try {
			res = await fetchWithRetry(
				url,
				{ headers: { accept: "application/json" } },
				2
			);
		} catch {
			// if it fails, just skip; we have other sources
			continue;
		}

		const list: any[] = await res.json().catch(() => []);
		if (!Array.isArray(list)) continue;

		for (const t of list) {
			const mint: string = t?.id;
			if (!mint || typeof mint !== "string") continue;
			const symbol: string | undefined = t?.symbol;
			const decimals: number | undefined =
				typeof t?.decimals === "number" ? t.decimals : undefined;
			out.set(mint, {
				symbol: symbol && symbol.length ? symbol : undefined,
				decimals
			});
		}
	}

	return out;
}

/* ================= Fee payer / signer (RPC) ================= */

/**
 * Best-effort lookup of the signer/fee payer for a given signature using Helius RPC.
 * Returns null if it cannot be determined.
 */
export async function fetchFeePayer(
	signature: string,
	apiKey?: string
): Promise<string | null> {
	const key = resolveHeliusKey(apiKey);
	const url = new URL(
		`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
	);

	// jsonParsed returns accountKeys with { pubkey, signer, writable }
	const body = {
		jsonrpc: "2.0",
		id: 1,
		method: "getTransaction",
		params: [
			signature,
			{
				encoding: "jsonParsed",
				maxSupportedTransactionVersion: 0
			}
		]
	};

	const res = await fetchWithRetry(
		url,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		},
		3
	);

	const raw = await res.text();
	let json: any;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const keys = json?.result?.transaction?.message?.accountKeys;
	if (!Array.isArray(keys) || keys.length === 0) return null;

	const first = keys[0];
	if (typeof first === "string") return first;
	if (first && typeof first?.pubkey === "string") return first.pubkey as string;

	// Some nodes may return a different shape; try to find the first signer
	const signerObj = keys.find(
		(k: any) => k?.signer && typeof k?.pubkey === "string"
	);
	return typeof signerObj?.pubkey === "string" ? signerObj.pubkey : null;
}
