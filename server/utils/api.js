// src/utils/api.js
const getBaseUrl = () => {
  if (import.meta.env.PROD) {
    return "";
  }
  return import.meta.env.VITE_API_URL || "http://localhost:4000";
};

const BASE = getBaseUrl();

function getToken() {
  return localStorage.getItem("safari_token");
}

async function request(method, path, body = null, isFormData = false) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const url = `${BASE}/api${path}`;
  const res = await fetch(url, opts);

  if (res.status === 401) {
    localStorage.removeItem("safari_token");
    window.location.href = "/login";
    throw new Error("Session expirée");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  patch: (path, body) => request("PATCH", path, body),
  delete: (path) => request("DELETE", path),
  upload: (path, form) => request("POST", path, form, true),
};
