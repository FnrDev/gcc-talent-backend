const axios = require("axios");
const { createHash } = require("crypto");

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const EMAIL_REQUEST_TIMEOUT_MS = 10_000;

function emailError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function configurationError(message) {
  return emailError("EMAIL_CONFIGURATION_ERROR", message);
}

function deliveryError(deliveryUnconfirmed = true, purpose = "verification") {
  const error = emailError(
    "EMAIL_DELIVERY_FAILED",
    deliveryUnconfirmed
      ? `Unable to confirm ${purpose} email delivery. Please try again later.`
      : `Unable to send the ${purpose} email. Please try again later.`
  );
  error.deliveryUnconfirmed = deliveryUnconfirmed;
  return error;
}

function isEmailAddress(value) {
  return typeof value === "string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function validateSender(apiKey, from, purpose = "email verification") {
  if (typeof apiKey !== "string" || !/^re_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw configurationError(`A valid RESEND_API_KEY is required for ${purpose}.`);
  }

  const senderMatch = typeof from === "string" && from.match(/^[^<>]+<([^<>]+)>$/);
  const senderAddress = senderMatch ? senderMatch[1].trim() : from;
  if (
    typeof from !== "string" ||
    /[\u0000-\u001f\u007f]/.test(from) ||
    !isEmailAddress(senderAddress)
  ) {
    throw configurationError(`A valid RESEND_FROM_EMAIL is required for ${purpose}.`);
  }
}

function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "localhost.localdomain" ||
    host.startsWith("127.") ||
    host === "0.0.0.0" ||
    host === "[::]" ||
    host === "[::1]" ||
    /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/.test(host)
  );
}

function parseEmailUrl(value, configurationName = "API_BASE_URL") {
  let url;
  try {
    if (
      typeof value !== "string" ||
      !/^https?:\/\//i.test(value) ||
      /[\u0000-\u0020\u007f?#]/.test(value)
    ) {
      throw new Error();
    }

    url = new URL(value);
    const authority = value.split("/")[2];
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      authority.includes("@") ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    throw configurationError(
      `${configurationName} must be an HTTP or HTTPS URL without credentials, a query, or a fragment.`
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    (url.protocol !== "https:" || isLoopbackHostname(url.hostname))
  ) {
    throw configurationError(`${configurationName} must use a public HTTPS host in production.`);
  }

  return url;
}

function getEmailConfiguration() {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.RESEND_FROM_EMAIL || "").trim();
  validateSender(apiKey, from);

  let baseUrl = (process.env.API_BASE_URL || "").trim();
  if (!baseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw configurationError("API_BASE_URL is required for email verification in production.");
    }
    baseUrl = `http://localhost:${process.env.PORT || 3000}`;
  }

  const verificationUrl = parseEmailUrl(baseUrl);
  verificationUrl.pathname = `${verificationUrl.pathname.replace(/\/+$/, "")}/auth/verify-email`;

  return { apiKey, from, verificationUrl: verificationUrl.toString() };
}

function getPasswordResetConfiguration() {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.RESEND_FROM_EMAIL || "").trim();
  validateSender(apiKey, from, "password reset");

  let baseUrl = (process.env.CLIENT_URL || "").trim();
  if (!baseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw configurationError("CLIENT_URL is required for password reset in production.");
    }
    baseUrl = "http://localhost:5173";
  }

  const passwordResetUrl = parseEmailUrl(baseUrl, "CLIENT_URL");
  const signInUrl = new URL(passwordResetUrl);
  const basePath = passwordResetUrl.pathname.replace(/\/+$/, "");
  passwordResetUrl.pathname = `${basePath}/reset-password`;
  signInUrl.pathname = `${basePath}/sign-in`;

  return {
    apiKey,
    from,
    passwordResetUrl: passwordResetUrl.toString(),
    signInUrl: signInUrl.toString(),
  };
}

