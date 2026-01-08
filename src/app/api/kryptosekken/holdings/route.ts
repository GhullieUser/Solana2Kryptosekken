// app/api/kryptosekken/holdings/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
	fetchJupiterTokenMetadataMap,
	fetchTokenMetadataMap
} from "@/lib/helius";
import { currencyCode } from "@/lib/kryptosekken";
import { hintFor } from "@/lib/tokenMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Constants & Types ---------- */

const LAMPORTS_PER_SOL = 1_000_000_000;
const SOL_MINT = "So11111111111111111111111111111111111111112";

// $1 heuristic for stablecoins when price API misses them
const USD_STABLES = new Set([
	"USDC",
	"USDT",
	"DAI",
	"cUSD",
	"USDH",
	"UXD",
	"PAI",
	"USDC.E",
	"USDT.E"
]);

// Prefer quoting against stables when picking DexScreener pair
const DS_STABLE_QUOTES = new Set(["USDC", "USDT", "DAI"]);

type Holding = {
	mint: string;
	symbol: string;
	amount?: number;
	amountText?: string;
	decimals?: number;
	isNFT?: boolean;
	priceUSD?: number;
	valueUSD?: number;
	logoURI?: string;
};

type Body = {
	address?: string;
	includeNFT?: boolean;
};

/* ---------- Small utils ---------- */

function numberToPlain(n: number) {
	if (!Number.isFinite(n)) return "0";
	const s = String(n);
	if (!/e/i.test(s)) return s;
	const f = n.toFixed(18);
	return f.replace(/\.?0+$/, "");
}
function lamportsToSol(n: number) {
	return n / LAMPORTS_PER_SOL;
}
function isLikelyNFT(decimals?: number, uiAmountString?: string) {
	return decimals === 0 && (uiAmountString === "1" || uiAmountString === "1.0");
}
function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}
async function fetchJsonWithTimeout(
	url: string,
	opts: RequestInit & { timeoutMs?: number } = {}
) {
	const { timeoutMs = 15000, ...rest } = opts;
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			...rest,
			signal: ctrl.signal,
			cache: "no-store",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...(rest.headers || {})
			}
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`HTTP ${res.status}${text ? ` – ${text.slice(0, 200)}` : ""}`
			);
		}
		return await res.json();
	} finally {
		clearTimeout(t);
	}
}

/* ---------- Metadata resolvers ---------- */

function mkSymDecResolver(
	jupMeta: Map<string, { symbol?: string; decimals?: number }>,
	helMeta: Map<string, { symbol?: string; decimals?: number }>
) {
	return (mint: string, fallbackDecimals?: number) => {
		if (mint === SOL_MINT) return { symbol: "SOL", decimals: 9 };
		const j = jupMeta.get(mint);
		const h = helMeta.get(mint);
		const hint = hintFor(mint);
		const sym =
			j?.symbol || h?.symbol || hint?.symbol || `TOKEN-${mint.slice(0, 6)}`;
		const decimals =
			typeof fallbackDecimals === "number"
				? fallbackDecimals
				: typeof j?.decimals === "number"
				? j.decimals
				: typeof h?.decimals === "number"
				? h.decimals
				: hint?.decimals ?? 6;
		return { symbol: currencyCode(sym), decimals };
	};
}

/* ---------- RPC selection & calls ---------- */

function heliusRpcUrl() {
	const key = process.env.HELIUS_API_KEY;
	return key
		? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
		: null;
}
const PUBLIC_SOL_RPC = "https://api.mainnet-beta.solana.com";

async function rpcCall(
	method: string,
	params: any[],
	prefer: "helius-first" | "public-first" = "helius-first"
) {
	const helius = heliusRpcUrl();
	const order =
		prefer === "helius-first" && helius
			? [helius, PUBLIC_SOL_RPC]
			: [PUBLIC_SOL_RPC, ...(helius ? [helius] : [])];

	const reqBody = {
		jsonrpc: "2.0",
		id: Math.floor(Math.random() * 1e9),
		method,
		params
	};

	const errors: string[] = [];
	for (const endpoint of order) {
		try {
			const j = await fetchJsonWithTimeout(endpoint, {
				method: "POST",
				body: JSON.stringify(reqBody),
				timeoutMs: 15000
			});
			if (j?.error) {
				errors.push(`${endpoint}: ${JSON.stringify(j.error).slice(0, 200)}`);
				continue;
			}
			return j?.result;
		} catch (e: any) {
			errors.push(`${endpoint}: ${e?.message || e}`);
		}
	}
	throw new Error(
		`All RPC endpoints failed for ${method}. Details: ${errors.join(" | ")}`
	);
}

