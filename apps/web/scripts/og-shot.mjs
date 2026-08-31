import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file://" + path.join(dir, "og-image.html"));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(dir, "..", "public", "og-image.png") });
await browser.close();
