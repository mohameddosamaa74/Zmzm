const ADMIN_AUTH_DOMAIN = import.meta.env?.VITE_ADMIN_AUTH_DOMAIN?.trim().toLowerCase() || "";
const USERNAME_PATTERN = /^[a-z0-9._-]{1,64}$/i;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function usernameToAuthEmail(username, domain = ADMIN_AUTH_DOMAIN) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedDomain = String(domain || "").trim().toLowerCase();

  if (normalizedUsername.includes("@")) {
    const [emailUsername, emailDomain, ...extraParts] = normalizedUsername.split("@");
    if (
      !emailUsername ||
      !DOMAIN_PATTERN.test(emailDomain || "") ||
      extraParts.length > 0
    ) {
      throw new Error("اكتب اسم مستخدم أو بريدًا إلكترونيًا صالحًا.");
    }
    return normalizedUsername;
  }

  if (!DOMAIN_PATTERN.test(normalizedDomain)) {
    throw new Error("إعداد نطاق أسماء المستخدمين غير موجود أو غير صالح.");
  }

  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    throw new Error("اكتب اسم مستخدم صالحاً بدون مسافات أو علامة @.");
  }

  return `${normalizedUsername}@${normalizedDomain}`;
}
