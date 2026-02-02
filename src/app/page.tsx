"use client";

import Image from "next/image";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Marquee from "react-fast-marquee";
import {
	FiCheckCircle,
	FiEdit3,
	FiLayers,
	FiLink,
	FiShield,
	FiFileText
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
		{ src: "/logos/solana/raydium-ray-logo.svg", alt: "Raydium" },
		{ src: "/logos/solana/meteora-logo.svg", alt: "Meteora" },
		{ src: "/logos/solana/bonk1-bonk-logo.svg", alt: "Bonk" },
		{ src: "/logos/solana/Pump_Fun-logo.svg", alt: "Pump.fun" },
		{ src: "/logos/solana/gmgn-logo.svg", alt: "GMGN" }
	];

	return (
		<>
			<main className="min-h-[calc(100svh-64px)] flex items-center overflow-hidden">
				<div className="mx-auto w-full max-w-6xl px-4 py-0">
					<section className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-6">
						<div className="min-w-0 text-center sm:text-left">
							<h1 className="text-balance text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight max-w-[18ch] sm:max-w-[20ch] lg:max-w-[22ch] mx-auto sm:mx-0">
								<span className="bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">
									{tr({
										no: "Solana-transaksjoner gjort enklere",
										en: "Solana transactions, simplified"
									})}
								</span>
							</h1>
							<p className="mt-2 text-balance leading-relaxed max-w-[65ch] text-sm sm:text-base text-slate-700 dark:text-slate-300">
								{tr({
									no: "Lim inn en Solana-adresse, velg tidsrom, sjekk lommeboken og last ned en CSV klar for import i Kryptosekken.",
									en: "Paste a Solana address, choose a date range, check the wallet, and download a CSV ready for import into Kryptosekken."
								})}
							</p>
						</div>

						<div className="hidden sm:flex items-center justify-center">
							<div className="s2ks-glow h-20 w-20 sm:h-36 sm:w-36">
								<div className="s2ks-flip">
									<div className="s2ks-face front">
										<Image
											src="/Sol2KS_logo.svg"
											alt="Sol2KS"
											fill
											className="object-contain"
											sizes="(min-width: 640px) 9rem, 5rem"
											priority
										/>
									</div>
									<div className="s2ks-face back">
										<div className="flex h-full w-full items-center justify-center">
											<FiFileText className="h-12 w-12 sm:h-24 sm:w-24 text-white" />
										</div>
									</div>
								</div>
							</div>
						</div>
					</section>
					<div className="mt-6 flex items-center justify-center">
						<button
							type="button"
							onClick={handleOpenGenerator}
							className="inline-flex items-center rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 text-white !text-white px-7 py-3.5 text-base sm:text-lg font-semibold shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:via-blue-500 hover:to-emerald-500 transition"
						>
							{tr({ no: "CSV Generator", en: "CSV Generator" })}
						</button>
					</div>
					<div className="my-10 h-px w-full bg-slate-200/70 dark:bg-white/10" />
					<div className="mt-12">
						<div>
							<h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
								{tr({
									no: "Alt du trenger for ryddig rapportering",
									en: "Everything you need for clean reporting"
								})}
							</h2>
							<p className="mt-2 text-sm sm:text-base text-slate-700 dark:text-slate-300">
								{tr({
									no: "Fra lommebøker til ferdig CSV – raskt, presist og privat.",
									en: "From wallets to ready CSV — fast, accurate, and private."
								})}
							</p>
						</div>
						<div className="mt-6 grid gap-4 sm:grid-cols-2">
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
									<FiLayers className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
										{tr({
											no: "Hold styr på alle Solana Lommebøkene dine",
											en: "Keep track of all your Solana wallets"
										})}
									</p>
									<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
										{tr({
											no: "Samle alle adresser og porteføljer i én strøm.",
											en: "Bring all addresses and portfolios into one stream."
										})}
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
									<FiLink className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
										{tr({
											no: "Transaksjonssignaturer kobles til notater for rask on-chain sporing.",
											en: "Transaction signatures are linked to notes for fast on-chain tracing."
										})}
									</p>
									<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
										{tr({
											no: "Gå direkte fra notat til transaksjon på blokkjeden.",
											en: "Jump from note to transaction on-chain in seconds."
										})}
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">
									<MdOutlineCleaningServices className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
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
							</div>
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
									<FiEdit3 className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
										{tr({
											no: "Rediger felter basert på signer, sender, mottaker og program-ID-adresse.",
											en: "Edit fields based on signer, sender, receiver, and program ID address."
										})}
									</p>
									<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
										{tr({
											no: "Presis kontroll over dataene før eksport.",
											en: "Fine‑tune data before export."
										})}
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200">
									<FiCheckCircle className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
										{tr({
											no: "CSV er formatert for Kryptosekken – import uten friksjon.",
											en: "CSV is formatted for Kryptosekken — import without friction."
										})}
									</p>
									<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
										{tr({
											no: "CSV‑en passer rett inn i importflyten.",
											en: "Drop the CSV directly into the import flow."
										})}
									</p>
								</div>
							</div>
							<div className="flex gap-4">
								<span className="relative mt-1 flex h-10 w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
									<FiShield className="h-4 w-4" />
								</span>
								<div>
									<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
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
							</div>
						</div>
					</div>
					<div className="my-10 h-px w-full bg-slate-200/70 dark:bg-white/10" />
					<div className="mt-10">
						<h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
							{tr({
								no: "Støtter populære solana apper",
								en: "Supports popular Solana apps"
							})}
						</h2>
						<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
							{tr({
								no: "Henter og oversetter transaksjoner fra de mest brukte appene på Solana.",
								en: "Fetches and translates transactions from the most-used Solana apps."
							})}
						</p>
						<div className="mt-3 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-transparent py-2">
							<Marquee
								speed={55}
								gradient={false}
								gradientWidth={0}
								pauseOnHover
							>
								{marqueeLogos.map((logo) => (
									<div
										key={logo.src}
										className="mx-6 flex min-w-[140px] items-center justify-center"
									>
										<div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5">
											<Image
												src={logo.src}
												alt={logo.alt}
												width={40}
												height={40}
												className="h-8 w-8 object-contain opacity-90 hover:opacity-100 transition"
											/>
										</div>
									</div>
								))}
							</Marquee>
						</div>
					</div>
				</div>
			</main>
		</>
	);
}
