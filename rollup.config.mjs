import commonjs from '@rollup/plugin-commonjs';
import resolve from "@rollup/plugin-node-resolve";
import terser from '@rollup/plugin-terser';
import livereload from "rollup-plugin-livereload";
import serve from "rollup-plugin-serve";

const production = process.env.BUILD === 'production';

export default {
  input: "app.mjs",
  output: {
    dir: "docs",
    format: "iife",
    sourcemap: !production,
  },
  plugins: [
    commonjs(),
    resolve(),
    !production && serve(),
    !production && livereload(),
    production && terser(),
  ]
};
