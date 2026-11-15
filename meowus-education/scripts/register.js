
/* ============================================================
   Registration page
   1. Validate fields
   2. Reject duplicate username / email
   3. Hash password (auth.js)
   4. Save account to localStorage "users"
   5. Redirect to login.html
   ============================================================ */

const registerForm   = document.getElementById("register-form");
const registerButton = document.getElementById("register-submit");
const registerStatus = document.getElementById("form-status");

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
    ["username", "email", "password", "verifyPassword"].forEach(clearFieldError);
}

function setFormStatus(message, type = "") {
    if (!registerStatus) return;
    registerStatus.textContent = message;
    registerStatus.classList.remove("is-success", "is-error");
    if (type === "success") registerStatus.classList.add("is-success");
    if (type === "error")   registerStatus.classList.add("is-error");
}

// Clear a field's error as soon as the user edits it
registerForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
        clearFieldError(input.id);
        setFormStatus("");
    });
});

// ---------- Submit ----------

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllErrors();
    setFormStatus("");

    const username       = document.getElementById("username").value.trim();
    const email          = document.getElementById("email").value.trim();
    const password       = document.getElementById("password").value;
    const verifyPassword = document.getElementById("verifyPassword").value;

    let isValid = true;

    if (!USERNAME_PATTERN.test(username)) {
        showFieldError("username", "Use 6–18 characters: letters, numbers, periods, underscores, or hyphens.");
        isValid = false;
    }

    if (!EMAIL_PATTERN.test(email)) {
        showFieldError("email", "Enter a valid email address.");
        isValid = false;
    }

    if (password.length < 8 || password.length > 64) {
        showFieldError("password", "Password must be between 8 and 64 characters.");
        isValid = false;
    } else if (!/[a-z]/.test(password)) {
        showFieldError("password", "Password needs at least one lowercase letter.");
        isValid = false;
    } else if (!/[A-Z]/.test(password)) {
        showFieldError("password", "Password needs at least one uppercase letter.");
        isValid = false;
    } else if (!/[0-9]/.test(password)) {
        showFieldError("password", "Password needs at least one number.");
        isValid = false;
    }

    if (password !== verifyPassword) {
        showFieldError("verifyPassword", "The passwords do not match.");
        isValid = false;
    }

    if (!isValid) return;

    const originalText = registerButton.textContent;
    registerButton.disabled = true;
    registerButton.textContent = "Creating account…";

    try {
        const users = window.MeowusAuth.getUsers();
        const uname = username.toLowerCase();
        const mail  = email.toLowerCase();

        const usernameTaken = users.some(u =>
            u && typeof u.username === "string" && u.username.toLowerCase() === uname);
        if (usernameTaken) {
            showFieldError("username", "That username is already registered.");
            return;
        }

        const emailTaken = users.some(u =>
            u && typeof u.email === "string" && u.email.toLowerCase() === mail);
        if (emailTaken) {
            showFieldError("email", "That email address is already registered.");
            return;
        }

        // { salt, passwordHash, iterations } — the plain password is NOT stored
        const passwordRecord = await window.MeowusAuth.createPasswordRecord(password);

        users.push({
            username,
            email,
            ...passwordRecord,
            createdAt: new Date().toISOString()
        });

        window.MeowusAuth.saveUsers(users);

        setFormStatus("Account created. Taking you to the login page…", "success");

        setTimeout(() => {
            window.location.replace("/login.html?registered=1");
        }, 700);

    } catch (err) {
        console.error("Registration failed:", err);
        setFormStatus(err.message || "Could not save the account. Check that browser storage is available.", "error");
    } finally {
        registerButton.disabled = false;
        registerButton.textContent = originalText;
    }
});