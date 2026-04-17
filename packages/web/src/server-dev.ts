export {};

process.env.PMEOW_WEB_DEBUG_REPORTS = process.env.PMEOW_WEB_DEBUG_REPORTS ?? "1";

await import("./server.js");