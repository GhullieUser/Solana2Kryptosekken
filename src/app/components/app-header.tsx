"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLocale } from "@/app/components/locale-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
	FiMoon,
	FiSun,
	FiUser,
	FiChevronDown,
	FiLogOut,
	FiMenu,
	FiSettings
} from "react-icons/fi";
import { BsXDiamondFill } from "react-icons/bs";

function useTheme() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const saved =
			typeof window !== "undefined" ? localStorage.getItem("theme") : null;
		const systemPrefersDark =
			typeof window !== "undefined" &&
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches;

		const dark = saved ? saved === "dark" : systemPrefersDark;
		document.documentElement.classList.toggle("dark", dark);
		setIsDark(dark);
	}, []);

	const toggle = () => {
		setIsDark((prev) => {
			const next = !prev;
			document.documentElement.classList.toggle("dark", next);
			try {
				localStorage.setItem("theme", next ? "dark" : "light");
			} catch {}
			return next;
		});
	};

	return { isDark, toggle };
}

function ThemePill() {
	const { tr } = useLocale();
	const { isDark, toggle } = useTheme();
	return (
		<button
			type="button"
			onClick={toggle}
			className="inline-flex h-[24px] sm:h-[26px] w-[28px] sm:w-[30px] items-center justify-center rounded-full text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-white/10 transition"
			title={tr({ no: "Bytt lys/mørk", en: "Toggle light/dark" })}
			aria-label={tr({ no: "Bytt lys/mørk", en: "Toggle light/dark" })}
		>
			{isDark ? (
				<FiMoon className="h-4 w-4 sm:h-5 sm:w-5" />
			) : (
				<FiSun className="h-4 w-4 sm:h-5 sm:w-5" />
			)}
		</button>
	);
}

function LocalePill() {
	const { locale, setLocale, tr } = useLocale();
	const baseBtn =
		"inline-flex h-[22px] sm:h-[24px] w-[26px] sm:w-[28px] items-center justify-center rounded-full leading-none transition";
	const selected = "opacity-100 saturate-150";
	const unselected =
		"opacity-60 saturate-0 hover:opacity-100 hover:saturate-100";

	return (
		<div
			className="inline-flex items-center gap-1"
			aria-label={tr({ no: "Språk", en: "Language" })}
		>
			<button
				type="button"
				onClick={() => setLocale("no")}
				className={`${baseBtn} ${locale === "no" ? selected : unselected}`}
				aria-label={tr({ no: "Norsk", en: "Norwegian" })}
				title={tr({ no: "Norsk", en: "Norwegian" })}
			>
				<Image
					src="/flag-no.svg"
					alt={tr({ no: "Norsk", en: "Norwegian" })}
					width={20}
					height={15}
					className="block w-[18px] h-[13px] sm:w-[20px] sm:h-[15px]"
					priority
				/>
			</button>
			<button
				type="button"
				onClick={() => setLocale("en")}
				className={`${baseBtn} ${locale === "en" ? selected : unselected}`}
				aria-label={tr({ no: "English", en: "English" })}
				title={tr({ no: "English", en: "English" })}
			>
				<Image
					src="/flag-gb.svg"
					alt={tr({ no: "English", en: "English" })}
					width={20}
					height={15}
					className="block w-[18px] h-[13px] sm:w-[20px] sm:h-[15px]"
					priority
				/>
			</button>
		</div>
	);
}

