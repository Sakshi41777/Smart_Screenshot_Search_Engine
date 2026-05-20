<<<<<<< HEAD
// backend_node/routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const nodemailer = require("nodemailer");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const User = require("../models/user"); // Mongoose model
const { requireDb } = require("../services/db");

// Block auth flows when MongoDB is unavailable (prevents hanging requests).
router.use(requireDb);

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "7d";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const SMTP_USER = process.env.GMAIL_SMTP_USER || process.env.SMTP_USER || "";
const SMTP_PASS = process.env.GMAIL_SMTP_PASS || process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
const EMAIL_VERIFICATION_REQUIRED =
  String(process.env.EMAIL_VERIFICATION_REQUIRED || "false").toLowerCase() ===
  "true";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const RESEND_BASE_URL = process.env.RESEND_BASE_URL || "https://api.resend.com";
const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL || "http://127.0.0.1:5001";
const GOOGLE_OAUTH_REDIRECT_URI =
  process.env.GOOGLE_OAUTH_REDIRECT_URI ||
  `${SERVER_BASE_URL.replace(/\/+$/, "")}/api/auth/google/desktop/callback`;
const GOOGLE_OAUTH_SCOPES = (
  process.env.GOOGLE_OAUTH_SCOPES ||
  "openid email profile"
)
  .split(/\s+/)
  .filter(Boolean);

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const desktopOauthSessions = new Map(); // sessionId -> state + PKCE + result
const desktopOauthStateIndex = new Map(); // oauthState -> sessionId
const DESKTOP_OAUTH_TTL_MS = 10 * 60 * 1000;

function cleanupDesktopOauthSessions() {
  const now = Date.now();
  for (const [sessionId, row] of desktopOauthSessions.entries()) {
    const createdAt = Number(row?.createdAt || 0);
    if (now - createdAt > DESKTOP_OAUTH_TTL_MS) {
      desktopOauthSessions.delete(sessionId);
      if (row?.state) desktopOauthStateIndex.delete(row.state);
    }
  }
}

function randomBase64Url(bytes = 32) {
  return crypto
    .randomBytes(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeCodeChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(String(verifier || ""))
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
const mailer =
  SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    : null;

function hasResendConfig() {
  return Boolean(RESEND_API_KEY && RESEND_FROM);
}

function hasSmtpConfig() {
  return Boolean(mailer && SMTP_FROM);
}

function resolveEmailProvider() {
  if (EMAIL_PROVIDER === "resend") return "resend";
  if (EMAIL_PROVIDER === "smtp") return "smtp";
  if (hasResendConfig()) return "resend";
  if (hasSmtpConfig()) return "smtp";
  return "none";
}

async function sendByResend({ to, subject, text }) {
  if (!hasResendConfig()) {
    throw new Error("Resend not configured");
  }
  await axios.post(
    `${RESEND_BASE_URL.replace(/\/+$/, "")}/emails`,
    {
      from: RESEND_FROM,
      to: [to],
      subject,
      text,
    },
    {
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );
}

async function sendBySmtp({ to, subject, text }) {
  if (!hasSmtpConfig()) {
    throw new Error("SMTP not configured");
  }
  await mailer.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
  });
}

async function sendEmailMessage({ to, subject, text }) {
  const provider = resolveEmailProvider();
  if (provider === "none") {
    throw new Error(
      "Email provider not configured. Set RESEND_* or SMTP_* env variables."
    );
  }

  if (provider === "resend") {
    try {
      await sendByResend({ to, subject, text });
      return;
    } catch (err) {
      if (!hasSmtpConfig()) throw err;
      console.warn("Resend failed, attempting SMTP fallback.");
      await sendBySmtp({ to, subject, text });
      return;
    }
  }

  await sendBySmtp({ to, subject, text });
}

// helper: create app JWT
function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

// Helper: normalize email
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function makeVerifyToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hashed };
}