function getServiceOrderEmailConfiguration() {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.RESEND_FROM_EMAIL || "").trim();
  validateSender(apiKey, from, "service order notifications");

  let baseUrl = (process.env.CLIENT_URL || "").trim();
  if (!baseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw configurationError("CLIENT_URL is required for service order notifications in production.");
    }
    baseUrl = "http://localhost:5173";
  }

  const contractBaseUrl = parseEmailUrl(baseUrl, "CLIENT_URL");
  const basePath = contractBaseUrl.pathname.replace(/\/+$/, "");
  contractBaseUrl.pathname = `${basePath}/contracts/`;

  return {
    apiKey,
    from,
    contractBaseUrl: contractBaseUrl.toString(),
  };
}

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}

function getDisplayName(user) {
  return typeof user.name === "string" && user.name.trim() ? user.name.trim() : "there";
}

function normalizeEmailText(value, fallback = "", maximumLength = 240) {
  if (typeof value !== "string") return fallback;

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : fallback;
}

function getTokenIdempotencyKey(user, token, namespace) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const requestHash = createHash("sha256")
    .update(String(user._id))
    .update(":")
    .update(tokenHash)
    .digest("hex");
  return `${namespace}/${requestHash}`;
}

async function sendEmail({ user, configuration, purpose = "verification", createMessage }) {
  let deliveryAttempted = false;

  try {
    if (!user || !user._id || !isEmailAddress(user.email)) {
      throw deliveryError(false, purpose);
    }

    const { subject, html, text, idempotencyKey } = createMessage();

    deliveryAttempted = true;
    const response = await axios.post(
      RESEND_EMAIL_URL,
      {
        from: configuration.from,
        to: [user.email],
        subject,
        html,
        text,
      },
      {
        timeout: EMAIL_REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          Authorization: `Bearer ${configuration.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
      }
    );

    if (!response || !response.data || typeof response.data.id !== "string" || !response.data.id.trim()) {
      throw deliveryError(true, purpose);
    }

    return { id: response.data.id };
  } catch (error) {
    // Axios errors can contain request headers, the recipient, and private email links.
    const status = error?.response?.status;
    const confirmedRejection =
      Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 409;
    // An accepted request may time out or lose its response; its link must stay valid.
    throw deliveryError(deliveryAttempted && !confirmedRejection, purpose);
  }
}

async function sendVerificationEmail({ user, token, configuration } = {}) {
  const emailConfiguration = configuration || getEmailConfiguration();
  validateSender(emailConfiguration.apiKey, emailConfiguration.from);
  const verificationUrl = parseEmailUrl(emailConfiguration.verificationUrl);

  return sendEmail({
    user,
    configuration: emailConfiguration,
    createMessage() {
      if (typeof token !== "string" || !token) {
        throw deliveryError(false);
      }

      verificationUrl.searchParams.set("token", token);
      const link = verificationUrl.toString();
      const name = getDisplayName(user);
      const escapedName = escapeHtml(name);
      const escapedLink = escapeHtml(link);

      return {
        subject: "Verify your email for GCC Talent",
        idempotencyKey: getTokenIdempotencyKey(user, token, "verify-email"),
        html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <main style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <h1 style="font-size:24px;margin:0 0 24px;">Welcome to GCC Talent</h1>
      <p>Hi ${escapedName},</p>
      <p>Thanks for signing up for GCC Talent. Please verify your email address using the button below.</p>
      <p style="margin:28px 0;"><a href="${escapedLink}" style="display:inline-block;padding:14px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Verify email address</a></p>
      <p>This link expires in 24 hours and can only be used once.</p>
      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p style="word-break:break-all;"><a href="${escapedLink}">${escapedLink}</a></p>
      <p>If you did not create a GCC Talent account, you can ignore this email.</p>
      <p>The GCC Talent team</p>
    </main>
  </body>
</html>`,
        text: `Hi ${name},\n\nThanks for signing up for GCC Talent. Please verify your email address:\n\n${link}\n\nThis link expires in 24 hours and can only be used once.\n\nIf you did not create a GCC Talent account, you can ignore this email.\n\nThe GCC Talent team`,
      };
    },
  });
}

