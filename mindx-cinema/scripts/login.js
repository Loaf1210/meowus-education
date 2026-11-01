"use strict";

/* ============================================================
   Login page
   Requires username + email + password to match ONE account.
   On success: auth.js stores a session, then redirect to index.html.
   ============================================================ */

const loginForm   = document.getElementById("login-form");
const loginButton = document.getElementById("login-submit");
const loginStatus = document.getElementById("form-status");

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{6,18}$/;
const EMAIL_PATTERN    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- UI helpers ----------

function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(`${inputId}-error`);
    if (!input || !error) return;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    error.textContent = message;
}

function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(`${inputId}-error`);
    if (input) {
        input.classList.remove("is-invalid");
        input.removeAttribute("aria-invalid");
    }
    if (error) error.textContent = "";
}

function clearAllErrors() {
    ["username", "email", "password"].forEach(clearFieldError);
}

function setFormStatus(message, type = "") {
    if (!loginStatus) return;
    loginStatus.textContent = message;
    loginStatus.classList.remove("is-success", "is-error");
    if (type === "success") loginStatus.classList.add("is-success");
    if (type === "error")   loginStatus.classList.add("is-error");
}

// ---------- Page load ----------

// Already logged in? Go straight to the app.
if (window.MeowusAuth.getSession()) {
    window.location.replace("/index.html");
}

// register.js redirects here with ?registered=1
if (new URLSearchParams(window.location.search).get("registered") === "1") {
    setFormStatus("Your account was created. Log in to continue.", "success");
}

loginForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
        clearFieldError(input.id);
        setFormStatus("");
    });
});

// ---------- Submit ----------

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllErrors();
    setFormStatus("");

    const username = document.getElementById("username").value.trim();
    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    let isValid = true;

    if (!USERNAME_PATTERN.test(username)) {
        showFieldError("username", "Enter a valid username (6–18 allowed characters).");
        isValid = false;
    }
    if (!EMAIL_PATTERN.test(email)) {
        showFieldError("email", "Enter a valid email address.");
        isValid = false;
    }
    if (password.length === 0) {
        showFieldError("password", "Enter your password.");
        isValid = false;
    } else if (password.length > 64) {
        showFieldError("password", "Password is too long.");
        isValid = false;
    }

    if (!isValid) return;

    const originalText = loginButton.textContent;
    loginButton.disabled = true;
    loginButton.textContent = "Checking…";

    try {
        const users = window.MeowusAuth.getUsers();
        const uname = username.toLowerCase();
        const mail  = email.toLowerCase();

        // Username AND email must belong to the same account
        const matchingUser = users.find(u =>
            u &&
            typeof u.username === "string" &&
            typeof u.email === "string" &&
            u.username.toLowerCase() === uname &&
            u.email.toLowerCase() === mail
        );

        // Generic message: don't reveal which part was wrong
        if (!matchingUser) {
            setFormStatus("Username, email, or password is incorrect.", "error");
            return;
        }

        const ok = await window.MeowusAuth.verifyPassword(matchingUser, password, users);
        if (!ok) {
            setFormStatus("Username, email, or password is incorrect.", "error");
            return;
        }

        window.MeowusAuth.setSession(matchingUser);
        setFormStatus("Login successful. Opening your study dashboard…", "success");

        setTimeout(() => {
            window.location.replace("/index.html");
        }, 250);

    } catch (err) {
        console.error("Login failed:", err);
        setFormStatus(err.message || "Could not check the account. Check browser storage and try again.", "error");
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = originalText;
    }
});