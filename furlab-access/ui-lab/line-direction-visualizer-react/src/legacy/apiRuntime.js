function buildApiBases(hostname) {
  const out = [];
  const push = (u) => {
    const s = String(u || "").replace(/\/+$/, "");
    if (!s) {
      if (!out.includes("")) out.push("");
      return;
    }
    if (!out.includes(s)) out.push(s);
  };
  push(`http://${String(hostname || "localhost")}:5500`);
  push("http://127.0.0.1:5500");
  push(`http://${String(hostname || "localhost")}:5501`);
  push("http://127.0.0.1:5501");
  push("");
  return out;
}

export function createLegacyApiFetch({ getHostname, fetchImpl }) {
  let apiBase = "";

  return async function apiFetch(path, options) {
    // Reuse previously discovered API base to avoid probing every request.
    if (apiBase) {
      const res = await fetchImpl(`${apiBase}${path}`, options);
      return { res, base: apiBase };
    }

    let lastErr = null;
    const bases = buildApiBases(getHostname());
    for (const base of bases) {
      try {
        const res = await fetchImpl(`${base}${path}`, options);
        // Pin only when endpoint looks like API JSON response.
        const ct = String(res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json") && (res.ok || res.status === 400 || res.status === 409)) {
          apiBase = base;
        }
        return { res, base };
      } catch (e) {
        lastErr = e;
      }
    }
    throw (lastErr || new Error("api_unreachable"));
  };
}
