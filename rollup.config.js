import typescript from 'rollup-plugin-typescript2';
import {dts} from 'rollup-plugin-dts';

export default [
	// JavaScript Bundling
	{
		input: 'src/index.ts', // Entry point of your library
		output: [
			{
				file: 'dist/index.cjs.js', // Output file
				format: 'cjs', // CommonJS
				sourcemap: true, // Optional: Include source maps
			},
			{
				file: 'dist/index.esm.js', // ES module output
				format: 'es',
				sourcemap: true,
			},
		],
		plugins: [
			typescript({
				tsconfig: './tsconfig.json',
			}),
		],
	},
	// Type Declarations Bundling
	{
		input: './src/index.ts', // Entry point for types
		output: {
			file: './types/index.d.ts', // Combined type output
			format: 'es',
		},
		plugins: [dts()],
	},
];
