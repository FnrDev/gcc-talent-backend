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

function deliveryError(deliveryUnconfirmed = true) {
  const error = emailError(
    "EMAIL_DELIVERY_FAILED",
    deliveryUnconfirmed
      ? "Unable to confirm verification email delivery. Please try again later."
      : "Unable to send the verification email. Please try again later."
  );
  error.deliveryUnconfirmed = deliveryUnconfirmed;
  return error;
}

function isEmailAddress(value) {
  return typeof value === "string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function validateSender(apiKey, from) {
  if (typeof apiKey !== "string" || !/^re_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw configurationError("A valid RESEND_API_KEY is required for email verification.");
  }

  const senderMatch = typeof from === "string" && from.match(/^[^<>]+<([^<>]+)>$/);
  const senderAddress = senderMatch ? senderMatch[1].trim() : from;
  if (
    typeof from !== "string" ||
    /[\u0000-\u001f\u007f]/.test(from) ||
    !isEmailAddress(senderAddress)
  ) {
    throw configurationError("A valid RESEND_FROM_EMAIL is required for email verification.");
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

function parseEmailUrl(value) {
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
      "API_BASE_URL must be an HTTP or HTTPS URL without credentials, a query, or a fragment."
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    (url.protocol !== "https:" || isLoopbackHostname(url.hostname))
  ) {
    throw configurationError("API_BASE_URL must use a public HTTPS host in production.");
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

async function sendVerificationEmail({ user, token, configuration } = {}) {
  const emailConfiguration = configuration || getEmailConfiguration();
  validateSender(emailConfiguration.apiKey, emailConfiguration.from);
  const verificationUrl = parseEmailUrl(emailConfiguration.verificationUrl);
  let deliveryAttempted = false;

  try {
    if (!user || !user._id || !isEmailAddress(user.email) || typeof token !== "string" || !token) {
      throw deliveryError(false);
    }

    verificationUrl.searchParams.set("token", token);
    const link = verificationUrl.toString();
    const name = typeof user.name === "string" && user.name.trim() ? user.name.trim() : "there";
    const escapedName = escapeHtml(name);
    const escapedLink = escapeHtml(link);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const requestHash = createHash("sha256")
      .update(String(user._id))
      .update(":")
      .update(tokenHash)
      .digest("hex");

    deliveryAttempted = true;
    const response = await axios.post(
      RESEND_EMAIL_URL,
      {
        from: emailConfiguration.from,
        to: [user.email],
        subject: "Verify your email for GCC Talent",
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
      },
      {
        timeout: EMAIL_REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          Authorization: `Bearer ${emailConfiguration.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `verify-email/${requestHash}`,
        },
      }
    );

    if (!response || !response.data || typeof response.data.id !== "string" || !response.data.id.trim()) {
      throw deliveryError(true);
    }

    return { id: response.data.id };
  } catch (error) {
    // Axios errors can contain request headers, the recipient, and the verification link.
    const status = error?.response?.status;
    const confirmedRejection =
      Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 409;
    // An accepted request may time out or lose its response; its link must stay valid.
    throw deliveryError(deliveryAttempted && !confirmedRejection);
  }
}

module.exports = { getEmailConfiguration, sendVerificationEmail };
