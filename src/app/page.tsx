"use client";

import Image from "next/image";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
	FiCheckCircle,
	FiEdit3,
	FiLayers,
	FiLink,
	FiShield,
	FiFileText,
	FiPlus
} from "react-icons/fi";
import { MdOutlineCleaningServices } from "react-icons/md";
import { useLocale } from "@/app/components/locale-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LandingPage() {
	const { tr } = useLocale();
	const router = useRouter();
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const handleOpenGenerator = useCallback(async () => {
		const { data } = await supabase.auth.getSession();
		const isAuthed = Boolean(data.session?.user);
		router.push(isAuthed ? "/csvgenerator" : "/signin");
	}, [router, supabase]);
	const marqueeLogos = [
		{ src: "/logos/solana/solana-sol-logo.svg", alt: "Solana" },
		{ src: "/logos/phantom-logo.svg", alt: "Phantom" },
		{ src: "/logos/solana/raydium-ray-logo.svg", alt: "Raydium" },
		{ src: "/logos/solana/meteora-logo.svg", alt: "Meteora" },
		{ src: "/logos/solana/bonk1-bonk-logo.svg", alt: "Bonk" },
		{ src: "/logos/solana/Pump_Fun-logo.svg", alt: "Pump.fun" },
		{ src: "/logos/solana/gmgn-logo.svg", alt: "GMGN" },
		{ src: "/logos/orca-logo.svg", alt: "Orca" }
	];

	return (
		<>
			<div className="min-h-dvh flex flex-col bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
				<main className="relative flex flex-1 items-center justify-center overflow-hidden pt-24 sm:pt-28 pb-16">
					<div className="pointer-events-none absolute inset-0 -z-10">
						<div
							className="absolute -top-32 left-1/2 h-96 w-[500px] -translate-x-1/2 rotate-12 bg-indigo-400/30 blur-[100px]"
							style={{ borderRadius: "45% 55% 60% 40% / 50% 45% 55% 50%" }}
						/>
						<div
							className="absolute top-24 right-[-6rem] h-80 w-[400px] -rotate-12 bg-emerald-400/20 blur-[90px]"
							style={{ borderRadius: "60% 40% 55% 45% / 45% 60% 40% 55%" }}
						/>
						<div
							className="absolute bottom-[-8rem] left-[-6rem] h-96 w-[420px] rotate-6 bg-sky-400/20 blur-[95px]"
							style={{ borderRadius: "50% 50% 45% 55% / 55% 45% 55% 45%" }}
						/>
						<div
							className="absolute top-1/3 left-1/4 h-64 w-[350px] -rotate-45 bg-indigo-300/15 blur-[80px]"
							style={{ borderRadius: "40% 60% 50% 50% / 60% 40% 60% 40%" }}
						/>
						<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_60%)] dark:bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.08),_transparent_60%)]" />
					</div>
					<div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:pt-6 pb-0">
						<section className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)] items-center gap-8 sm:gap-4">
							<div className="min-w-0 text-center sm:text-left">
								<h1 className="text-balance text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight max-w-[18ch] sm:max-w-[20ch] lg:max-w-[22ch] mx-auto sm:mx-0">
									<span className="bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">
										{tr({
											no: "Solana-transaksjoner gjort enklere",
											en: "Solana transactions, simplified"
										})}
									</span>
								</h1>
								<p className="mt-5 text-balance leading-relaxed max-w-[90ch] text-sm sm:text-base text-slate-700 dark:text-slate-300">
									{tr({
										no: "Hent transaksjoner fra enhver Solana-adresse til en ryddig og oversiktlig CSV-fil, klar for import i Kryptosekken.",
										en: "Extract transactions from any Solana address into a CSV file ready for Kryptosekken."
									})}
								</p>
								<div className="mt-6 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-3">
									<button
										type="button"
										onClick={handleOpenGenerator}
										className="inline-flex items-center rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 text-white !text-white px-7 py-3.5 text-base sm:text-lg font-semibold shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:via-blue-500 hover:to-emerald-500 transition"
									>
										{tr({ no: "Prøv gratis", en: "Try for free" })}
									</button>
									<button
										type="button"
										className="inline-flex items-center rounded-2xl border border-slate-200 bg-white/70 px-6 py-3 text-base sm:text-lg font-semibold text-slate-800 shadow-sm hover:bg-white transition dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
									>
										{tr({ no: "Se priser", en: "See pricing" })}
									</button>
								</div>
							</div>

							<div className="hidden sm:flex flex-col items-center gap-5 sm:justify-self-start sm:-ml-2">
								<div className="s2ks-glow h-30 w-30 sm:h-54 sm:w-54">
									<div className="s2ks-flip">
										<div className="s2ks-face face-1">
											<Image
												src="/Sol2KS_logo.svg"
												alt="Sol2KS"
												width={144}
												height={144}
												className="h-21 w-21 sm:h-48 sm:w-48 object-contain"
												sizes="(min-width: 640px) 12rem, 5.25rem"
												priority
											/>
										</div>
										<div className="s2ks-face face-2">
											<Image
												src="/logos/solana/solana-sol-logo.svg"
												alt="Solana"
												width={144}
												height={144}
												className="h-18 w-18 sm:h-44 sm:w-44 object-contain brightness-0 invert"
												priority
											/>
										</div>
										<div className="s2ks-face face-3">
											<Image
												src="/Sol2KS_logo.svg"
												alt="S2KS"
												width={144}
												height={144}
												className="h-21 w-21 sm:h-48 sm:w-48 object-contain"
												priority
											/>
										</div>
										<div className="s2ks-face face-4">
											<FiFileText className="h-21 w-21 sm:h-48 sm:w-48 text-white" />
										</div>
									</div>
								</div>
							</div>
						</section>
						<div className="mt-20 mb-12">
							<div className="flex flex-wrap justify-center gap-3 sm:gap-4 max-w-5xl mx-auto">
								{marqueeLogos.map((logo, index) => (
									<div
										key={logo.src}
										className="group relative w-20 sm:w-24"
										style={{
											animation: `float ${3 + (index % 3) * 0.5}s ease-in-out infinite`,
											animationDelay: `${index * 0.2}s`
										}}
									>
										<div className="relative aspect-square rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur-sm border border-slate-200/50 dark:border-white/10 p-4 sm:p-5 transition-all duration-300 hover:scale-110 hover:bg-white/60 dark:hover:bg-white/10 hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:shadow-indigo-400/20">
											<div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/0 via-transparent to-emerald-500/0 opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
											<Image
												src={logo.src}
												alt={logo.alt}
												width={64}
												height={64}
												className="h-full w-full object-contain opacity-80 group-hover:opacity-100 transition-opacity duration-300"
											/>
										</div>
									</div>
								))}
								<div
									className="group relative w-20 sm:w-24"
									style={{
										animation: `float ${3 + (marqueeLogos.length % 3) * 0.5}s ease-in-out infinite`,
										animationDelay: `${marqueeLogos.length * 0.2}s`
									}}
								>
									<div className="relative aspect-square rounded-2xl bg-white/40 dark:bg-white/5 backdrop-blur-sm border border-slate-200/50 dark:border-white/10 p-4 sm:p-5 transition-all duration-300 hover:scale-110 hover:bg-white/60 dark:hover:bg-white/10 hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:shadow-indigo-400/20 flex items-center justify-center">
										<div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/0 via-transparent to-emerald-500/0 opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
										<FiPlus className="h-8 w-8 sm:h-10 sm:w-10 text-slate-400 dark:text-slate-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors duration-300" />
									</div>
								</div>
							</div>
						</div>
						<div className="mt-8" id="features">
							<div className="flex flex-col gap-2 text-center">
								<h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
									{tr({
										no: "Spar tid på skattemeldingen",
										en: "Save time on your tax report"
									})}
								</h2>
								<p className="text-sm sm:text-base text-slate-700 dark:text-slate-300">
									{tr({
										no: "Lim inn en Solana-adresse, velg tidsrom, sjekk lommeboken og last ned en CSV klar for import i Kryptosekken.",
										en: "Paste a Solana address, choose a date range, check the wallet, and download a CSV ready for import into Kryptosekken."
									})}
								</p>
							</div>

							<div className="mt-5">
								<ul className="grid gap-4 sm:grid-cols-2">
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-rose-600 transition group-hover:scale-105 dark:text-rose-200">
											<FiLayers className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "Hold styr på alle Solana‑lommebøkene dine",
													en: "Keep track of all your Solana wallets"
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Samle historikk og beholdning på ett sted.",
													en: "Consolidate history and holdings in one place."
												})}
											</p>
										</div>
									</li>
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-lime-700 transition group-hover:scale-105 dark:text-lime-200">
											<FiLink className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "Alle transaksjoner markeres med signaturer som lett kan spores på blokkjeden",
													en: "Every transaction is marked with signatures easily traceable on-chain"
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Få full sporbarhet og transparens i alle Solana-transaksjonene dine.",
													en: "Get full traceability and transparency across all your Solana transactions."
												})}
											</p>
										</div>
									</li>
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-cyan-700 transition group-hover:scale-105 dark:text-cyan-200">
											<MdOutlineCleaningServices className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "Rydd opp i støvtransaksjoner og hold historikken ryddig.",
													en: "Clean up dust transactions and keep history tidy."
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Fjern støy og fokuser på reelle handler.",
													en: "Reduce noise and focus on real trades."
												})}
											</p>
										</div>
									</li>
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-orange-700 transition group-hover:scale-105 dark:text-orange-200">
											<FiEdit3 className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "Utvidet transaksjonsdata gir full innsikt i transaksjonene dine.",
													en: "Enhanced transaction data gives full insight into your transactions."
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Rediger felter basert på signer, sender, mottaker og program‑ID‑adresse.",
													en: "Edit fields based on signer, sender, receiver, and program ID address."
												})}
											</p>
										</div>
									</li>
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-fuchsia-700 transition group-hover:scale-105 dark:text-fuchsia-200">
											<FiCheckCircle className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "CSV er formatert for Kryptosekken",
													en: "CSV is formatted for Kryptosekken"
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Import uten friksjon.",
													en: "Import without friction."
												})}
											</p>
										</div>
									</li>
									<li className="group flex items-start gap-3">
										<span className="mt-1 inline-flex size-12 aspect-square items-center justify-center text-purple-700 transition group-hover:scale-105 dark:text-purple-200">
											<FiShield className="h-7 w-7" />
										</span>
										<div>
											<p className="text-base font-semibold text-slate-900 dark:text-slate-100">
												{tr({
													no: "Personvern først – historikken din forblir din.",
													en: "Privacy first — your history stays yours."
												})}
											</p>
											<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
												{tr({
													no: "Kun du har tilgang til lagret adressehistorikk.",
													en: "Only you can access your saved address history."
												})}
											</p>
										</div>
									</li>
								</ul>
							</div>
						</div>
					</div>
				</main>
				<footer className="mt-auto py-3 text-xs text-slate-600 dark:text-slate-300">
					<div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
						<p>
							{tr({
								no: "© 2026 Sol2KS. Alle rettigheter forbeholdt.",
								en: "© 2026 Sol2KS. All rights reserved."
							})}
						</p>
						<div className="flex items-center gap-4">
							<Link
								href="/personvern"
								className="hover:text-slate-900 dark:hover:text-white transition"
							>
								{tr({ no: "Personvern", en: "Privacy" })}
							</Link>
							<Link
								href="/vilkar"
								className="hover:text-slate-900 dark:hover:text-white transition"
							>
								{tr({ no: "Vilkår", en: "Terms" })}
							</Link>
						</div>
					</div>
				</footer>
			</div>
		</>
	);
}