async function upsertGoogleUserFromPayload(payload) {
  if (!payload) throw new Error("Missing Google payload");

  const googleId = payload.sub;
  const email = normalizeEmail(payload.email);
  const name = payload.name || "Google User";
  const picture = payload.picture;
  const emailVerified = payload.email_verified !== false;

  let user = null;
  if (googleId) user = await User.findOne({ googleId });

  if (!user && email) {
    user = await User.findOne({ email });
    if (user && !user.googleId) {
      user.googleId = googleId;
      if (emailVerified) user.emailVerified = true;
      if (!user.name) user.name = name;
      await user.save();
    }
  }

  if (!user) {
    const newUser = new User({
      googleId,
      name,
      email,
      emailVerified,
      passwordHash: "",
    });
    user = await newUser.save();
  }

  if (emailVerified && !user.emailVerified) {
    user.emailVerified = true;
    await user.save();
  }

  const token = createToken({
    id: user._id,
    email: user.email,
    provider: "google",
    guest: false,
    googleId,
  });

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    },
  };
}

async function sendVerificationEmail({ to, token, name }) {
  const verifyUrl = `${SERVER_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(
    token
  )}`;
  const safeName = name || "there";

  await sendEmailMessage({
    to,
    subject: "Verify your email for Smart Screenshot Search",
    text: `Hi ${safeName},\n\nPlease verify your email to activate your account:\n${verifyUrl}\n\nIf you did not register, you can ignore this email.`,
  });
}

async function resendVerificationForUser(user) {
  if (!EMAIL_VERIFICATION_REQUIRED) {
    return { ok: true, message: "Email verification is disabled." };
  }
  if (!user) return { ok: false, status: 404, message: "Email not found" };
  if (user.emailVerified) {
    return { ok: true, message: "Email already verified." };
  }

  const { raw, hashed } = makeVerifyToken();
  user.emailVerifyToken = hashed;
  user.emailVerifyExpires = new Date(Date.now() + 1000 * 60 * 60 * 24);
  await user.save();

  await sendVerificationEmail({ to: user.email, token: raw, name: user.name });
  return { ok: true, message: "Verification email sent. Please check your inbox." };
}

/**
 * Register (email + password)
 * - Creates user, returns JWT + user
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, message: "Missing fields" });
    }

    const normalized = normalizeEmail(email);
    const existing = await User.findOne({ email: normalized });
    if (existing) {
      return res.status(400).json({ ok: false, message: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 10);
    const { raw, hashed } = makeVerifyToken();
    const user = new User({
      name,
      email: normalized,
      passwordHash: hash,
      emailVerified: !EMAIL_VERIFICATION_REQUIRED,
      emailVerifyToken: EMAIL_VERIFICATION_REQUIRED ? hashed : undefined,
      emailVerifyExpires: EMAIL_VERIFICATION_REQUIRED
        ? new Date(Date.now() + 1000 * 60 * 60 * 24)
        : undefined,
      createdAt: Date.now(),
    });
    await user.save();

    if (EMAIL_VERIFICATION_REQUIRED) {
      try {
        await sendVerificationEmail({ to: user.email, token: raw, name: user.name });
      } catch (err) {
        const code = err?.responseCode;
        await User.deleteOne({ _id: user._id });
        if (code === 550 || code === 551 || code === 553) {
          return res.status(400).json({ ok: false, message: "Email not found" });
        }
        return res.status(500).json({ ok: false, message: "Failed to send verification email" });
      }
    }

    const token = EMAIL_VERIFICATION_REQUIRED
      ? null
      : createToken({
          id: user._id,
          email: user.email,
          provider: "local",
          guest: false,
        });

    return res.json({
      ok: true,
      requiresVerification: EMAIL_VERIFICATION_REQUIRED,
      message: EMAIL_VERIFICATION_REQUIRED
        ? "Verification email sent. Please verify to sign in."
        : "Account created. You can sign in now.",
      token,
      user: { id: user._id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * Login (email + password)
 * - Verifies password, returns JWT + user
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, message: "Missing fields" });

    const normalized = normalizeEmail(email);
    const user = await User.findOne({ email: normalized });
    if (!user || !user.passwordHash) return res.status(400).json({ ok: false, message: "Invalid credentials" });
    if (EMAIL_VERIFICATION_REQUIRED && !user.emailVerified) {
      return res.status(403).json({ ok: false, message: "Email not verified. Please check your inbox." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ ok: false, message: "Invalid credentials" });

    const token = createToken({ id: user._id, email: user.email, provider: "local", guest: false });

    return res.json({
      ok: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * Google sign-in
 * - Expects body: { idToken: "<google id token>" }
 * - Verifies token with Google, finds or creates user (by googleId or email), returns jwt
 */
