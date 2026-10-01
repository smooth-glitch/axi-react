/**
 * Sandesh files (upload / download options): authenticated HTTP against /api/sd/files.
 * The server decides who may read a file (uploader, an administrator, or anyone a download option
 * pointing at it applies to) and enforces the size limit; the checks here only give quicker feedback.
 */
import { sandeshApi } from './sandeshApi.js';

export const MAX_UPLOAD_MB = 10; // keep in step with SANDESH_MAX_FILE_MB and nginx client_max_body_size

async function request(path, token, init = {}) {
  if (!token) throw Object.assign(new Error('Sign in to Connectum first.'), { status: 401 });
  let res;
  try {
    res = await fetch(`${sandeshApi.getBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw Object.assign(new Error('Unable to reach the Connectum server.'), { status: 503 });
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch {
      // not JSON
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res;
}

export async function uploadFile(file, token) {
  if (!file) throw new Error('Choose a file first.');
  if (file.size === 0) throw new Error('That file is empty.');
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File too large (max ${MAX_UPLOAD_MB} MB).`);
  const res = await request(`/files?name=${encodeURIComponent(file.name)}`, token, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  return (await res.json()).data.file; // { id, name, mime, size, by, ts }
}

export async function downloadFile(fileId, token) {
  const res = await request(`/files/${encodeURIComponent(fileId)}`, token);
  const blob = await res.blob();
  let name = 'download';
  try {
    name = decodeURIComponent(res.headers.get('x-file-name') || '') || name;
  } catch {
    // keep the default name
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
  return { name, size: blob.size };
}