export default function AppHeader() {
	const pathname = usePathname();
	const { tr } = useLocale();
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const [isAuthed, setIsAuthed] = useState(false);
	const [userEmail, setUserEmail] = useState<string | null>(null);
	const [userId, setUserId] = useState<string | null>(null);
	const [userMenuOpen, setUserMenuOpen] = useState(false);
	const userMenuRef = useRef<HTMLDivElement | null>(null);
	const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
	const settingsMenuRef = useRef<HTMLDivElement | null>(null);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const mobileMenuRef = useRef<HTMLDivElement | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
	const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
	const [animatedCredits, setAnimatedCredits] = useState<number | null>(null);
	const creditsAnimRef = useRef<number | null>(null);
	const animatedCreditsRef = useRef<number | null>(null);

	useEffect(() => {
		animatedCreditsRef.current = animatedCredits;
	}, [animatedCredits]);

	const refreshCredits = async (signal?: AbortSignal) => {
		try {
			const res = await fetch("/api/billing/status", {
				method: "GET",
				cache: "no-store",
				signal
			});
			if (!res.ok) return;
			const data = (await res.json()) as {
				creditsRemaining?: number;
				freeRemaining?: number;
			};
			setCreditsRemaining(
				typeof data.creditsRemaining === "number" ? data.creditsRemaining : 0
			);
			setFreeRemaining(
				typeof data.freeRemaining === "number" ? data.freeRemaining : 0
			);
		} catch {
			// ignore
		}
	};

	useEffect(() => {
		let active = true;
		(async () => {
			const { data } = await supabase.auth.getUser();
			if (!active) return;
			setIsAuthed(!!data?.user);
			setUserEmail(data?.user?.email ?? null);
			setUserId(data?.user?.id ?? null);
		})();
		return () => {
			active = false;
		};
	}, [supabase]);

	useEffect(() => {
		if (!isAuthed) {
			setCreditsRemaining(null);
			setFreeRemaining(null);
			return;
		}
		const controller = new AbortController();
		refreshCredits(controller.signal);
		return () => controller.abort();
	}, [isAuthed]);

	useEffect(() => {
		if (!isAuthed || !userId) return;
		const channel = supabase
			.channel(`billing-credits-${userId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "billing_user_credits",
					filter: `user_id=eq.${userId}`
				},
				(payload) => {
					const next = (payload as { new?: { credits_remaining?: number } }).new
						?.credits_remaining;
					if (typeof next === "number") {
						setCreditsRemaining(next);
					}
				}
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [isAuthed, supabase, userId]);

	useEffect(() => {
		if (!isAuthed) return;
		const onBillingUpdate = () => refreshCredits();
		window.addEventListener("sol2ks:billing:update", onBillingUpdate);
		return () =>
			window.removeEventListener("sol2ks:billing:update", onBillingUpdate);
	}, [isAuthed]);

	useEffect(() => {
		function onDocClick(e: MouseEvent) {
			const target = e.target as Node;
			if (userMenuRef.current && !userMenuRef.current.contains(target)) {
				setUserMenuOpen(false);
			}
			if (
				settingsMenuRef.current &&
				!settingsMenuRef.current.contains(target)
			) {
				setSettingsMenuOpen(false);
			}
			if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) {
				setMobileMenuOpen(false);
			}
		}
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, []);

	useEffect(() => {
		function onScroll() {
			setScrolled(window.scrollY > 4);
		}
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const total =
			creditsRemaining === null || freeRemaining === null
				? null
				: creditsRemaining + freeRemaining;
		if (total === null) {
			setAnimatedCredits(null);
			return;
		}
		const start =
			animatedCreditsRef.current === null ||
			Number.isNaN(animatedCreditsRef.current)
				? total
				: animatedCreditsRef.current;
		const end = total;
		if (start === end) {
			setAnimatedCredits(end);
			return;
		}
		const duration = 500;
		const startTime = performance.now();
		const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
		const tick = (now: number) => {
			const t = Math.min(1, (now - startTime) / duration);
			const v = Math.round(start + (end - start) * easeOut(t));
			setAnimatedCredits(v);
			if (t < 1) {
				creditsAnimRef.current = requestAnimationFrame(tick);
			}
		};
		if (creditsAnimRef.current) {
			cancelAnimationFrame(creditsAnimRef.current);
		}
		creditsAnimRef.current = requestAnimationFrame(tick);
		return () => {
			if (creditsAnimRef.current) {
				cancelAnimationFrame(creditsAnimRef.current);
			}
		};
	}, [creditsRemaining, freeRemaining]);

	async function signOut() {
		await supabase.auth.signOut();
		window.location.href = "/";
	}

	return (
		<header
			data-scrolled={scrolled}
			className={`s2ks-header fixed top-0 inset-x-0 z-40 text-xs sm:text-sm text-slate-600 dark:text-slate-300 transition-[background-color,box-shadow,backdrop-filter] ${
				scrolled
					? "bg-white/90 dark:bg-slate-900/80 backdrop-blur shadow-sm"
					: "bg-transparent"
			}`}
		>
			<div className="relative mx-auto max-w-6xl px-4 py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
				<div className="flex items-center gap-2 sm:gap-3 font-medium text-slate-800 dark:text-slate-200">
					<Link
						href="/"
						className="group inline-flex items-center justify-center rounded-full transition-transform"
						aria-label={tr({ no: "Hjem", en: "Home" })}
					>
						<Image
							src="/Sol2KS_logo.svg"
							alt="Sol2KS"
							width={32}
							height={32}
							className="block w-8 h-8 sm:w-8 sm:h-8 transition-transform duration-200 group-hover:scale-110 group-active:scale-95"
						/>
					</Link>
				</div>

				<nav
					className={`hidden md:flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200 text-sm ${
						isAuthed
							? "flex-1 justify-center"
							: "absolute left-1/2 -translate-x-1/2"
					}`}
				>
					<Link
						href="/"
						className={`px-4 py-1.5 transition-colors duration-200 ${
							pathname === "/"
								? "text-slate-900 dark:text-white opacity-100"
								: "text-slate-600 dark:text-slate-400 opacity-70 hover:opacity-100 hover:text-slate-800 dark:hover:text-slate-200"
						}`}
					>
						{tr({ no: "Hjem", en: "Home" })}
					</Link>
					<Link
						href="/csvgenerator"
						className={`px-4 py-1.5 transition-colors duration-200 ${
							pathname === "/csvgenerator"
								? "text-slate-900 dark:text-white opacity-100"
								: "text-slate-600 dark:text-slate-400 opacity-70 hover:opacity-100 hover:text-slate-800 dark:hover:text-slate-200"
						}`}
					>
						{tr({ no: "Lommebok Skanner", en: "Wallet Scanner" })}
					</Link>
					<Link
						href="/pricing"
						className={`px-4 py-1.5 transition-colors duration-200 ${
							pathname === "/pricing"
								? "text-slate-900 dark:text-white opacity-100"
								: "text-slate-600 dark:text-slate-400 opacity-70 hover:opacity-100 hover:text-slate-800 dark:hover:text-slate-200"
						}`}
					>
						{tr({ no: "Priser", en: "Pricing" })}
					</Link>
				</nav>

				<div
					className={`flex items-center gap-2 ml-auto ${
						isAuthed ? "md:ml-0" : "md:ml-auto"
					}`}
				>
					{isAuthed && (
						<div className="w-[90px] sm:w-[90px] flex justify-end">
							<Link
								href="/pricing"
								className="inline-flex h-[34px] sm:h-[32px] items-center justify-center gap-2 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-4 sm:px-4 text-[12px] sm:text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
								aria-label={tr({ no: "TX Credits", en: "TX Credits" })}
								title={tr({ no: "TX Credits", en: "TX Credits" })}
							>
								<BsXDiamondFill className="h-4 w-4 sm:h-4 sm:w-4 text-amber-500" />
								<span className="tabular-nums">
									{animatedCredits === null ? "—" : animatedCredits}
								</span>
							</Link>
						</div>
					)}
					{isAuthed ? (
						<div className="relative w-max" ref={userMenuRef}>
							<button
								type="button"
								onClick={() => setUserMenuOpen((v) => !v)}
								className="inline-flex h-[34px] sm:h-[32px] items-center justify-center gap-1 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-4 sm:px-4 text-[12px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
							>
								<FiUser className="h-4 w-4 sm:h-4 sm:w-4" />
								<span className="hidden lg:inline-block max-w-[160px] truncate">
									{userEmail ?? tr({ no: "Bruker", en: "User" })}
								</span>
								<FiChevronDown className="h-4 w-4 sm:h-4 sm:w-4 opacity-70" />
							</button>
							{userMenuOpen && (
								<div className="absolute right-0 mt-2 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50 hidden md:block">
									<div className="lg:hidden px-3 py-2 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100/70 dark:border-white/10 truncate">
										{userEmail ?? tr({ no: "Bruker", en: "User" })}
									</div>
									<Link
										href="/user"
										className="flex items-center gap-2 px-3 py-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
										onClick={() => setUserMenuOpen(false)}
									>
										<FiUser className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
										{tr({ no: "Vis profil", en: "View profile" })}
									</Link>
									<button
										type="button"
										onClick={signOut}
										className="flex w-full items-center gap-2 px-3 py-2 text-xs sm:text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
									>
										<FiLogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
										{tr({ no: "Logg ut", en: "Sign out" })}
									</button>
								</div>
							)}
							{userMenuOpen && (
								<div className="md:hidden fixed inset-x-0 top-[60px] rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50">
									<div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 border-b border-slate-100/70 dark:border-white/10 truncate">
										{userEmail ?? tr({ no: "Bruker", en: "User" })}
									</div>
									<Link
										href="/user"
										className="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
										onClick={() => setUserMenuOpen(false)}
									>
										<FiUser className="h-4 w-4" />
										{tr({ no: "Vis profil", en: "View profile" })}
									</Link>
									<button
										type="button"
										onClick={signOut}
										className="flex w-full items-center gap-2 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
									>
										<FiLogOut className="h-4 w-4" />
										{tr({ no: "Logg ut", en: "Sign out" })}
									</button>
								</div>
							)}
						</div>
					) : (
						<Link
							href="/signin"
							className="inline-flex h-[34px] sm:h-[32px] items-center justify-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-4 sm:px-4 text-[12px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
						>
							{tr({ no: "Logg inn", en: "Sign in" })}
						</Link>
					)}
					<div className="hidden lg:inline-flex items-center h-[34px] sm:h-[32px] gap-2 px-3 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 shadow-sm dark:shadow-black/25">
						<LocalePill />
						<div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
						<ThemePill />
					</div>
					<div className="relative lg:hidden" ref={settingsMenuRef}>
						<button
							type="button"
							onClick={() => setSettingsMenuOpen((v) => !v)}
							className="inline-flex h-[34px] sm:h-[32px] items-center justify-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-4 text-[12px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
							aria-label={tr({ no: "Innstillinger", en: "Settings" })}
							title={tr({ no: "Innstillinger", en: "Settings" })}
						>
							<FiSettings className="h-4 w-4 sm:h-4 sm:w-4" />
						</button>
						{settingsMenuOpen && (
							<div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50 p-2 hidden md:block">
								<div className="flex items-center justify-between px-2 py-1.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
									{tr({ no: "Språk", en: "Language" })}
									<LocalePill />
								</div>
								<div className="flex items-center justify-between px-2 py-1.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
									{tr({ no: "Tema", en: "Theme" })}
									<ThemePill />
								</div>
							</div>
						)}
						{settingsMenuOpen && (
							<div className="md:hidden fixed inset-x-0 top-[60px] rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50 p-3">
								<div className="flex items-center justify-between px-2 py-2 text-sm text-slate-500 dark:text-slate-400">
									{tr({ no: "Språk", en: "Language" })}
									<LocalePill />
								</div>
								<div className="flex items-center justify-between px-2 py-2 text-sm text-slate-500 dark:text-slate-400">
									{tr({ no: "Tema", en: "Theme" })}
									<ThemePill />
								</div>
							</div>
						)}
					</div>
					<div className="relative" ref={mobileMenuRef}>
						<button
							type="button"
							onClick={() => setMobileMenuOpen((v) => !v)}
							className="md:hidden inline-flex h-[34px] sm:h-[32px] items-center justify-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-4 text-[12px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
							aria-label={tr({ no: "Meny", en: "Menu" })}
							title={tr({ no: "Meny", en: "Menu" })}
						>
							<FiMenu className="h-4 w-4 sm:h-4 sm:w-4" />
						</button>
						{mobileMenuOpen && (
							<div className="md:hidden fixed inset-x-0 top-[60px] rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50">
								<Link
									href="/"
									className="block px-4 py-3 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:text-slate-900 dark:hover:text-white"
									onClick={() => setMobileMenuOpen(false)}
								>
									{tr({ no: "Hjem", en: "Home" })}
								</Link>
								<Link
									href="/csvgenerator"
									className="block px-4 py-3 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:text-slate-900 dark:hover:text-white"
									onClick={() => setMobileMenuOpen(false)}
								>
									{tr({ no: "Lommebok Skanner", en: "Wallet Scanner" })}
								</Link>
								<Link
									href="/pricing"
									className="block px-4 py-3 text-sm text-slate-700 dark:text-slate-200 transition-colors hover:text-slate-900 dark:hover:text-white"
									onClick={() => setMobileMenuOpen(false)}
								>
									{tr({ no: "Priser", en: "Pricing" })}
								</Link>
							</div>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
