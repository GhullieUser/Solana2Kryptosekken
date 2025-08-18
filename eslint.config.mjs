// eslint.config.ts
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

const eslintConfig = [
	// Next defaults
	...compat.extends("next/core-web-vitals", "next/typescript"),

	// --- Overrides: turn off `any` (and friends) ---
	{
		files: ["**/*.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-empty-object-type": "off",
		},
	},
];

export default eslintConfig;
