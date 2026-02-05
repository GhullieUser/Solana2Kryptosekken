"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BsCheckLg, BsXDiamondFill } from "react-icons/bs";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

type TierKey = "500" | "1000" | "10000" | "test";

type Tier = {
	key: TierKey;
	title: { no: string; en: string };
	price: { no: string; en: string };
	credits: number;
	audience: { no: string; en: string };
	accent?: boolean;
	tag?: { no: string; en: string };
};

const tiers: Tier[] = [
	{
		key: "500",
		title: { no: "500 TX", en: "500 TX" },
		price: { no: "250 kr", en: "250 NOK" },
		credits: 500,
		audience: {
			no: "For mindre lommebøker og raske sjekker.",
			en: "For smaller wallets and quick checks."
		}
	},
	{
		key: "1000",
		title: { no: "1000 TX", en: "1000 TX" },
		price: { no: "500 kr", en: "500 NOK" },
		credits: 1000,
		audience: {
			no: "For aktive brukere med flere transaksjoner.",
			en: "For active users with more transactions."
		},
		accent: true
	},
	{
		key: "10000",
		title: { no: "10000 TX", en: "10000 TX" },
		price: { no: "4500 kr", en: "4500 NOK" },
		credits: 10000,
		audience: {
			no: "For avanserte brukere og store porteføljer.",
			en: "For advanced users and large portfolios."
		}
	},
	{
		key: "test",
		title: { no: "Test", en: "Test" },
		price: { no: "5 kr", en: "5 NOK" },
		credits: 750,
		audience: {
			no: "Kun for intern testing.",
			en: "For internal testing only."
		},
		tag: { no: "Midlertidig", en: "Temporary" }
	}
];

export default function PricingPage() {
	const { tr } = useLocale();
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const [loadingTier, setLoadingTier] = useState<TierKey | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [hasSession, setHasSession] = useState(false);
	const [sessionChecked, setSessionChecked] = useState(false);

	useEffect(() => {
		let mounted = true;
		supabase.auth
			.getSession()
			.then(({ data }) => {
				if (!mounted) return;
				setHasSession(Boolean(data.session));
				setSessionChecked(true);
			})
			.catch(() => {
				if (!mounted) return;
				setHasSession(false);
				setSessionChecked(true);
			});
		return () => {
			mounted = false;
		};
	}, [supabase]);

	async function startCheckout(tier: TierKey) {
		setError(null);
		setLoadingTier(tier);
		const res = await fetch("/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tier })
		});

		if (res.status === 401) {
			const { data } = await supabase.auth.getSession();
			if (!data.session) {
				window.location.href = "/signin";
				return;
			}
		}

		if (!res.ok) {
			setError(
				tr({
					no: "Kunne ikke starte betaling.",
					en: "Failed to start checkout."
				})
			);
			setLoadingTier(null);
			return;
		}
		const j = await res.json().catch(() => null);
		if (j?.url) {
			window.location.href = j.url;
			return;
		}
		setError(
			tr({ no: "Kunne ikke starte betaling.", en: "Failed to start checkout." })
		);
		setLoadingTier(null);
	}

	return (
		<main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="mx-auto max-w-6xl px-4 pt-24 sm:pt-28 pb-12">
				<div className="text-center">
					<h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-white">
						{tr({ no: "Priser", en: "Pricing" })}
					</h1>
					<p className="mt-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400 mx-auto max-w-3xl px-2 lg:px-6">
						<span>
							{tr({
								no: "TX Credits brukes når vi skanner lommeboken din.",
								en: "TX Credits are used when we scan your wallet."
							})}
						</span>
						<span className="mx-1 inline-flex items-center gap-1">
							<BsXDiamondFill className="h-3.5 w-3.5 text-amber-500" />
								{tr({ no: "1 TX Credit", en: "1 TX Credit" })}
						</span>
							{tr({
								no: "= 1 rå transaksjon. En rå transaksjon er én enkelt post fra blokkjeden, før vi grupperer og tolker den i rapporten. Du kan fylle på med TX credits når som helst.",
								en: "= 1 raw transaction. A raw transaction is a single on-chain record before we group and interpret it in your report. You can top up TX credits at any time."
							})}
					</p>
				</div>

				<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/90 dark:bg-white/5 p-5 flex flex-col min-h-[360px] transition hover:border-indigo-200/80 hover:bg-white/95 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10">
						<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
							{tr({ no: "50 TX", en: "50 TX" })}
						</p>
						<div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
							<span>{tr({ no: "GRATIS", en: "FREE" })}</span>
						</div>
						<p className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
							<BsXDiamondFill className="h-4 w-4 text-amber-500" />
							<span>
								{tr({ no: "50 TX Credits", en: "50 TX Credits" })}
							</span>
						</p>
						<div className="mt-auto space-y-3">
							<p className="text-sm text-slate-600 dark:text-slate-300">
								{tr({
									no: "Alle brukere får nok til å teste kostnadsfritt når de oppretter konto.",
									en: "All users get enough credits to test the app for free when signing up."
								})}
							</p>
							{sessionChecked && !hasSession && (
								<Link
									href="/signin"
									className="inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition bg-indigo-600 text-white hover:bg-indigo-500"
								>
									{tr({ no: "Logg Inn", en: "Log in" })}
								</Link>
							)}
							{sessionChecked && hasSession && (
								<button
									type="button"
									disabled
									className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/5 text-slate-500 dark:text-slate-400 cursor-not-allowed"
								>
									<BsCheckLg className="h-4 w-4" />
									{tr({ no: "Aktiv", en: "Active" })}
								</button>
							)}
						</div>
					</div>

					{tiers.map((tier) => (
						<div
							key={tier.key}
							className="rounded-2xl border p-5 flex flex-col min-h-[360px] border-slate-200/80 dark:border-white/10 bg-white/90 dark:bg-white/5 transition hover:border-indigo-200/80 hover:bg-white/95 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10"
						>
							<div className="flex items-center justify-between">
								<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
									{tr(tier.title)}
								</p>
								{tier.tag && (
									<span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5 text-[10px] font-semibold">
										{tr(tier.tag)}
									</span>
								)}
							</div>
							<p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
								{tr(tier.price)}
							</p>
							<p className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
								<BsXDiamondFill className="h-4 w-4 text-amber-500" />
								<span>
									{tr({
										no: `${tier.credits} TX Credits`,
										en: `${tier.credits} TX Credits`
									})}
								</span>
							</p>
							<div className="mt-auto space-y-3">
								<p className="text-sm text-slate-600 dark:text-slate-300">
									{tr(tier.audience)}
								</p>
								<button
									type="button"
									onClick={() => startCheckout(tier.key)}
									disabled={loadingTier === tier.key}
									className="w-full rounded-xl px-4 py-2 text-sm font-semibold transition bg-indigo-600 text-white hover:bg-indigo-500"
								>
									{loadingTier === tier.key
										? tr({ no: "Laster…", en: "Loading…" })
										: tr({ no: "Kjøp", en: "Buy" })}
								</button>
							</div>
						</div>
					))}
				</div>

				{error && (
					<p className="mt-6 text-center text-sm text-rose-600">{error}</p>
				)}

				<div className="mt-10 text-center text-xs text-slate-500 dark:text-slate-400" />
			</div>
		</main>
	);
}
