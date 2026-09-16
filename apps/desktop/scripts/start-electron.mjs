#!/usr/bin/env node
/** Runs the built shell against the built server + SPA, without packaging. */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const electronBin = path.resolve(here, "..", "node_modules", ".bin", "electron");
const entry = path.resolve(here, "..", "dist-electron", "main.cjs");

const child = spawn(electronBin, [entry], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