async function sendPasswordResetEmail({ user, token, configuration } = {}) {
  const emailConfiguration = configuration || getPasswordResetConfiguration();
  validateSender(emailConfiguration.apiKey, emailConfiguration.from, "password reset");
  const passwordResetUrl = parseEmailUrl(emailConfiguration.passwordResetUrl, "CLIENT_URL");

  return sendEmail({
    user,
    configuration: emailConfiguration,
    purpose: "password reset",
    createMessage() {
      if (typeof token !== "string" || !token) {
        throw deliveryError(false, "password reset");
      }

      passwordResetUrl.searchParams.set("token", token);
      const link = passwordResetUrl.toString();
      const name = getDisplayName(user);
      const escapedName = escapeHtml(name);
      const escapedLink = escapeHtml(link);

      return {
        subject: "Reset your GCC Talent password",
        idempotencyKey: getTokenIdempotencyKey(user, token, "password-reset"),
        html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <main style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <h1 style="font-size:24px;margin:0 0 24px;">Reset your password</h1>
      <p>Hi ${escapedName},</p>
      <p>We received a request to reset the password for your GCC Talent account.</p>
      <p style="margin:28px 0;"><a href="${escapedLink}" style="display:inline-block;padding:14px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Reset password</a></p>
      <p>This link expires in 30 minutes and can only be used once.</p>
      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p style="word-break:break-all;"><a href="${escapedLink}">${escapedLink}</a></p>
      <p>If you did not request a password reset, you can ignore this email. Your password will remain unchanged.</p>
      <p>The GCC Talent team</p>
    </main>
  </body>
</html>`,
        text: `Hi ${name},\n\nWe received a request to reset the password for your GCC Talent account:\n\n${link}\n\nThis link expires in 30 minutes and can only be used once.\n\nIf you did not request a password reset, you can ignore this email. Your password will remain unchanged.\n\nThe GCC Talent team`,
      };
    },
  });
}

async function sendPasswordChangedEmail({ user, configuration, idempotencyKey } = {}) {
  const emailConfiguration = configuration || getPasswordResetConfiguration();
  validateSender(emailConfiguration.apiKey, emailConfiguration.from, "password change notifications");
  const signInUrl = parseEmailUrl(emailConfiguration.signInUrl, "CLIENT_URL");

  return sendEmail({
    user,
    configuration: emailConfiguration,
    purpose: "password change",
    createMessage() {
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        throw deliveryError(false, "password change");
      }

      const link = signInUrl.toString();
      const name = getDisplayName(user);
      const escapedName = escapeHtml(name);
      const escapedLink = escapeHtml(link);
      const requestHash = createHash("sha256")
        .update(String(user._id))
        .update(":")
        .update(idempotencyKey)
        .digest("hex");

      return {
        subject: "Your GCC Talent password was changed",
        idempotencyKey: `password-changed/${requestHash}`,
        html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <main style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <h1 style="font-size:24px;margin:0 0 24px;">Your password was changed</h1>
      <p>Hi ${escapedName},</p>
      <p>The password for your GCC Talent account was changed successfully. All existing sessions have been signed out.</p>
      <p>You can now sign in with your new password.</p>
      <p style="margin:28px 0;"><a href="${escapedLink}" style="display:inline-block;padding:14px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Sign in</a></p>
      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p style="word-break:break-all;"><a href="${escapedLink}">${escapedLink}</a></p>
      <p>If you did not make this change, use Forgot password on the sign-in page to secure your account immediately.</p>
      <p>The GCC Talent team</p>
    </main>
  </body>
</html>`,
        text: `Hi ${name},\n\nThe password for your GCC Talent account was changed successfully. All existing sessions have been signed out.\n\nYou can now sign in with your new password:\n\n${link}\n\nIf you did not make this change, use Forgot password on the sign-in page to secure your account immediately.\n\nThe GCC Talent team`,
      };
    },
  });
}