/* ---------- Pricing (Jupiter + SOL fallback) ---------- */

async function fetchPricesJupByMints(
	mints: string[]
): Promise<Map<string, number>> {
	const set = new Set(mints.filter(Boolean));
	if (set.size === 0) return new Map();
	const batches = chunk(Array.from(set), 100);
	const out = new Map<string, number>();
	for (const batch of batches) {
		const qs = encodeURIComponent(batch.join(","));
		const url = `https://price.jup.ag/v6/price?mints=${qs}`;
		try {
			const j = await fetchJsonWithTimeout(url, { timeoutMs: 12000 });
			const data = j?.data ?? {};
			for (const key of Object.keys(data)) {
				const p = data[key]?.price;
				if (typeof p === "number" && Number.isFinite(p)) out.set(key, p);
			}
		} catch {
			/* ignore */
		}
	}
	return out;
}

async function fetchPricesJupByIds(
	ids: string[]
): Promise<Map<string, number>> {
	const base = Array.from(new Set(ids.filter(Boolean)));
	if (base.length === 0) return new Map();

	// Query original, UPPER and lower to be safe
	const variants = new Set<string>([
		...base,
		...base.map((s) => s.toUpperCase()),
		...base.map((s) => s.toLowerCase())
	]);

	const batches = chunk(Array.from(variants), 100);
	const out = new Map<string, number>();
	for (const batch of batches) {
		const qs = encodeURIComponent(batch.join(","));
		const url = `https://price.jup.ag/v6/price?ids=${qs}`;
		try {
			const j = await fetchJsonWithTimeout(url, { timeoutMs: 10000 });
			const data = j?.data ?? {};
			for (const key of Object.keys(data)) {
				const p = data[key]?.price;
				if (typeof p === "number" && Number.isFinite(p)) {
					out.set(key, p);
					out.set(key.toUpperCase(), p);
					out.set(key.toLowerCase(), p);
				}
			}
		} catch {
			/* ignore */
		}
	}
	return out;
}

// SOL fallback via Coingecko if Jupiter misses it
async function fetchSolPriceCoingeckoUSD(): Promise<number | undefined> {
	try {
		const j = await fetchJsonWithTimeout(
			"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
			{ timeoutMs: 8000 }
		);
		const p = j?.solana?.usd;
		return typeof p === "number" && Number.isFinite(p) ? p : undefined;
	} catch {
		return undefined;
	}
}

/* ---------- Token logos (Jupiter token list, cached) ---------- */

type JupMinimal = { logoURI?: string; symbol?: string; decimals?: number };
let JUP_TOKENLIST_CACHE: { map: Map<string, JupMinimal>; ts: number } | null =
	null;
const TOKENLIST_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function getJupTokenListMap(): Promise<Map<string, JupMinimal>> {
	const now = Date.now();
	if (JUP_TOKENLIST_CACHE && now - JUP_TOKENLIST_CACHE.ts < TOKENLIST_TTL_MS) {
		return JUP_TOKENLIST_CACHE.map;
	}
	const url = "https://token.jup.ag/all";
	const j = (await fetchJsonWithTimeout(url, { timeoutMs: 15000 })) as any[];
	const map = new Map<string, JupMinimal>();
	for (const t of j || []) {
		const mint = t?.address as string;
		if (!mint) continue;
		map.set(mint, {
			logoURI: t?.logoURI,
			symbol: t?.symbol,
			decimals: typeof t?.decimals === "number" ? t.decimals : undefined
		});
	}
	JUP_TOKENLIST_CACHE = { map, ts: now };
	return map;
}

