import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createTransferServer } from "../server.js";

let directory;
let server;
let baseUrl;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "nearby-transfer-"));
  server = createTransferServer({ directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test("serves the app and reports a port for the local address", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Files, meet/);
  const info = await fetch(`${baseUrl}/api/info`).then((response) => response.json());
  assert.equal(info.port, server.address().port);
  assert.ok(Array.isArray(info.addresses));
});

test("receives files, lists them, and downloads the original bytes", async () => {
  const bytes = Buffer.from([0, 1, 2, 255, 13, 10]);
  const upload = await fetch(`${baseUrl}/api/files/${encodeURIComponent("tablet photo.bin")}`, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assert.equal(upload.status, 201);
  const file = (await upload.json()).file;
  assert.equal(file.name, "tablet photo.bin");
  assert.equal(file.size, bytes.length);

  const listing = await fetch(`${baseUrl}/api/files`).then((response) => response.json());
  assert.equal(listing.files.length, 1);
  assert.equal(listing.files[0].name, file.name);
  const download = await fetch(`${baseUrl}/api/files/${encodeURIComponent(file.name)}`);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.match(download.headers.get("content-disposition"), /filename\*=UTF-8''tablet%20photo.bin/);
});

test("keeps duplicate names and traversal-style names safe", async () => {
  const first = await fetch(`${baseUrl}/api/files/report.txt`, { method: "PUT", body: "first" });
  const second = await fetch(`${baseUrl}/api/files/report.txt`, { method: "PUT", body: "second" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await second.json()).file.name, "report (1).txt");

  const traversal = await fetch(`${baseUrl}/api/files/${encodeURIComponent("..\\outside.txt")}`, {
    method: "PUT",
    body: "no",
  });
  assert.equal(traversal.status, 400);
});

test("deletes a transferred file and returns not found afterward", async () => {
  await fetch(`${baseUrl}/api/files/remove-me.txt`, { method: "PUT", body: "temporary" });
  const deletion = await fetch(`${baseUrl}/api/files/remove-me.txt`, { method: "DELETE" });
  assert.equal(deletion.status, 200);
  assert.equal((await deletion.json()).deleted, "remove-me.txt");
  const missing = await fetch(`${baseUrl}/api/files/remove-me.txt`);
  assert.equal(missing.status, 404);
  await assert.rejects(readFile(path.join(directory, "remove-me.txt")));
});