router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ ok: false, message: "Missing idToken" });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ ok: false, message: "Server misconfigured (missing GOOGLE_CLIENT_ID)" });

    // Verify token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload(); // contains sub, email, name, picture, email_verified...
    if (!payload) return res.status(401).json({ ok: false, message: "Invalid Google token payload" });

    const authPayload = await upsertGoogleUserFromPayload(payload);

    return res.json({
      ok: true,
      token: authPayload.token,
      user: authPayload.user,
    });
  } catch (err) {
    console.error("Google auth error:", err);
    // Google verification errors may be caused by invalid token; respond 401
    return res.status(401).json({ ok: false, message: "Invalid Google ID token" });
  }
});

/**
 * Guest access
 * - Creates a lightweight guest identity and returns a token
 */
router.post("/guest", async (req, res) => {
  try {
    const requestedName = req.body?.name;
    const guestName = requestedName ? String(requestedName).slice(0, 32) : `Guest${Math.floor(Math.random() * 10000)}`;
    const guestId = `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Note: we don't create DB user for guest by default. If you want persistence, create a user doc here.
    const token = createToken({ id: guestId, name: guestName, provider: "guest", guest: true });

    return res.json({ ok: true, token, user: { id: guestId, name: guestName, guest: true } });
  } catch (err) {
    console.error("Guest auth error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * Verify email link
 * - GET /api/auth/verify-email?token=...
 */
router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!token) return res.status(400).send("Missing verification token.");

    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerifyToken: hashed,
      emailVerifyExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send("Verification link is invalid or expired.");
    }

    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();

    return res.send("Email verified. You can now sign in.");
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).send("Verification failed.");
  }
});

router.post("/google/desktop/start", async (_req, res) => {
  try {
    cleanupDesktopOauthSessions();
    if (!GOOGLE_CLIENT_ID) {
      return res
        .status(500)
        .json({ ok: false, message: "Missing GOOGLE_CLIENT_ID" });
    }

    const sessionId = randomBase64Url(24);
    const oauthState = randomBase64Url(24);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = makeCodeChallenge(codeVerifier);
    const now = Date.now();

    desktopOauthSessions.set(sessionId, {
      createdAt: now,
      state: oauthState,
      codeVerifier,
      status: "pending",
      token: null,
      user: null,
      error: "",
    });
    desktopOauthStateIndex.set(oauthState, sessionId);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    authUrl.searchParams.set("state", oauthState);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("include_granted_scopes", "true");

    return res.json({
      ok: true,
      sessionId,
      authUrl: authUrl.toString(),
      expiresInSec: Math.floor(DESKTOP_OAUTH_TTL_MS / 1000),
    });
  } catch (err) {
    console.error("Desktop Google start error:", err);
    return res.status(500).json({ ok: false, message: "Failed to start OAuth" });
  }
});

router.get("/google/desktop/callback", async (req, res) => {
  function sendAutoClosePage(message) {
    const safeMessage = String(message || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="2;url=about:blank" />
    <title>Authentication</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
      .msg { max-width: 520px; }
    </style>
  </head>
  <body>
    <div class="msg">${safeMessage}</div>
    <script>
      try { window.close(); } catch (e) {}
      setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
    </script>
  </body>
</html>`);
  }

  cleanupDesktopOauthSessions();
  const oauthState = String(req.query?.state || "").trim();
  const code = String(req.query?.code || "").trim();
  const oauthError = String(req.query?.error || "").trim();
  const sessionId = desktopOauthStateIndex.get(oauthState);

  if (!sessionId) {
    return sendAutoClosePage("OAuth session not found or expired. You can close this tab.");
  }

  const session = desktopOauthSessions.get(sessionId);
  if (!session) {
    desktopOauthStateIndex.delete(oauthState);
    return sendAutoClosePage("OAuth session expired. You can close this tab.");
  }

  if (oauthError) {
    session.status = "failed";
    session.error = oauthError;
    return sendAutoClosePage("Google sign-in was cancelled or denied. You can close this tab.");
  }

  if (!code) {
    session.status = "failed";
    session.error = "missing_code";
    return sendAutoClosePage("Missing OAuth code. You can close this tab.");
  }

  try {
    const tokenBody = new URLSearchParams();
    tokenBody.set("client_id", GOOGLE_CLIENT_ID);
    if (GOOGLE_OAUTH_CLIENT_SECRET) {
      tokenBody.set("client_secret", GOOGLE_OAUTH_CLIENT_SECRET);
    }
    tokenBody.set("code", code);
    tokenBody.set("code_verifier", session.codeVerifier);
    tokenBody.set("grant_type", "authorization_code");
    tokenBody.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI);

    const tokenResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      tokenBody.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
      }
    );

    const idToken = String(tokenResp?.data?.id_token || "").trim();
    if (!idToken) throw new Error("Google token response missing id_token");

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const authPayload = await upsertGoogleUserFromPayload(payload);

    session.status = "complete";
    session.token = authPayload.token;
    session.user = authPayload.user;

    return sendAutoClosePage("Google sign-in complete. You can close this tab.");
  } catch (err) {
    console.error("Desktop Google callback error:", err);
    session.status = "failed";
    session.error = "oauth_exchange_failed";
    return sendAutoClosePage("Google sign-in failed on server. You can close this tab and retry.");
  }
});