// Normalize IPFS/Arweave to HTTPS
function normalizeLogoUrl(u?: string): string | undefined {
	if (!u) return undefined;
	if (u.startsWith("http://") || u.startsWith("https://")) return u;
	if (u.startsWith("ipfs://")) {
		const cid = u.replace("ipfs://", "").replace(/^ipfs\//, "");
		return `https://ipfs.io/ipfs/${cid}`;
	}
	if (u.startsWith("ar://")) {
		const id = u.replace("ar://", "");
		return `https://arweave.net/${id}`;
	}
	if (u.startsWith("arweave://")) {
		const id = u.replace("arweave://", "");
		return `https://arweave.net/${id}`;
	}
	return undefined;
}

/* ---------- DexScreener fallback (prices + logos) ---------- */
/* Docs: https://docs.dexscreener.com/api/reference (pairs/tokens endpoints) */

type DexPair = {
	chainId: string;
	dexId: string;
	url: string;
	pairAddress: string;
	baseToken: { address: string; name: string; symbol: string };
	quoteToken: { address: string; name: string; symbol: string };
	priceUsd?: string;
	liquidity?: { usd?: number; base?: number; quote?: number };
	info?: { imageUrl?: string };
};

async function fetchDexScreenerForMints(
	mints: string[]
): Promise<Map<string, { priceUSD?: number; logoURI?: string }>> {
	const out = new Map<string, { priceUSD?: number; logoURI?: string }>();
	if (mints.length === 0) return out;

	// DexScreener allows up to 30 addresses per call
	const batches = chunk(Array.from(new Set(mints)), 30);

	// Track the "best" pair per mint by (stable-quote first, then highest liquidity)
	const best: Record<
		string,
		{ liq: number; stable: boolean; price: number | undefined; logo?: string }
	> = {};

	for (const b of batches) {
		const joined = b.join(",");
		const url = `https://api.dexscreener.com/tokens/v1/solana/${joined}`;
		try {
			const arr = (await fetchJsonWithTimeout(url, { timeoutMs: 12000 })) as
				| DexPair[]
				| { pairs?: DexPair[] };
			// API returns an array (one big flattened array of pairs)
			const pairs: DexPair[] = Array.isArray(arr)
				? arr
				: Array.isArray((arr as any)?.pairs)
				? (arr as any).pairs
				: [];

			for (const p of pairs) {
				const price = p?.priceUsd ? Number(p.priceUsd) : undefined;
				if (!(typeof price === "number" && Number.isFinite(price))) continue;

				const liq = typeof p?.liquidity?.usd === "number" ? p.liquidity.usd : 0;
				const quoteSym = (p?.quoteToken?.symbol || "").toUpperCase();
				const isStable = DS_STABLE_QUOTES.has(quoteSym);

				// Which mint in this pair is one of our addresses?
				const baseMint = p?.baseToken?.address;
				const quoteMint = p?.quoteToken?.address;

				for (const mint of [baseMint, quoteMint]) {
					if (!mint || !mints.includes(mint)) continue;

					const prev = best[mint];
					const cur = { liq, stable: isStable, price, logo: p?.info?.imageUrl };

					let take = false;
					if (!prev) take = true;
					else if (cur.stable !== prev.stable)
						take = cur.stable && !prev.stable;
					else if (cur.liq !== prev.liq) take = cur.liq > prev.liq;

					if (take) best[mint] = cur;
				}
			}
		} catch {
			// ignore batch failures; we still keep other sources
		}
	}

	for (const [mint, v] of Object.entries(best)) {
		out.set(mint, {
			priceUSD: v.price,
			logoURI: v.logo
		});
	}

	return out;
}

/* ---------- Core logic ---------- */

async function fetchHoldingsForAddress(address: string, includeNFT: boolean) {
	// 1) Native SOL
	let balRes: any;
	try {
		balRes = await rpcCall("getBalance", [
			address,
			{ commitment: "confirmed" }
		]);
	} catch (err: any) {
		console.error("rpcCall getBalance failed:", err?.message || err);
		throw new Error(`RPC getBalance failed: ${err?.message || String(err)}`);
	}
	const lamports: number =
		typeof balRes === "number" ? balRes : balRes?.value ?? 0;
	const solAmt = lamportsToSol(lamports);

	// 2) SPL token accounts (parsed)
	let tokRes: any;
	try {
		tokRes = await rpcCall("getTokenAccountsByOwner", [
			address,
			{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
			{ encoding: "jsonParsed", commitment: "confirmed" }
		]);
	} catch (err: any) {
		console.error(
			"rpcCall getTokenAccountsByOwner failed:",
			err?.message || err
		);
		throw new Error(
			`RPC getTokenAccountsByOwner failed: ${err?.message || String(err)}`
		);
	}

	type TokenAccountParsed = {
		pubkey: string;
		account: {
			data: {
				parsed: {
					info: {
						mint: string;
						tokenAmount: {
							uiAmount?: number | null;
							uiAmountString?: string;
							amount?: string;
							decimals?: number;
						};
					};
					type: string;
				};
				program: string;
				space: number;
			};
			executable: boolean;
			lamports: number;
			owner: string;
			rentEpoch?: string;
		};
	};

	const tokenAccs: TokenAccountParsed[] =
		tokRes?.value && Array.isArray(tokRes.value) ? tokRes.value : [];

	// 3) Build raw holdings (sum by mint)
	type Raw = {
		mint: string;
		amountNum: number;
		amountText: string;
		decimals?: number;
		isNFT?: boolean;
	};

	const raw: Raw[] = [];
	if (solAmt > 0) {
		raw.push({
			mint: SOL_MINT,
			amountNum: solAmt,
			amountText: numberToPlain(solAmt),
			decimals: 9,
			isNFT: false
		});
	}

	const byMint = new Map<
		string,
		{ amountNum: number; decimals?: number; nft: boolean }
	>();
	for (const acc of tokenAccs) {
		const info = acc?.account?.data?.parsed?.info;
		const mint = info?.mint as string | undefined;
		const tok = info?.tokenAmount;
		if (!mint || !tok) continue;

		const decimals = tok.decimals as number | undefined;
		const uiStr = (tok.uiAmountString ??
			(tok.uiAmount ?? 0).toString()) as string;
		const amtNum = Number(uiStr) || 0;
		if (!amtNum || amtNum <= 0) continue;

		const nft = isLikelyNFT(decimals, uiStr);
		if (!includeNFT && nft) continue;

		const prev = byMint.get(mint) || { amountNum: 0, decimals, nft };
		prev.amountNum += amtNum;
		if (typeof prev.decimals !== "number") prev.decimals = decimals;
		prev.nft = prev.nft || nft;
		byMint.set(mint, prev);
	}

	for (const [mint, v] of byMint.entries()) {
		raw.push({
			mint,
			amountNum: v.amountNum,
			amountText: numberToPlain(v.amountNum),
			decimals: v.decimals,
			isNFT: v.nft
		});
	}

	// 4) Resolve symbol/decimals
	const needMeta = raw.map((r) => r.mint).filter((m) => m !== SOL_MINT);
	let jupMeta: Map<string, { symbol?: string; decimals?: number }> = new Map();
	try {
		if (needMeta.length > 0)
			jupMeta = await fetchJupiterTokenMetadataMap(needMeta);
	} catch (err: any) {
		console.error("Jupiter token metadata lookup failed:", err?.message || err);
		jupMeta = new Map();
	}

	const still = needMeta.filter((m) => !jupMeta.has(m));

	let helMeta: Map<string, { symbol?: string; decimals?: number }> = new Map();
	try {
		if (still.length > 0)
			helMeta = await fetchTokenMetadataMap(still, process.env.HELIUS_API_KEY);
	} catch (err: any) {
		console.error("Helius token metadata lookup failed:", err?.message || err);
		helMeta = new Map();
	}
	const resolve = mkSymDecResolver(jupMeta, helMeta);

	// 5) Pricing: try mint → id (various casings) → stables → SOL Coingecko fallback
	const allMints = raw.map((r) => r.mint);
	const mintPrices = await fetchPricesJupByMints(allMints);

	// Build symbol map for id queries
	const symbolForMint = new Map<string, string>();
	for (const r of raw) {
		const { symbol } = resolve(r.mint, r.decimals);
		symbolForMint.set(r.mint, (symbol || "").trim());
	}
	const idsToQuery = Array.from(
		new Set(raw.map((r) => symbolForMint.get(r.mint) || "").filter(Boolean))
	);
	const idPrices = await fetchPricesJupByIds(idsToQuery);

	const priceMap = new Map<string, number>();
	for (const r of raw) {
		const mint = r.mint;
		// by mint
		if (mintPrices.has(mint)) {
			priceMap.set(mint, mintPrices.get(mint)!);
			continue;
		}
		// by id/symbol (try original, UPPER, lower)
		const sym = symbolForMint.get(mint) || "";
		const symUpper = sym.toUpperCase();
		const symLower = sym.toLowerCase();
		if (idPrices.has(sym) || idPrices.has(symUpper) || idPrices.has(symLower)) {
			const p =
				idPrices.get(sym) ?? idPrices.get(symUpper) ?? idPrices.get(symLower)!;
			priceMap.set(mint, p!);
			continue;
		}
		// $1 stables
		if (USD_STABLES.has(symUpper)) {
			priceMap.set(mint, 1);
		}
	}

	// SOL fallback via Coingecko if still missing
	if (!priceMap.has(SOL_MINT)) {
		const solP = await fetchSolPriceCoingeckoUSD();
		if (typeof solP === "number") priceMap.set(SOL_MINT, solP);
	}

	// 6) Logos (Jupiter token list)
	let tokenList: Map<
		string,
		{ logoURI?: string; symbol?: string; decimals?: number }
	> = new Map();
	try {
		tokenList = await getJupTokenListMap();
	} catch (err: any) {
		console.error("getJupTokenListMap failed:", err?.message || err);
		tokenList = new Map();
	}

	// 7) DexScreener fallback: fill remaining prices + logos for meme/launchpad tokens
	const missingForPrice = allMints.filter((m) => !priceMap.has(m));
	if (missingForPrice.length > 0) {
		const ds = await fetchDexScreenerForMints(missingForPrice);
		for (const mint of missingForPrice) {
			const got = ds.get(mint);
			if (got?.priceUSD && !priceMap.has(mint))
				priceMap.set(mint, got.priceUSD);
		}
	}

	// 8) Build final holdings (and fill logos using DexScreener if missing)
	const holdings: Holding[] = raw.map((r) => {
		const { symbol, decimals } = resolve(r.mint, r.decimals);
		const jupLogo = tokenList.get(r.mint)?.logoURI;
		const dsLogo = (() => {
			// We'll ask DexScreener once more ONLY for logos still missing – reuse last call if possible
			// (We already called it for missing prices; reuse that mapping if present.)
			return undefined; // Will be filled after we compute a per-mint map below
		})();

		const priceUSD = priceMap.get(r.mint);
		const valueUSD =
			typeof priceUSD === "number" ? priceUSD * (r.amountNum ?? 0) : undefined;

		const logoURI =
			r.mint === SOL_MINT
				? "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png"
				: normalizeLogoUrl(jupLogo) || undefined; // DS fallback added below

		return {
			mint: r.mint,
			symbol,
			amount: r.amountNum,
			amountText: r.amountText,
			decimals,
			isNFT: !!r.isNFT,
			priceUSD,
			valueUSD,
			logoURI
		};
	});

	// 9) For any holding missing a logo, try DexScreener logo
	const needLogos = holdings
		.filter((h) => !h.logoURI)
		.map((h) => h.mint)
		.filter(Boolean);
	if (needLogos.length > 0) {
		const dsLogos = await fetchDexScreenerForMints(needLogos);
		for (const h of holdings) {
			if (!h.logoURI) {
				const ds = dsLogos.get(h.mint);
				if (ds?.logoURI) h.logoURI = ds.logoURI;
			}
		}
	}

	// 10) Sort by USD value desc (unknown valued last), then by symbol
	holdings.sort((a, b) => {
		const av = a.valueUSD ?? -1;
		const bv = b.valueUSD ?? -1;
		if (av !== bv) return bv - av;
		return (a.symbol || "").localeCompare(b.symbol || "");
	});

	return holdings;
}

/* ---------- Route Handlers ---------- */

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as Body;
		const address = String(body.address || "").trim();
		if (!address) {
			return NextResponse.json({ error: "Missing address" }, { status: 400 });
		}
		const includeNFT = Boolean(body.includeNFT ?? false);

		const holdings = await fetchHoldingsForAddress(address, includeNFT);
		return NextResponse.json({ holdings, updatedAt: Date.now() });
	} catch (e: any) {
		// Log full error and stack for easier debugging in dev/servers
		try {
			console.error("/api/kryptosekken/holdings POST error:", e);
			if (e && e.stack) console.error(e.stack);
		} catch {}
		const msg = e?.message || "Unknown error";
		return NextResponse.json({ error: msg }, { status: 502 });
	}
}

export async function GET(req: NextRequest) {
	try {
		const sp = req.nextUrl.searchParams;
		const address = String(sp.get("address") || "").trim();
		if (!address) {
			return NextResponse.json({ error: "Missing address" }, { status: 400 });
		}
		const includeNFT = sp.get("includeNFT") === "1";

		const holdings = await fetchHoldingsForAddress(address, includeNFT);
		return NextResponse.json({ holdings, updatedAt: Date.now() });
	} catch (e: any) {
		const msg = e?.message || "Unknown error";
		return NextResponse.json({ error: msg }, { status: 502 });
	}
}

// OPTIONS to avoid 405 on preflights
export function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: { "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }
	});
}
