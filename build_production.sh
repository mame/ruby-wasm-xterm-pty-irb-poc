#!/bin/sh

set -ex

cp node_modules/xterm/css/xterm.css docs
cp node_modules/@ruby/head-wasm-wasi/dist/ruby+stdlib.wasm docs
npx rollup -c --environment BUILD:production
