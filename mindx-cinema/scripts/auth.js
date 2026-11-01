/* ============================================================
   Shared browser-only authentication helpers.

   localStorage keys used:
   - "users"                      -> array of account records
   - "currentUser"                -> { username, email, signedInAt }
   - "study_cat_app_active_user"  -> username the study app should load

   Passwords are stored as salted PBKDF2-SHA256 hashes. PROTECTED against brute force attacks
   Old accounts saved by the previous register.js (plain-text
   "password" field) are upgraded to a hash on their next login.
   ============================================================ */
(() => {
    "use strict";

    const USERS_KEY = "users";
    const SESSION_KEY = "currentUser";
    const ACTIVE_STUDY_USER_KEY = "study_cat_app_active_user"; // = app.js STORAGE_PREFIX + "active_user"

    const DEFAULT_ITERATIONS = 210000;
    const MIN_ITERATIONS = 100000;
    const MAX_ITERATIONS = 1000000;
    const HASH_BITS = 256;

    const encoder = new TextEncoder();

    // ---------- Small helpers ----------
    function requireWebCrypto() {
        if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
            throw new Error(
                "Password hashing needs a secure context. Run the project on localhost " +
                "(e.g. VS Code Live Server) or HTTPS."
            );
        }
    }

    function bytesToBase64(bytes) {
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return window.btoa(binary);
    }

    function base64ToBytes(text) {
        const binary = window.atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function safeIterations(value) {
        const n = Number(value);
        return Number.isInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS
            ? n
            : DEFAULT_ITERATIONS;
    }

    // Compares every byte (no early exit) to avoid simple timing leaks
    function equalBytes(a, b) {
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff === 0;
    }

    // ---------- Hashing ----------

    async function deriveHash(password, saltBytes, iterations) {
        requireWebCrypto();

        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits"]
        );

        const bits = await window.crypto.subtle.deriveBits(
            { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
            keyMaterial,
            HASH_BITS
        );

        return new Uint8Array(bits);
    }

    /** Returns { salt, passwordHash, iterations } for a new account */
    async function createPasswordRecord(password) {
        requireWebCrypto();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const hash = await deriveHash(password, salt, DEFAULT_ITERATIONS);
        return {
            salt: bytesToBase64(salt),
            passwordHash: bytesToBase64(hash),
            iterations: DEFAULT_ITERATIONS
        };
    }

    /**
     * Checks a password against a user record.
     * Supports the new hashed format AND the old plain-text format.
     * Old accounts are upgraded to a hash when the password is correct.
     */
    async function verifyPassword(user, password, users) {
        if (!user || typeof password !== "string") return false;

        // New format
        if (typeof user.salt === "string" && typeof user.passwordHash === "string") {
            try {
                const salt = base64ToBytes(user.salt);
                const expected = base64ToBytes(user.passwordHash);
                const actual = await deriveHash(password, salt, safeIterations(user.iterations));
                return equalBytes(actual, expected);
            } catch (err) {
                console.error("Could not verify password hash:", err);
                return false;
            }
        }

        // Legacy format: { password: "plain" }
        if (typeof user.password === "string" && user.password === password) {
            const record = await createPasswordRecord(password);
            delete user.password;
            Object.assign(user, record);
            saveUsers(Array.isArray(users) ? users : getUsers());
            return true;
        }

        return false;
    }

    // ---------- Users storage ----------

    function getUsers() {
        const raw = window.localStorage.getItem(USERS_KEY);
        if (raw === null) return [];

        let users;
        try {
            users = JSON.parse(raw);
        } catch {
            throw new Error('Saved account data is not valid JSON. Clear the "users" localStorage entry.');
        }
        if (!Array.isArray(users)) {
            throw new Error('Saved account data is not an array. Clear the "users" localStorage entry.');
        }
        return users;
    }

    function saveUsers(users) {
        if (!Array.isArray(users)) throw new TypeError("saveUsers expects an array.");
        window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    // ---------- Session ----------

    function setSession(user) {
        if (!user || typeof user.username !== "string" || typeof user.email !== "string") {
            throw new TypeError("A valid user is required to create a session.");
        }

        // No password or hash is stored in the session
        window.localStorage.setItem(SESSION_KEY, JSON.stringify({
            username: user.username,
            email: user.email,
            signedInAt: new Date().toISOString()
        }));

        // Tell the study app which profile to load
        window.localStorage.setItem(ACTIVE_STUDY_USER_KEY, user.username);
    }

    function getSession() {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return null;

        try {
            const s = JSON.parse(raw);
            const ok = s &&
                typeof s.username === "string" && s.username.trim() !== "" &&
                typeof s.email === "string" && s.email.trim() !== "";
            return ok ? s : null;
        } catch {
            return null;
        }
    }

    /** Removes the login session only account and study data are kept */
    function clearSession() {
        window.localStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(ACTIVE_STUDY_USER_KEY);
    }

    // ---------- Public API ----------
    window.MeowusAuth = Object.freeze({
        getUsers,
        saveUsers,
        createPasswordRecord,
        verifyPassword,
        setSession,
        getSession,
        clearSession
    });
})();