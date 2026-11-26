const fileList = document.querySelector("#file-list");
const fileCount = document.querySelector("#file-count");
const filePicker = document.querySelector("#file-picker");
const dropzone = document.querySelector("#dropzone");
const progressList = document.querySelector("#progress-list");
const transferStatus = document.querySelector("#transfer-status");
const addressLabel = document.querySelector("#connection-address");

const fileIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6zM14 3.5v5h4M9 13h6m-6 3h6"/></svg>`;
const downloadIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3"/></svg>`;
const trashIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4m2 0-.6 9H4.6L4 4m2.5 2v4.5m3-4.5v4.5"/></svg>`;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function loadFiles() {
  try {
    const response = await fetch("/api/files");
    if (!response.ok) throw new Error("Could not load files.");
    const { files } = await response.json();
    fileCount.textContent = files.length;
    if (files.length === 0) {
      fileList.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/></svg></span><strong>No files yet</strong><span>Files sent from either device will show up here.</span></div>`;
      return;
    }
    fileList.innerHTML = files.map((file) => {
      const name = escapeHtml(file.name);
      const encodedName = encodeURIComponent(file.name);
      const modified = new Date(file.modified).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<article class="file-row">
        <span class="file-icon">${fileIcon}</span>
        <div class="file-meta"><div class="file-name" title="${name}">${name}</div><div class="file-details">${formatSize(file.size)} · ${modified}</div></div>
        <a class="file-action download-action" href="/api/files/${encodedName}" download="${name}">${downloadIcon} Download</a>
        <button class="file-action delete-action" type="button" data-delete="${encodedName}" aria-label="Delete ${name}" title="Delete">${trashIcon}</button>
      </article>`;
    }).join("");
  } catch (error) {
    fileList.innerHTML = `<div class="empty-state error-message">${escapeHtml(error.message)}</div>`;
  }
}

async function showAddress() {
  try {
    const response = await fetch("/api/info");
    if (!response.ok) throw new Error();
    const { port, addresses } = await response.json();
    const currentHost = window.location.hostname;
    const address = addresses.includes(currentHost) ? `http://${currentHost}:${port}` : `http://${addresses[0] ?? currentHost}:${port}`;
    addressLabel.textContent = address;
    document.querySelector("#copy-address").dataset.address = address;
  } catch {
    addressLabel.textContent = "Could not find this device’s local address";
  }
}

function uploadFile(file) {
  const row = document.createElement("div");
  row.className = "progress-item";
  row.innerHTML = `<span class="progress-name"></span><span class="progress-detail">Starting…</span><div class="progress-track"><progress max="100" value="0" aria-label="Upload progress"></progress></div>`;
  row.querySelector(".progress-name").textContent = file.name;
  progressList.prepend(row);
  const detail = row.querySelector(".progress-detail");
  const bar = row.querySelector(".progress-track progress");
  const request = new XMLHttpRequest();
  request.open("PUT", `/api/files/${encodeURIComponent(file.name)}`);
  request.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percentage = Math.round((event.loaded / event.total) * 100);
    bar.value = percentage;
    detail.textContent = `${percentage}% · ${formatSize(event.loaded)} of ${formatSize(event.total)}`;
  };
  request.onload = () => {
    let response;
    try { response = JSON.parse(request.responseText); } catch { response = {}; }
    if (request.status >= 200 && request.status < 300) {
      detail.textContent = "Sent";
      bar.value = 100;
      transferStatus.textContent = `Received ${response.file?.name ?? file.name}`;
      transferStatus.classList.remove("error-message");
      loadFiles();
      window.setTimeout(() => row.remove(), 2200);
    } else {
      detail.textContent = response.error ?? "Upload failed";
      detail.classList.add("error-message");
      transferStatus.textContent = response.error ?? `Could not send ${file.name}.`;
      transferStatus.classList.add("error-message");
    }
  };
  request.onerror = () => {
    detail.textContent = "Connection lost";
    detail.classList.add("error-message");
    transferStatus.textContent = `Could not send ${file.name}. Check that both devices are still connected to Wi-Fi.`;
    transferStatus.classList.add("error-message");
  };
  request.send(file);
}

function sendFiles(files) {
  if (!files.length) return;
  transferStatus.textContent = `Sending ${files.length} file${files.length === 1 ? "" : "s"}…`;
  transferStatus.classList.remove("error-message");
  for (const file of files) uploadFile(file);
}

dropzone.addEventListener("click", (event) => {
  if (event.target !== filePicker) filePicker.click();
});
filePicker.addEventListener("change", () => {
  sendFiles([...filePicker.files]);
  filePicker.value = "";
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});
dropzone.addEventListener("dragleave", (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-dragging");
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  sendFiles([...event.dataTransfer.files]);
});
document.querySelector("#copy-address").addEventListener("click", async (event) => {
  const address = event.currentTarget.dataset.address;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    event.currentTarget.textContent = "Copied";
    window.setTimeout(() => { event.currentTarget.textContent = "Copy"; }, 1400);
  } catch {
    transferStatus.textContent = `Copy this address: ${address}`;
  }
});
document.querySelector("#refresh-files").addEventListener("click", loadFiles);
fileList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/files/${button.dataset.delete}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not delete file.");
    transferStatus.textContent = `Deleted ${result.deleted}`;
    transferStatus.classList.remove("error-message");
    loadFiles();
  } catch (error) {
    transferStatus.textContent = error.message;
    transferStatus.classList.add("error-message");
    button.disabled = false;
  }
});

showAddress();
loadFiles();
window.setInterval(loadFiles, 10000);