router.get("/google/desktop/poll", async (req, res) => {
  cleanupDesktopOauthSessions();
  const sessionId = String(req.query?.sessionId || "").trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "Missing sessionId" });
  }

  const session = desktopOauthSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, message: "Session not found" });
  }

  if (session.status === "pending") {
    return res.json({ ok: true, status: "pending" });
  }

  if (session.status === "failed") {
    return res.status(400).json({
      ok: false,
      status: "failed",
      message: session.error || "OAuth failed",
    });
  }

  if (session.status === "complete" && session.token && session.user) {
    desktopOauthSessions.delete(sessionId);
    desktopOauthStateIndex.delete(session.state);
    return res.json({
      ok: true,
      status: "complete",
      token: session.token,
      user: session.user,
    });
  }

  return res.status(500).json({ ok: false, message: "Invalid session state" });
});

/**
 * Resend verification email
 * - POST /api/auth/resend-verification { email }
 */
async function handleResendVerification(req, res) {
  try {
    const email = normalizeEmail(req.body?.email || "");
    if (!email) return res.status(400).json({ ok: false, message: "Email required" });

    const user = await User.findOne({ email });
    try {
      const result = await resendVerificationForUser(user);
      if (!result.ok) {
        return res.status(result.status || 400).json({ ok: false, message: result.message });
      }
      return res.json({ ok: true, message: result.message });
    } catch (err) {
      const code = err?.responseCode;
      if (code === 550 || code === 551 || code === 553) {
        return res.status(400).json({ ok: false, message: "Email not found" });
      }
      return res.status(500).json({ ok: false, message: "Failed to send verification email" });
    }
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

router.post("/resend-verification", handleResendVerification);
router.post("/resend", handleResendVerification);

=======
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "7d";

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ name, email: email.toLowerCase(), passwordHash: hash });
    await user.save();
    return res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email }});
  } catch(err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
    return res.json({ ok: true, token, user: { id: user._id, name: user.name, email: user.email }});
  } catch(err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
module.exports = router;
