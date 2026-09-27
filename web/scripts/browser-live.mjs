import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve(".."),
  dist = resolve(root, "dist"),
  evidence = resolve(root, "docs/evidence");
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/")) throw Error();
    path = path.slice(9) || "index.html";
    if (path.includes("..")) throw Error();
    const bytes = await readFile(resolve(dist, path));
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const report = {
  date: new Date().toISOString(),
  mocked: false,
  transactionsBroadcast: 0,
  consoleErrors: [],
  failedRequests: [],
};
page.on("pageerror", (e) => report.consoleErrors.push(e.message));
page.on("requestfailed", (r) =>
  report.failedRequests.push({ url: r.url(), failure: r.failure() }),
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.getByText(/Read at block/).waitFor({ timeout: 55000 });
  await page.getByText("No fee splits yet.").waitFor({ timeout: 20000 });
  report.result = "pass";
  report.block = await page.locator(".read-status").innerText();
  report.price = await page.locator(".pool-line").innerText();
  await page.screenshot({
    path: resolve(evidence, "live-desktop.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 80,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(evidence, "live-mobile.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 80,
  });
} catch (e) {
  report.result = "unavailable";
  report.error = e.message;
  report.visibleStatus = await page.locator("body").innerText();
  await page.screenshot({
    path: resolve(evidence, "live-unavailable.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 70,
  });
} finally {
  await writeFile(
    resolve(evidence, "live-browser.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
  await browser.close();
  await new Promise((done) => server.close(done));
}
