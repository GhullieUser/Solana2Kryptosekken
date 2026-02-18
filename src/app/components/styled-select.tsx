"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";

export type StyledSelectOption<T extends string> = {
	value: T;
	label: string;
	disabled?: boolean;
};

export default function StyledSelect<T extends string>({
	value,
	onChange,
	options,
	disabled,
	buttonClassName,
	menuClassName,
	optionClassName,
	align = "left",
	ariaLabel,
	usePortal = false,
	portalZIndex = 100000,
	placement = "auto",
	minWidthLabel,
	labelClassName
}: {
	value: T;
	onChange: (next: T) => void;
	options: readonly StyledSelectOption<T>[];
	disabled?: boolean;
	buttonClassName: string;
	menuClassName?: string;
	optionClassName?: string;
	align?: "left" | "right";
	ariaLabel?: string;
	usePortal?: boolean;
	portalZIndex?: number;
	placement?: "auto" | "bottom" | "top";
	/** If provided, forces the button to be at least wide enough to display this label. */
	minWidthLabel?: string;
	/** Customize label span styling (defaults to truncate). */
	labelClassName?: string;
}) {
	const id = useId();
	const listboxId = `${id}-listbox`;
	const rootRef = useRef<HTMLDivElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);
	const [menuPos, setMenuPos] = useState<
		| {
				top: number;
				left: number;
				width: number;
				openUp: boolean;
		  }
		| undefined
	>(undefined);

	const selected = useMemo(
		() => options.find((o) => o.value === value),
		[options, value]
	);

	useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			const t = e.target as Node;
			const inButton = rootRef.current?.contains(t);
			const inMenu = menuRef.current?.contains(t);
			if (!inButton && !inMenu) setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	useEffect(() => {
		if (!open || !usePortal) return;
		function compute() {
			const r = buttonRef.current?.getBoundingClientRect();
			if (!r) return;
			const SPACE_GUESS = 220;
			const spaceBelow = window.innerHeight - r.bottom;
			const spaceAbove = r.top;
			const openUp =
				placement === "top"
					? true
					: placement === "bottom"
						? false
						: spaceBelow < SPACE_GUESS && spaceAbove > spaceBelow;

			const width = Math.max(160, Math.floor(r.width));
			const left =
				align === "right"
					? Math.max(8, Math.floor(r.right - width))
					: Math.max(8, Math.floor(r.left));
			const top = openUp ? Math.floor(r.top - 8) : Math.floor(r.bottom + 8);
			setMenuPos({ top, left, width, openUp });
		}
		compute();
		const onScroll = () => compute();
		const onResize = () => compute();
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open, usePortal, align, placement]);

	return (
		<div ref={rootRef} className="relative">
			<button
				ref={buttonRef}
				type="button"
				disabled={disabled}
				className={buttonClassName}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listboxId}
				aria-label={ariaLabel}
				onClick={() => setOpen((v) => !v)}
			>
				{minWidthLabel ? (
					<span className="relative min-w-0 flex-1">
						<span aria-hidden className="invisible whitespace-nowrap">
							{minWidthLabel}
						</span>
						<span
							className={[
								"absolute inset-0",
								labelClassName ?? "truncate"
							].join(" ")}
						>
							{selected?.label ?? value}
						</span>
					</span>
				) : (
					<span className={labelClassName ?? "truncate"}>
						{selected?.label ?? value}
					</span>
				)}
				<FiChevronDown className="h-4 w-4 shrink-0 opacity-70" />
			</button>

			{open
				? (() => {
						const menuNode = (
							<div
								ref={menuRef}
								id={listboxId}
								role="listbox"
								style={
									usePortal
										? {
												position: "fixed",
												top: menuPos?.top,
												left: menuPos?.left,
												width: menuPos?.width,
												transform: menuPos?.openUp
													? "translateY(-100%)"
													: undefined,
												zIndex: portalZIndex
											}
										: undefined
								}
								className={[
									"overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl",
									"dark:border-white/10 dark:bg-[#1f2937]",
									usePortal
										? ""
										: [
												"absolute z-[10000] mt-2 min-w-full",
												align === "right" ? "right-0" : "left-0"
											].join(" "),
									menuClassName ?? ""
								].join(" ")}
							>
								{options.map((o) => {
									const isSelected = o.value === value;
									return (
										<button
											key={o.value}
											type="button"
											role="option"
											aria-selected={isSelected}
											disabled={o.disabled}
											onClick={() => {
												if (o.disabled) return;
												onChange(o.value);
												setOpen(false);
											}}
											className={[
												"w-full text-left px-3 py-2 text-sm",
												isSelected
													? "bg-indigo-100 text-indigo-950 font-medium hover:bg-indigo-200 active:bg-indigo-300 dark:bg-indigo-500/25 dark:text-indigo-200 dark:hover:bg-indigo-500/35 dark:active:bg-indigo-500/45"
													: "text-slate-700 dark:text-slate-100",
												o.disabled
													? "opacity-50 cursor-not-allowed"
													: "hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-white/10 dark:active:bg-white/15",
												optionClassName ?? ""
											].join(" ")}
										>
											{o.label}
										</button>
									);
								})}
							</div>
						);

						return usePortal && typeof document !== "undefined"
							? createPortal(menuNode, document.body)
							: menuNode;
					})()
				: null}
		</div>
	);
}
