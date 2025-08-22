/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: "class", // class-based dark mode
	content: [
		"./src/app/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/components/**/*.{js,ts,jsx,tsx,mdx}",
		"./src/pages/**/*.{js,ts,jsx,tsx,mdx}"
	],
	theme: {
		extend: {
			fontFamily: {
				sans: [
					"var(--font-inter)",
					"ui-sans-serif",
					"system-ui",
					"Segoe UI",
					"Roboto",
					"Arial",
					"sans-serif"
				]
			}
		}
	}
};