async function sendServiceOrderCreatedEmail({ user, client, contract, configuration } = {}) {
  const emailConfiguration = configuration || getServiceOrderEmailConfiguration();
  validateSender(emailConfiguration.apiKey, emailConfiguration.from, "service order notifications");
  const contractBaseUrl = parseEmailUrl(emailConfiguration.contractBaseUrl, "CLIENT_URL");

  return sendEmail({
    user,
    configuration: emailConfiguration,
    purpose: "service order notification",
    createMessage() {
      const contractId = contract?._id ? String(contract._id).trim() : "";
      const recipientId = user?._id ? String(user._id).trim() : "";
      const snapshot = contract?.source?.packageSnapshot;
      if (!/^[a-f\d]{24}$/i.test(contractId) || !recipientId || !snapshot) {
        throw deliveryError(false, "service order notification");
      }

      const serviceName = normalizeEmailText(snapshot.serviceName);
      const packageName = normalizeEmailText(snapshot.packageName);
      const packageTitle = normalizeEmailText(snapshot.title);
      const currency = normalizeEmailText(snapshot.currency, "", 3);
      const amount = Number(snapshot.price);
      const deliveryDays = Number(snapshot.deliveryDays);
      if (
        !serviceName ||
        !packageName ||
        !packageTitle ||
        !/^[A-Z]{3}$/.test(currency) ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isInteger(deliveryDays) ||
        deliveryDays < 1
      ) {
        throw deliveryError(false, "service order notification");
      }

      const contractUrl = new URL(encodeURIComponent(contractId), contractBaseUrl).toString();
      const recipientName = normalizeEmailText(getDisplayName(user), "there");
      const clientName = normalizeEmailText(client?.name, "A client");
      const amountLabel = `${amount.toFixed(currency === "BHD" ? 3 : 2)} ${currency}`;
      const dueDateValue = contract?.milestones?.[0]?.dueDate;
      const dueDate = dueDateValue ? new Date(dueDateValue) : null;
      const dueDateLabel = dueDate && Number.isFinite(dueDate.getTime())
        ? dueDate.toISOString().slice(0, 10)
        : null;
      const requestHash = createHash("sha256")
        .update(recipientId)
        .update(":")
        .update(contractId)
        .digest("hex");

      const escapedRecipientName = escapeHtml(recipientName);
      const escapedClientName = escapeHtml(clientName);
      const escapedServiceName = escapeHtml(serviceName);
      const escapedPackageName = escapeHtml(packageName);
      const escapedPackageTitle = escapeHtml(packageTitle);
      const escapedAmountLabel = escapeHtml(amountLabel);
      const escapedContractUrl = escapeHtml(contractUrl);
      const escapedDueDateLabel = dueDateLabel ? escapeHtml(dueDateLabel) : null;
      const dueDateHtml = escapedDueDateLabel
        ? `<li><strong>Due date:</strong> ${escapedDueDateLabel}</li>`
        : "";
      const dueDateText = dueDateLabel ? `\nDue date: ${dueDateLabel}` : "";

      return {
        subject: "You have a new service order on GCC Talent",
        idempotencyKey: `service-order-created/${requestHash}`,
        html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <main style="max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
      <h1 style="font-size:24px;margin:0 0 24px;">You have a new service order</h1>
      <p>Hi ${escapedRecipientName},</p>
      <p>${escapedClientName} ordered one of your services on GCC Talent.</p>
      <ul style="padding-left:20px;line-height:1.7;">
        <li><strong>Service:</strong> ${escapedServiceName}</li>
        <li><strong>Package:</strong> ${escapedPackageName} — ${escapedPackageTitle}</li>
        <li><strong>Order value:</strong> ${escapedAmountLabel}</li>
        <li><strong>Delivery time:</strong> ${deliveryDays} day${deliveryDays === 1 ? "" : "s"}</li>
        ${dueDateHtml}
      </ul>
      <p style="margin:28px 0;"><a href="${escapedContractUrl}" style="display:inline-block;padding:14px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Open contract workspace</a></p>
      <p>If the button does not work, copy and paste this link into your browser:</p>
      <p style="word-break:break-all;"><a href="${escapedContractUrl}">${escapedContractUrl}</a></p>
      <p>The GCC Talent team</p>
    </main>
  </body>
</html>`,
        text: `Hi ${recipientName},\n\n${clientName} ordered one of your services on GCC Talent.\n\nService: ${serviceName}\nPackage: ${packageName} — ${packageTitle}\nOrder value: ${amountLabel}\nDelivery time: ${deliveryDays} day${deliveryDays === 1 ? "" : "s"}${dueDateText}\n\nOpen the contract workspace:\n${contractUrl}\n\nThe GCC Talent team`,
      };
    },
  });
}

module.exports = {
  getEmailConfiguration,
  sendVerificationEmail,
  getPasswordResetConfiguration,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  getServiceOrderEmailConfiguration,
  sendServiceOrderCreatedEmail,
};
