export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function safeImageUrl(value) {
  const image = String(value || "").trim();
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(image)) {
    return image;
  }

  try {
    const url = new URL(image, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin
      ? url.href
      : "";
  } catch (error) {
    return "";
  }
}

export function normalizeDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}
