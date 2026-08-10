#!/usr/bin/env node
/**
 * Optional Python CLI installer hook.
 *
 * The research feed now uses arXiv and PubMed only, both of which rely on
 * direct HTTP APIs and do not require extra Python CLIs at install time.
 */

console.log("[postinstall] No optional research-news Python CLIs are required.");
