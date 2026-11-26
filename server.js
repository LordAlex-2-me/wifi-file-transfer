import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(root, "public");
const defaultPort = 8787;

function safeFilename(value) {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.length > 255 ||
    /[\\/:<>:"|?*\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value)
  ) {
    return null;
  }
  return value;
}

function getLanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createTransferServer({ directory = path.join(root, "transfers") } = {}) {
  const transferDirectory = path.resolve(directory);

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/api/info") {
      return json(response, 200, { port: server.address()?.port ?? defaultPort, addresses: getLanAddresses() });
    }

    if (request.method === "GET" && pathname === "/api/files") {
      try {
        const files = await Promise.all(
          (await readdir(transferDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
              const details = await stat(path.join(transferDirectory, entry.name));
              return { name: entry.name, size: details.size, modified: details.mtime.toISOString() };
            }),
        );
        files.sort((left, right) => right.modified.localeCompare(left.modified));
        return json(response, 200, { files });
      } catch (error) {
        if (error.code === "ENOENT") return json(response, 200, { files: [] });
        console.error("Could not list transferred files:", error);
        return json(response, 500, { error: "Could not load the file list." });
      }
    }

    const fileRoute = pathname.match(/^\/api\/files\/(.+)$/);
    if (fileRoute && ["PUT", "GET", "DELETE"].includes(request.method)) {
      let requestedName;
      try {
        requestedName = decodeURIComponent(fileRoute[1]);
      } catch {
        return json(response, 400, { error: "Invalid filename." });
      }
      const filename = safeFilename(requestedName);
      if (!filename) return json(response, 400, { error: "That filename is not supported." });

      if (request.method === "PUT") {
        await mkdir(transferDirectory, { recursive: true });
        let destination = path.join(transferDirectory, filename);
        let index = 1;
        const extension = path.extname(filename);
        const stem = extension ? filename.slice(0, -extension.length) : filename;
        while (true) {
          try {
            await stat(destination);
            destination = path.join(transferDirectory, `${stem} (${index++})${extension}`);
          } catch (error) {
            if (error.code === "ENOENT") break;
            console.error("Could not prepare file upload:", error);
            return json(response, 500, { error: "Could not prepare the upload." });
          }
        }

        try {
          await pipeline(request, createWriteStream(destination, { flags: "wx" }));
          const details = await stat(destination);
          return json(response, 201, {
            file: { name: path.basename(destination), size: details.size, modified: details.mtime.toISOString() },
          });
        } catch (error) {
          await rm(destination, { force: true }).catch(() => {});
          if (!response.headersSent) {
            if (error.code === "EEXIST") return json(response, 409, { error: "A file with that name already exists." });
            console.error("Could not save uploaded file:", error);
            return json(response, 500, { error: "The upload could not be saved." });
          }
          response.destroy(error);
          return;
        }
      }

      const filePath = path.join(transferDirectory, filename);
      if (request.method === "DELETE") {
        try {
          await rm(filePath);
          return json(response, 200, { deleted: filename });
        } catch (error) {
          if (error.code === "ENOENT") return json(response, 404, { error: "File not found." });
          console.error("Could not delete transferred file:", error);
          return json(response, 500, { error: "Could not delete the file." });
        }
      }

      try {
        const details = await stat(filePath);
        if (!details.isFile()) return json(response, 404, { error: "File not found." });
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": details.size,
          "Content-Disposition": contentDisposition(filename),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        });
        return await pipeline(createReadStream(filePath), response);
      } catch (error) {
        if (error.code === "ENOENT") return json(response, 404, { error: "File not found." });
        console.error("Could not download transferred file:", error);
        if (!response.headersSent) return json(response, 500, { error: "Could not download the file." });
        response.destroy(error);
        return;
      }
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = path.resolve(publicDirectory, relativePath);
      if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
        return json(response, 404, { error: "Not found." });
      }
      try {
        const details = await stat(filePath);
        if (!details.isFile()) return json(response, 404, { error: "Not found." });
        const contentTypes = {
          ".css": "text/css; charset=utf-8",
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
        };
        response.writeHead(200, {
          "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
          "Content-Length": details.size,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
          "Referrer-Policy": "no-referrer",
        });
        if (request.method === "HEAD") return response.end();
        return await pipeline(createReadStream(filePath), response);
      } catch (error) {
        if (error.code === "ENOENT") return json(response, 404, { error: "Not found." });
        console.error("Could not serve app file:", error);
        if (!response.headersSent) return json(response, 500, { error: "Could not load the app." });
        response.destroy(error);
      }
    }

    return json(response, 404, { error: "Not found." });
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? defaultPort);
  const transferDirectory = path.resolve(process.env.TRANSFER_DIR ?? path.join(root, "transfers"));
  const server = createTransferServer({ directory: transferDirectory });
  server.listen(port, "0.0.0.0", () => {
    const address = server.address();
    console.log(`Wi-Fi File Transfer is running on port ${address.port}`);
    console.log(`Saving received files to: ${transferDirectory}`);
    for (const ip of getLanAddresses()) console.log(`  http://${ip}:${address.port}`);
    if (getLanAddresses().length === 0) console.log("  No local IPv4 network address found; connect to Wi-Fi to reach this device.");
  });
}
