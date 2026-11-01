/**
 * Gamified Study & Cat Collector - Complete Application Engine
 * 
 * ARCHITECTURE OVERVIEW:
 * 1. State (appState): A central JavaScript object holds all data (tasks, chests, cats).
 * 2. Persistence (saveState): Every time state changes, it's saved to the browser's localStorage.
 * 3. Rendering (renderAllViews): Functions read appState and update the HTML.
 * 4. Events: User clicks -> JS modifies state -> saves -> renders.
 */

// --- 1. STATE & DATA MODELS ---

// Prefix prevents our localStorage keys from colliding with other websites' data on localhost.
const STORAGE_PREFIX = 'study_cat_app_';

// DEFAULT_STATE defines the structure of a completely new user.
const DEFAULT_STATE = {
    user: 'Scholar',
    settings: {
        dailyGoalMinutes: 60,
        apiKey: '',
        soundEnabled: true,
        musicEnabled: true,
        musicTrack: "./mindx-cinema/assets/study-music.mp3",
        musicVolume: 0.5
    },
    stats: {
        totalStudyMinutes: 0,
        tasksCompleted: 0,
        openedChestsCount: { cardboard: 0, homework: 0, study: 0, golden: 0 },
        streakDays: 1,
        lastActiveDate: new Date().toISOString().slice(0, 10), // Grabs "YYYY-MM-DD" 
        minutesStudiedToday: 0
    },
    chests: {
        cardboard: 0, homework: 0, study: 0, golden: 0
    },
    tasks: [],
    schedule: [],
    collection: [] // Array of Objects: { id: string, url: string, rarity: string, date: string, customName: string }
};

// Global variables to track the active application memory
let appState = {};
let activeTimer = null; // Holds the setInterval ID so we can pause/stop it
let timerSecondsRemaining = 25 * 60; // 25 mins by default (25 * 60 = 1500 seconds => 25 mins)
let isTimerRunning = false;
let sessionSecondsAccumulated = 0; // Tracks consecutive study time to unlock the Claim button

// Variables to hold Bootstrap's Modal objects so we can call .show() or .hide() in JS
let taskModalInstance, scheduleModalInstance, chestRevealModalInstance, catInspectModalInstance;


// --- AUDIO & MUSIC CONFIGURATION ---
// We use two different audio systems:
// 1. HTML5 <audio> element: Best for long, looping MP3 music files.
// 2. Web Audio API (AudioContext): Best for short, generated synth beeps with no file-loading delay.

let currentInspectingCatId = null;
let audioContext = null;

/**
 * Initializes the Web Audio Context lazily.
 * Browsers block audio until the user clicks something, so we don't start this on page load.
 */
function getAudioContext() {
    if (!audioContext) {
        // Fallback for older Safari
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

/** Helper to grab the <audio> tag from HTML */
function getMusicElement() {
    return document.getElementById('bgMusicPlayer');
}

/** 
 * Starts the looping MP3 background track based on Settings.
 */
function playBackgroundMusic() {
    const audio = getMusicElement();
    if (!audio) return;

    // Determine which track to play based on appState
    const trackUrl = appState.settings.musicTrack || './mindx-cinema/assets/study-music.mp3';

    // Only swap the 'src' attribute if it's actually different.
    // Changing 'src' unnecessarily restarts the download/buffer process.
    if (audio.getAttribute('src') !== trackUrl) {
        audio.setAttribute('src', trackUrl);
    }

    audio.volume = appState.settings.musicVolume ?? 0.5;
    audio.loop = true;

    // .play() returns a Promise. If the browser blocks it (e.g. no user interaction yet),
    // or if the file doesn't exist, it falls into the .catch() block.
    audio.play().then(() => {
        updateMusicUI(true);
    }).catch(err => {
        console.warn('Music play failed (check if file exists in assets folder):', err);
        triggerToast('🎵 Add your audio file to /mindx-cinema/assets/study-music.mp3 to hear music!');
        updateMusicUI(false);
    });
}

/** Pauses the music */
function stopBackgroundMusic() {
    const audio = getMusicElement();
    if (!audio) return;
    audio.pause(); // Note: pause() keeps the time position. It doesn't restart from 0:00.
    updateMusicUI(false);
}

/** Called by the manual play/pause pill button in the top bar */
function toggleMusicManual() {
    const audio = getMusicElement();
    if (!audio) return;

    if (audio.paused) {
        playBackgroundMusic();
    } else {
        stopBackgroundMusic();
    }
}

/** Modifies the HTML classes to show an active, spinning, glowing music pill */
function updateMusicUI(isPlaying) {
    const pill = document.querySelector('.music-player-pill');
    const icon = document.getElementById('quickMusicIcon');
    const statusText = document.getElementById('musicStatusText');

    if (pill) pill.classList.toggle('playing', isPlaying); // Toggles CSS cyan glow
    if (icon) {
        // Switch between the spinning pause icon (when active) and standard note (when paused)
        icon.className = isPlaying
            ? 'bi bi-pause-circle-fill fs-5 music-note-spin'
            : 'bi bi-music-note-beamed fs-5';
    }
    if (statusText) {
        statusText.textContent = isPlaying ? 'Playing (Looped)' : 'Study Music';
    }
}

/**
 * Synthesizes a beep tone. No MP3 file needed.
 * Uses an Oscillator (creates the sound wave) attached to a Gain Node (controls volume fading).
 */
const playBeep = (freq = 440, type = 'sine', duration = 0.15) => {
    if (!appState.settings.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type; // 'sine', 'square', 'sawtooth', 'triangle'
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        // Start at 10% volume, then exponentially fade out to near 0 over 'duration' seconds
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

        // Connect the chain: Oscillator -> Volume Control -> Speakers
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn('Audio Context not allowed without interaction yet');
    }
};

// --- 2. INITIALIZATION & AUTH ---

// DOMContentLoaded fires when the HTML document has been completely parsed, 
// ensuring all elements exist before we try to attach listeners to them.
document.addEventListener("DOMContentLoaded", () => {
    // ---- Require a login session (created by login.js) ----
    const session = window.MeowusAuth ? window.MeowusAuth.getSession() : null;
    if (!session) {
        window.location.replace("/login.html");
        return;
    }

    // ---- Bootstrap modal controllers ----
    taskModalInstance = new bootstrap.Modal(document.getElementById("taskModal"));
    scheduleModalInstance = new bootstrap.Modal(document.getElementById("scheduleModal"));
    chestRevealModalInstance = new bootstrap.Modal(document.getElementById("chestRevealModal"));
    catInspectModalInstance = new bootstrap.Modal(document.getElementById("catInspectModal"));

    // ---- Load this account's study profile (no "Scholar" bypass) ----
    loadUserData(session.username);

    setupEventListeners();
    checkDailyStreakRollover();
    renderAllViews();
});

/**
 * Loads saved data from localStorage.
 * If data exists, it parses the JSON string back into a JS Object.
 * If missing, it creates a fresh deep-copy of DEFAULT_STATE.
 */
function loadUserData(username) {
    const storageKey = STORAGE_PREFIX + "data_" + username;
    const rawData = localStorage.getItem(storageKey);
    const defaults = JSON.parse(JSON.stringify(DEFAULT_STATE));

    let savedData = null;

    if (rawData) {
        try {
            savedData = JSON.parse(rawData);
        } catch (err) {
            // Keep a backup of the broken data instead of silently discarding it
            try {
                localStorage.setItem(`${storageKey}_backup_${Date.now()}`, rawData);
            } catch (backupErr) {
                console.warn("Could not back up corrupted study data:", backupErr);
            }
            console.error("Could not parse saved study data:", err);
            savedData = null;
        }
    }

    if (savedData && typeof savedData === "object" && !Array.isArray(savedData)) {
        // ---- Merge saved profile with current defaults ----
        const savedSettings = savedData.settings && typeof savedData.settings === "object" ? savedData.settings : {};
        const savedStats = savedData.stats && typeof savedData.stats === "object" ? savedData.stats : {};
        const savedOpened = savedStats.openedChestsCount && typeof savedStats.openedChestsCount === "object"
            ? savedStats.openedChestsCount : {};
        const savedChests = savedData.chests && typeof savedData.chests === "object" ? savedData.chests : {};

        appState = {
            ...defaults,
            ...savedData,
            user: username, // always the authenticated session's username
            settings: { ...defaults.settings, ...savedSettings },
            stats: {
                ...defaults.stats,
                ...savedStats,
                openedChestsCount: { ...defaults.stats.openedChestsCount, ...savedOpened }
            },
            chests: { ...defaults.chests, ...savedChests },
            tasks: Array.isArray(savedData.tasks) ? savedData.tasks : [],
            schedule: Array.isArray(savedData.schedule) ? savedData.schedule : [],
            collection: Array.isArray(savedData.collection)
                ? savedData.collection
                    .filter(cat => cat && typeof cat === "object")
                    .map(cat => ({ ...cat, customName: cat.customName || cat.name || "" }))
                : []
        };

        // ---- Migrate old music settings ----
        const oldTrackPaths = {
            ambient: "./mindx-cinema/assets/ambient.mp3",
            piano: "./mindx-cinema/assets/piano.mp3",
            "lo-fi": "./mindx-cinema/assets/lofi.mp3",
            nature: "./mindx-cinema/assets/nature.mp3"
        };
        if (oldTrackPaths[appState.settings.musicTrack]) {
            appState.settings.musicTrack = oldTrackPaths[appState.settings.musicTrack];
        }

        const vol = Number(appState.settings.musicVolume);
        appState.settings.musicVolume = Number.isFinite(vol)
            ? Math.max(0, Math.min(1, vol > 1 ? vol / 100 : vol)) // 35 -> 0.35
            : 0.5;

    } else {
        // ---- First time this account opens the study app ----
        appState = defaults;
        appState.user = username;
        appState.tasks = [
            { id: "t1", title: "Complete Math Exercise 3.2", subject: "Math", type: "homework", priority: "High", deadline: new Date().toISOString().slice(0, 10), completed: false },
            { id: "t2", title: "Review Chemistry Flashcards", subject: "Chemistry", type: "small", priority: "Medium", deadline: new Date().toISOString().slice(0, 10), completed: false }
        ];
    }

    // Keep the study app's profile pointer in sync with the session
    localStorage.setItem(STORAGE_PREFIX + "active_user", username);

    const nameEl = document.getElementById("currentUserDisplay");
    if (nameEl) nameEl.textContent = appState.user;

    const profileEl = document.getElementById("authProfileDisplay");
    if (profileEl) {
        profileEl.classList.remove("d-none");
        profileEl.classList.add("d-flex");
    }

    saveState(); // persist merged/migrated fields
}

/** Translates our memory object (appState) into a string and saves it to the browser database */
function saveState() {
    localStorage.setItem(STORAGE_PREFIX + 'data_' + appState.user, JSON.stringify(appState));
}

/**
 * Validates the user's study streak.
 * Runs on startup. Compares today's date against the last saved date.
 */
function checkDailyStreakRollover() {
    const today = new Date().toISOString().slice(0, 10); // Format: "2023-10-05"

    if (appState.stats.lastActiveDate !== today) {
        // They are logging in on a new day
        const last = new Date(appState.stats.lastActiveDate);
        const curr = new Date(today);

        // Calculate difference in milliseconds, then convert to days
        const diffDays = Math.round((curr - last) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            // Perfect! Exactly one day later. Increase streak.
            appState.stats.streakDays += 1;
        } else if (diffDays > 1) {
            // Missed a day. Reset to 1.
            appState.stats.streakDays = 1;
        }

        // Reset daily tracked minutes and update the active date
        appState.stats.minutesStudiedToday = 0;
        appState.stats.lastActiveDate = today;
        saveState();
    }
}

// --- 3. NAVIGATION (SPA VIEWS) & LISTENERS ---

/** Attaches JS click/change events to HTML elements. */
function setupEventListeners() {
    // 1. Navigation Menu Routing
    // Selects all elements inside <header> that have a 'data-view' attribute.
    document.querySelectorAll('header [data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.currentTarget.getAttribute('data-view');
            switchView(view); // Change the visible page
        });
    });

    // 2. Dropdown Filters
    document.getElementById('taskCategoryFilter').addEventListener('change', renderTasks);
    document.getElementById('collectionRarityFilter').addEventListener('change', renderCollection);

    // 3. Form Submissions (Prevents default page refresh, handles data instead)
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    document.getElementById('scheduleForm').addEventListener('submit', handleScheduleSubmit);

    // 4. Settings Buttons
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
    document.getElementById('resetDataBtn').addEventListener('click', handleResetData);

    // 5. Top Bar Music Player controls
    const quickMusicBtn = document.getElementById('quickMusicToggleBtn');
    const volumeSlider = document.getElementById('musicVolumeSlider');

    if (quickMusicBtn) quickMusicBtn.addEventListener('click', toggleMusicManual);
    if (volumeSlider) {
        // Live update the slider value
        volumeSlider.value = appState.settings.musicVolume ?? 0.5;
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            appState.settings.musicVolume = vol; // Save to state
            const audio = getMusicElement();
            if (audio) audio.volume = vol; // Apply immediately to playing audio
            saveState();
        });
    }

    // 6. Settings Page Music Dropdowns
    const musicToggle = document.getElementById('settingMusicToggle');
    const musicTrack = document.getElementById('settingMusicTrack');

    if (musicToggle) {
        musicToggle.addEventListener('change', () => {
            appState.settings.musicEnabled = musicToggle.checked;
            saveState();
        });
    }
    if (musicTrack) {
        musicTrack.addEventListener('change', () => {
            appState.settings.musicTrack = musicTrack.value;
            saveState();
            const audio = getMusicElement();
            // If music is already playing, applying a new track will seamlessly swap it
            if (audio && !audio.paused) {
                playBackgroundMusic();
            }
        });
    }

    // 7. Cat Inspector Modal (Rename & Delete)
    const saveNameBtn = document.getElementById('saveCustomNameBtn');
    const removeCatBtn = document.getElementById('removeCatBtn');
    if (saveNameBtn) saveNameBtn.addEventListener('click', saveCustomCatName);
    if (removeCatBtn) removeCatBtn.addEventListener('click', removeCatFromCollection);

    // 8. Logout
    const logoutButton = document.getElementById("logoutBtn");
    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            // Stop the timer and music before leaving
            if (activeTimer !== null) {
                clearInterval(activeTimer);
                activeTimer = null;
            }
            isTimerRunning = false;
            if (typeof stopBackgroundMusic === "function") stopBackgroundMusic();

            // Clears the login session only — account + study data are kept
            window.MeowusAuth.clearSession();
            window.location.replace("./login.html");
        });
    }

    // 9. Timer Controls
    document.getElementById('timerToggleBtn').addEventListener('click', toggleTimer);
    document.getElementById('timerResetBtn').addEventListener('click', resetTimer);
    document.getElementById('claimSessionRewardBtn').addEventListener('click', claimSessionChest);

    // Switches between 25m / 50m / Stopwatch modes
    document.querySelectorAll('[data-timer-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove 'active' class from all, add to clicked
            document.querySelectorAll('[data-timer-type]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');

            // Read the timer target (25, 50, or 'stopwatch')
            const type = e.currentTarget.getAttribute('data-timer-type');
            if (type === 'stopwatch') {
                timerSecondsRemaining = 0; // Starts at 0, goes up
            } else {
                timerSecondsRemaining = parseInt(type, 10) * 60; // Converts minutes to seconds
            }

            sessionSecondsAccumulated = 0; // Reset consecutive reward counter
            updateTimerDisplay(); // Force text update
            if (isTimerRunning) toggleTimer(); // Pause if it was running
        });
    });
}

/** 
 * Single Page Application Routing 
 * Hides all elements with class '.app-view', then unhides the targeted ID.
 */
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    // Un-highlight all nav buttons
    document.querySelectorAll('header [data-view]').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewName}`);
    const targetNavBtn = document.querySelector(`header [data-view="${viewName}"]`);

    if (targetView) targetView.classList.add('active'); // CSS block sets display:block
    if (targetNavBtn) targetNavBtn.classList.add('active');

    // To save performance, we only re-render the heavy HTML grids when their specific tab is clicked
    if (viewName === 'stats') renderStats();
    if (viewName === 'collection') renderCollection();
    if (viewName === 'chests') renderChests();
}

// --- 4. TIMER LOGIC ---

/**
 * Handles the Start/Pause button on the global timer.
 * Contains the main setInterval interval loop that ticks every 1000ms (1 second).
 */
function toggleTimer() {
    const btn = document.getElementById('timerToggleBtn');

    // PAUSING
    if (isTimerRunning) {
        clearInterval(activeTimer); // Stops the loop
        isTimerRunning = false;

        // Update UI back to 'Resume'
        btn.innerHTML = '<i class="bi bi-play-fill"></i> Resume';
        btn.className = 'btn btn-sm btn-success';
        stopBackgroundMusic();
        document.getElementById('timerDisplay').classList.remove('timer-active'); // Removes blue glow
    }

    // STARTING
    else {
        isTimerRunning = true;
        btn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause';
        btn.className = 'btn btn-sm btn-warning text-dark';

        if (appState.settings.musicEnabled) {
            playBackgroundMusic(); // Auto-start music if preference is on
        }
        document.getElementById('timerDisplay').classList.add('timer-active');

        // Execute this block of code every 1000 milliseconds
        activeTimer = setInterval(() => {
            // Track total seconds this session to unlock the Chest button (needs 15m = 900s)
            sessionSecondsAccumulated++;

            // Check if we are in Stopwatch mode (counting up) or Countdown mode (counting down)
            const isStopwatch = document.querySelector('[data-timer-type="stopwatch"]').classList.contains('active');

            if (!isStopwatch) { // COUNTDOWN MODE
                if (timerSecondsRemaining > 0) {
                    timerSecondsRemaining--; // Tick down
                } else {
                    // REACHED ZERO: Session Complete!
                    clearInterval(activeTimer);
                    isTimerRunning = false;
                    stopBackgroundMusic();
                    playBeep(880, 'triangle', 0.5); // Ping!

                    alert('Study session complete! You earned rewards!');

                    // Convert accumulated seconds to minutes and add to lifetime stats
                    recordStudyTime(Math.floor(sessionSecondsAccumulated / 60));

                    // Reward a highly valuable Study Chest
                    appState.chests.study++;
                    saveState();
                    renderChests();
                    renderDashboard();

                    // Reset UI
                    btn.innerHTML = '<i class="bi bi-play-fill"></i> Start';
                    btn.className = 'btn btn-sm btn-success';
                    document.getElementById('timerDisplay').classList.remove('timer-active');
                    return; // Exit the loop
                }
            } else { // STOPWATCH MODE
                timerSecondsRemaining++; // Tick up indefinitely
            }

            // Check if user has accumulated 15 minutes (900s). Enable manual claim button.
            if (sessionSecondsAccumulated >= 900) {
                document.getElementById('claimSessionRewardBtn').removeAttribute('disabled');
            }

            // Record 1 minute increments to state while it runs
            // Using modulo (%) checks if the number is exactly divisible by 60
            if (sessionSecondsAccumulated > 0 && sessionSecondsAccumulated % 60 === 0) {
                recordStudyTime(1);
            }

            // Update HTML text
            updateTimerDisplay();
        }, 1000);
    }
}

function resetTimer() {
    if (isTimerRunning) toggleTimer(); // Pause it first
    sessionSecondsAccumulated = 0; // Wipe accumulation

    // Read the active mode and reset text to match
    const activeType = document.querySelector('[data-timer-type].active').getAttribute('data-timer-type');
    timerSecondsRemaining = activeType === 'stopwatch' ? 0 : parseInt(activeType, 10) * 60;

    updateTimerDisplay();
}

/** Formats integer seconds into a MM:SS string (e.g., 25:00) */
function updateTimerDisplay() {
    // Math.floor(seconds / 60) gets minutes. padStart ensures '5' becomes '05'
    const m = Math.floor(timerSecondsRemaining / 60).toString().padStart(2, '0');
    // modulo 60 gets the remainder seconds
    const s = (timerSecondsRemaining % 60).toString().padStart(2, '0');
    document.getElementById('timerDisplay').textContent = `${m}:${s}`;
}

/** Add completed minutes to the dashboard goals and lifetime stats */
function recordStudyTime(mins) {
    if (mins <= 0) return;
    appState.stats.totalStudyMinutes += mins;
    appState.stats.minutesStudiedToday += mins;
    saveState();
    renderDashboard();
}

/** Fires when clicking "Finish & Claim Chest" (enabled after 15m) */
function claimSessionChest() {
    if (sessionSecondsAccumulated >= 900) {
        appState.chests.study++;
        playBeep(523.25, 'sine', 0.3);
        createConfetti(); // Visual explosion!
        triggerToast('🎉 Awesome focus session! 1 Study Chest added to your Chest Room.');

        sessionSecondsAccumulated = 0; // Reset so they have to study another 15m
        document.getElementById('claimSessionRewardBtn').setAttribute('disabled', 'true');
        saveState();
        renderChests();
        renderDashboard();
    }
}

// --- 5. TASK MANAGEMENT ---

/** Opens the Bootstrap modal. If a taskId is passed, it fills the inputs to edit. */
function openCreateTaskModal(taskId = null) {
    document.getElementById('taskForm').reset(); // Clear old data
    document.getElementById('taskFormId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Add New Study Task';

    // Default deadline to today
    document.getElementById('taskDeadlineInput').value = new Date().toISOString().slice(0, 10);

    if (taskId) {
        // Array.find() searches the array and returns the first object matching the ID
        const task = appState.tasks.find(t => t.id === taskId);
        if (task) {
            document.getElementById('taskFormId').value = task.id;
            document.getElementById('taskTitleInput').value = task.title;
            document.getElementById('taskSubjectInput').value = task.subject;
            document.getElementById('taskDeadlineInput').value = task.deadline;
            document.getElementById('taskTypeInput').value = task.type;
            document.getElementById('taskPriorityInput').value = task.priority;
            document.getElementById('taskModalTitle').textContent = 'Edit Study Task';
        }
    }
    taskModalInstance.show(); // Display Bootstrap Modal
}

/** Intercepts the form submission, reads inputs, and pushes to appState */
function handleTaskSubmit(e) {
    e.preventDefault(); // Stop page from refreshing on form submit

    // Generate a crude unique ID based on timestamp if it's a new task
    const id = document.getElementById('taskFormId').value || 'task_' + Date.now();
    const title = document.getElementById('taskTitleInput').value.trim();
    const subject = document.getElementById('taskSubjectInput').value.trim();
    const deadline = document.getElementById('taskDeadlineInput').value;
    const type = document.getElementById('taskTypeInput').value;
    const priority = document.getElementById('taskPriorityInput').value;

    // Array.findIndex() returns -1 if not found.
    const existingIdx = appState.tasks.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
        // Update existing task using object spread syntax (...)
        appState.tasks[existingIdx] = { ...appState.tasks[existingIdx], title, subject, deadline, type, priority };
    } else {
        // Push brand new object to array
        appState.tasks.push({ id, title, subject, deadline, type, priority, completed: false, createdAt: new Date().toISOString() });
    }

    saveState();
    taskModalInstance.hide();
    renderTasks();
    renderDashboard();
}

/** Flips a task between true/false. If marked true, grants a chest! */
function toggleTaskComplete(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed; // Toggle boolean

    if (task.completed) {
        appState.stats.tasksCompleted++;
        playBeep(659.25, 'triangle', 0.25);

        // Assign correct chest based on task type enum
        let rewardTier = 'cardboard'; // Default small
        if (task.type === 'homework') rewardTier = 'homework';
        if (task.type === 'milestone') rewardTier = 'golden';

        appState.chests[rewardTier]++;
        createConfetti();
        triggerToast(`🎉 Task completed! You earned a ${rewardTier.toUpperCase()} chest!`);
    }

    saveState();
    renderTasks();
    renderDashboard();
    renderChests();
}

/** Deletes task using Array.filter() to keep everything EXCEPT the matching ID */
function deleteTask(taskId) {
    if (confirm('Delete this task?')) {
        appState.tasks = appState.tasks.filter(t => t.id !== taskId);
        saveState();
        renderTasks();
        renderDashboard();
    }
}

// --- 6. SCHEDULE MANAGEMENT ---
// (Identical standard CRUD logic as Tasks)
function handleScheduleSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('schedTitle').value.trim();
    const day = document.getElementById('schedDay').value;
    const time = document.getElementById('schedTime').value;
    const type = document.getElementById('schedType').value;

    appState.schedule.push({ id: 'sched_' + Date.now(), title, day, time, type });
    saveState();
    scheduleModalInstance.hide();
    document.getElementById('scheduleForm').reset();
    renderSchedule();
}

function deleteScheduleItem(id) {
    appState.schedule = appState.schedule.filter(s => s.id !== id);
    saveState();
    renderSchedule();
}

// --- 7. CAT API & DEDUPLICATION CHEST LOGIC ---

/**
 * Probabilities for generating cat rarities depending on chest type.
 * e.g., Golden Chest has a 30% chance for Legendary, while Cardboard has 3%.
 * Math must add up to 1.00 per chest.
 */
const RARITY_WEIGHTS = {
    cardboard: { Common: 0.55, Rare: 0.30, Epic: 0.12, Legendary: 0.03 },
    homework: { Common: 0.35, Rare: 0.35, Epic: 0.22, Legendary: 0.08 },
    study: { Common: 0.25, Rare: 0.35, Epic: 0.28, Legendary: 0.12 },
    golden: { Common: 0.00, Rare: 0.25, Epic: 0.45, Legendary: 0.30 }
};

/**
 * Takes the probabilities above and rolls a random number to select a rarity string.
 */
function rollRarity(tier) {
    const weights = RARITY_WEIGHTS[tier] || RARITY_WEIGHTS.cardboard;
    const rand = Math.random(); // Generates a random float between 0.000000 and 0.999999

    let cumulative = 0;
    // Object.entries turns {a: 1, b: 2} into [['a', 1], ['b', 2]] so we can loop it
    for (const [rarity, chance] of Object.entries(weights)) {
        cumulative += chance;
        // The higher the probability, the wider the 'net' this if-statement casts
        if (rand <= cumulative) return rarity;
    }
    return 'Common'; // Safe fallback
}

/**
 * ASYNC/AWAIT function to hit the external API.
 * The Cat API has hundreds of thousands of images. We want to avoid pulling
 * an image the user already owns.
 * We fetch 1 image, check if the ID exists in our local array, and retry if so.
 */
async function fetchUniqueCat(maxRetries = 6) {
    const apiKey = appState.settings.apiKey.trim();
    const headers = {};
    if (apiKey) headers['x-api-key'] = apiKey; // API Key prevents rate-limiting if user adds one

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Await pauses the function execution until the network request finishes
            const response = await fetch('https://api.thecatapi.com/v1/images/search?limit=1', { headers });
            if (!response.ok) throw new Error('Network error from CatAPI');

            // Parse the response body into JSON
            const data = await response.json();
            if (!data || !data.length) continue;

            const catData = data[0]; // The Cat API returns an array, we want index 0

            // Array.some() returns true if ANY element passes the condition
            const exists = appState.collection.some(c => c.id === catData.id);

            if (!exists && catData.url) {
                return catData; // Success! Return the unique cat object and break the loop
            }
            console.info(`Duplicate Cat ID ${catData.id} encountered. Retrying (${attempt + 1}/${maxRetries})...`);
        } catch (err) {
            console.warn('API error, retrying...', err);
        }
    }

    // FALLBACK: If API is down or we hit rate limits, we use cataas (Cat As A Service) 
    // to provide a random image so the user still gets their chest reward.
    const randomFallbackId = 'cat_offline_' + Math.random().toString(36).substr(2, 6);
    return {
        id: randomFallbackId,
        url: `https://cataas.com/cat?random=${Date.now()}`
    };
}

/**
 * Triggers the unboxing sequence.
 * Async because we have to wait for fetchUniqueCat() to finish.
 */
async function openChest(tier) {
    if (appState.chests[tier] <= 0) return; // Guard clause against exploiting

    // 1. Consume chest internally
    appState.chests[tier]--;
    appState.stats.openedChestsCount[tier]++;
    saveState();

    // Update dashboard so chest counts visually drop immediately
    renderChests();
    renderDashboard();

    // 2. Show the loading spinner in the modal
    document.getElementById('unboxingSpinner').classList.remove('d-none');
    document.getElementById('unboxingResult').classList.add('d-none');
    chestRevealModalInstance.show();

    playBeep(440, 'sawtooth', 0.2); // Suspense beep

    try {
        // 3. Pause here and wait for the network request
        const uniqueCat = await fetchUniqueCat();
        const rarity = rollRarity(tier);

        // 4. Construct the save object
        const savedCat = {
            id: uniqueCat.id,
            url: uniqueCat.url,
            rarity: rarity,
            date: new Date().toLocaleDateString(),
            customName: ''
        };

        // unshift() adds the new element to the FRONT of the array (index 0)
        // This ensures the newest cats show up first on the dashboard.
        appState.collection.unshift(savedCat);
        saveState();

        // 5. Inject the downloaded image into the modal HTML
        const imgEl = document.getElementById('revealCatImage');
        imgEl.src = savedCat.url;

        // Remove and re-add animation class to trigger bounce CSS
        imgEl.classList.remove('chest-opening-celebration');
        void imgEl.offsetWidth; // DOM reflow hack to restart CSS animation
        imgEl.classList.add('chest-opening-celebration');

        // Style the rarity badge dynamically
        const badge = document.getElementById('catRarityBadge');
        badge.textContent = rarity;
        badge.className = `badge mb-2 px-3 py-1 fs-6 text-uppercase fw-bold badge-${rarity}`;

        document.getElementById('catRevealId').textContent = `ID: ${savedCat.id}`;
        document.getElementById('catRevealDate').textContent = `Discovered: ${savedCat.date}`;

        // 6. Set a visual delay so the spinner is on screen for at least 0.6s
        // Otherwise fast internet makes it flash instantly, ruining the suspense
        setTimeout(() => {
            document.getElementById('unboxingSpinner').classList.add('d-none');
            document.getElementById('unboxingResult').classList.remove('d-none');

            // Higher pitch for Legendary
            playBeep(rarity === 'Legendary' ? 880 : 587, 'sine', 0.4);
        }, 600);

    } catch (error) {
        alert('Failed to connect to Cat API. Please verify internet connection.');
        chestRevealModalInstance.hide();
    }
}

// --- 8. RENDERING FUNCTIONS ---
// These functions read data from appState and construct dynamic HTML strings,
// then inject them into containers via innerHTML.

function renderAllViews() {
    renderDashboard();
    renderTasks();
    renderSchedule();
    renderChests();
    renderCollection();
    renderStats();
    renderSettings();
}

function renderDashboard() {
    document.getElementById('dashStudyMinutes').textContent = `${appState.stats.minutesStudiedToday} / ${appState.settings.dailyGoalMinutes} min`;

    // Calculate percentage (max 100%)
    const pct = Math.min(100, Math.round((appState.stats.minutesStudiedToday / appState.settings.dailyGoalMinutes) * 100));
    const progressBar = document.getElementById('dashGoalProgress');
    progressBar.style.width = `${pct}%`;

    // Visual reward when daily goal is reached
    if (pct >= 100) {
        progressBar.classList.add('goal-complete-glow');
        document.getElementById('dashStudyMinutes').classList.add('text-success');
    } else {
        progressBar.classList.remove('goal-complete-glow');
        document.getElementById('dashStudyMinutes').classList.remove('text-success');
    }

    document.getElementById('dashStreakText').textContent = `🔥 ${appState.stats.streakDays}-day study streak`;

    // Array.reduce() sums up values. We extract the numbers from the object and add them together.
    const totalChests = Object.values(appState.chests).reduce((accumulator, current) => accumulator + current, 0);

    document.getElementById('dashChestCount').textContent = `${totalChests} Unopened`;
    document.getElementById('dashCatCount').textContent = `${appState.collection.length} Collected`;

    // Navigation Badge in header
    const navBadge = document.getElementById('navChestBadge');
    if (totalChests > 0) {
        navBadge.textContent = totalChests;
        navBadge.classList.remove('d-none');
    } else {
        navBadge.classList.add('d-none');
    }

    // Dashboard Priority Tasks (Filters out completed tasks, then takes only the first 5 via slice)
    const taskList = document.getElementById('dashTaskList');
    taskList.innerHTML = '';
    const pendingTasks = appState.tasks.filter(t => !t.completed).slice(0, 5);

    if (pendingTasks.length === 0) {
        taskList.innerHTML = '<div class="text-secondary text-center py-4">No priority tasks today. Relax or add a new one!</div>';
    } else {
        pendingTasks.forEach(task => {
            const el = document.createElement('div');
            // Adding dynamic CSS classes based on state
            el.className = `d-flex justify-content-between align-items-center p-2 rounded bg-dark border border-secondary ${!task.completed ? 'task-completed-glow' : ''}`;
            el.innerHTML = `
        <div>
          <div class="fw-semibold">${escapeHtml(task.title)}</div>
          <span class="badge bg-secondary-subtle text-secondary small">${escapeHtml(task.subject)}</span>
          <span class="badge bg-dark border border-secondary text-secondary small">${task.deadline}</span>
        </div>
        <button class="btn btn-sm btn-outline-success" onclick="toggleTaskComplete('${task.id}')">
          <i class="bi bi-check-lg"></i>
        </button>
      `;
            taskList.appendChild(el);
        });
    }

    // Dashboard Recent Cats (slice(0,4) gets the 4 most recent cats)
    const recentCatsContainer = document.getElementById('dashRecentCats');
    recentCatsContainer.innerHTML = '';
    const recent = appState.collection.slice(0, 4);

    if (recent.length === 0) {
        recentCatsContainer.innerHTML = '<div class="col-12 text-secondary text-center py-4">No cats discovered yet. Open chests to unlock cats!</div>';
    } else {
        recent.forEach(cat => {
            const col = document.createElement('div');
            col.className = 'col-6';
            col.innerHTML = `
        <div class="card bg-dark border rarity-${cat.rarity} overflow-hidden cat-card-interactive" onclick="inspectCat('${cat.id}')">
          <img src="${cat.url}" class="cat-thumbnail" alt="Cat" />
          <div class="p-1 text-center small text-truncate fw-semibold" style="background: rgba(0,0,0,0.3);">
            <span class="badge badge-${cat.rarity}">${escapeHtml(cat.customName) || '✨ Unnamed'}</span>
          </div>
        </div>
      `;
            recentCatsContainer.appendChild(col);
        });
    }
}

function renderTasks() {
    const container = document.getElementById('taskListGrid');
    const filter = document.getElementById('taskCategoryFilter').value;
    container.innerHTML = '';

    let list = appState.tasks;
    // Apply dropdown filter logic
    if (filter !== 'all') {
        list = list.filter(t => t.type === filter);
    }

    if (list.length === 0) {
        container.innerHTML = `<div class="col-12 text-center text-secondary py-5">No tasks found. Click "Add Task" to start earning chests.</div>`;
        return;
    }

    // Build the grid of card HTML
    list.forEach(task => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';

        // Notice the ternary operators (? :) used for dynamic CSS (opacity-50 if completed)
        col.innerHTML = `
      <div class="card bg-dark-card border-secondary h-100 ${task.completed ? 'opacity-50' : ''}">
        <div class="card-body d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="badge bg-secondary-subtle text-light">${escapeHtml(task.subject)}</span>
            <span class="badge ${task.priority === 'High' ? 'bg-danger' : task.priority === 'Medium' ? 'bg-warning text-dark' : 'bg-info text-dark'}">${task.priority}</span>
          </div>
          <h5 class="card-title fw-bold ${task.completed ? 'text-decoration-line-through' : ''}">${escapeHtml(task.title)}</h5>
          <div class="small text-secondary mb-3">
            <div><i class="bi bi-clock me-1"></i> Due: ${task.deadline}</div>
            <div><i class="bi bi-gift me-1"></i> Reward: ${task.type.toUpperCase()} BOX</div>
          </div>
          <div class="mt-auto d-flex justify-content-between align-items-center pt-2 border-top border-secondary">
            <button class="btn btn-sm ${task.completed ? 'btn-secondary' : 'btn-success'}" onclick="toggleTaskComplete('${task.id}')">
              <i class="bi ${task.completed ? 'bi-arrow-counterclockwise' : 'bi-check2'}"></i> ${task.completed ? 'Completed' : 'Finish'}
            </button>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary" onclick="openCreateTaskModal('${task.id}')"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-outline-danger" onclick="deleteTask('${task.id}')"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;
        container.appendChild(col);
    });
}

function renderSchedule() {
    const container = document.getElementById('scheduleListContainer');
    container.innerHTML = '';

    if (appState.schedule.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-secondary py-5">No sessions or classes scheduled. Click "+ Schedule Event" above.</div>';
        return;
    }

    // Custom sorting logic for Days of the week
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    // spread operator [...] creates a temporary copy of the array so .sort() doesn't mutate the original
    const sorted = [...appState.schedule].sort((a, b) => daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day));

    sorted.forEach(item => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        col.innerHTML = `
      <div class="card bg-dark-card border-secondary p-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="badge bg-primary-subtle text-primary">${item.day} @ ${item.time}</span>
          <button class="btn btn-sm text-secondary p-0" onclick="deleteScheduleItem('${item.id}')"><i class="bi bi-x-circle"></i></button>
        </div>
        <h5 class="fw-bold mb-1">${escapeHtml(item.title)}</h5>
        <span class="small text-secondary">${item.type}</span>
      </div>
    `;
        container.appendChild(col);
    });
}

function renderChests() {
    const tiers = ['cardboard', 'homework', 'study', 'golden'];
    tiers.forEach(tier => {
        const count = appState.chests[tier] || 0;
        const badge = document.getElementById(`boxCount-${tier}`);
        const btn = document.getElementById(`openBtn-${tier}`);

        if (badge) badge.textContent = `${count} Available`;
        if (btn) {
            btn.disabled = count <= 0; // Disable button if empty
            if (count > 0) {
                btn.classList.add('chest-available'); // Adds CSS pulse animation
            } else {
                btn.classList.remove('chest-available');
            }
        }
    });
}

function renderCollection() {
    const grid = document.getElementById('collectionGrid');
    const filter = document.getElementById('collectionRarityFilter').value;
    grid.innerHTML = '';

    let cats = appState.collection;
    if (filter !== 'all') {
        cats = cats.filter(c => c.rarity === filter);
    }

    if (cats.length === 0) {
        grid.innerHTML = '<div class="col-12 text-center text-secondary py-5">No cats collected matching this filter. Keep studying to unlock more!</div>';
        return;
    }

    cats.forEach(cat => {
        const col = document.createElement('div');
        col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
        col.innerHTML = `
      <div class="card bg-dark-card border rarity-${cat.rarity} h-100 cat-card-interactive" onclick="inspectCat('${cat.id}')">
        <!-- loading="lazy" defers loading images off-screen to save network data -->
        <img src="${cat.url}" class="cat-thumbnail rounded-top" alt="Cat ${cat.id}" loading="lazy" />
        <div class="p-2 text-center">
          <span class="badge badge-${cat.rarity} w-100 mb-1">${cat.rarity}</span>
          <!-- Ensure HTML injection uses escapeHtml to prevent malicious script execution (XSS) if users typed script tags in the name -->
          <div class="small text-secondary font-monospace text-truncate fw-bold">${escapeHtml(cat.customName) || '✨ Unnamed'}</div>
          <div class="small text-secondary font-monospace text-truncate" style="font-size: 0.7rem;">${cat.id}</div>
        </div>
      </div>
    `;
        grid.appendChild(col);
    });
}

/** 
 * Populates and opens the large Cat Details modal overlay.
 * Also stores the active cat ID in memory so we know which one to rename/delete later.
 */
function inspectCat(catId) {
    const cat = appState.collection.find(c => c.id === catId);
    if (!cat) return;

    currentInspectingCatId = catId; // Set memory tracker

    document.getElementById('inspectTitle').textContent = `Cat ID: ${cat.id}`;
    document.getElementById('inspectImage').src = cat.url;
    document.getElementById('inspectId').textContent = `${cat.customName || 'Unnamed Cat'} | Token: ${cat.id}`;

    const rBadge = document.getElementById('inspectRarity');
    rBadge.textContent = cat.rarity;
    rBadge.className = `badge px-3 py-1 badge-${cat.rarity}`;

    document.getElementById('inspectDate').textContent = `Discovered on: ${cat.date}`;

    // Populate rename input with existing name
    const renameInput = document.getElementById('catCustomName');
    renameInput.value = cat.customName || '';
    renameInput.placeholder = 'Give your cat a custom name...';

    catInspectModalInstance.show();
}

/** 
 * Writes the input box value to the currently inspected Cat object in appState.
 */
function saveCustomCatName() {
    if (!currentInspectingCatId) return;

    // We modify the original object, not a copy
    const cat = appState.collection.find(c => c.id === currentInspectingCatId);
    if (!cat) return;

    const newName = document.getElementById('catCustomName').value.trim();

    if (newName.length > 0) {
        cat.customName = newName;
        playBeep(587.33, 'sine', 0.2);
        triggerToast(`✨ Your cat is now called "${escapeHtml(newName)}"!`);
    } else {
        cat.customName = '';
        triggerToast('Custom name removed.');
    }

    saveState();

    // Update live text in the modal without closing it
    document.getElementById('inspectId').textContent = `${cat.customName || 'Unnamed Cat'} | Token: ${cat.id}`;

    // Rerender grids in background so when modal closes, name is updated
    renderCollection();
    renderDashboard();
}

/** Deletes the inspected cat from memory forever using Array.filter() */
function removeCatFromCollection() {
    if (!currentInspectingCatId) return;

    if (!confirm('Are you sure you want to remove this cat? This cannot be undone!')) {
        return;
    }

    appState.collection = appState.collection.filter(c => c.id !== currentInspectingCatId);
    saveState();
    catInspectModalInstance.hide(); // Close modal on delete
    triggerToast('🗑️ Cat removed from collection.');
    renderCollection();
    renderDashboard();
}

/** Calculates math for the Statistics page */
function renderStats() {
    document.getElementById('statTotalMinutes').textContent = `${appState.stats.totalStudyMinutes}m`;
    document.getElementById('statCompletedTasks').textContent = appState.stats.tasksCompleted;
    document.getElementById('statCatsCount').textContent = appState.collection.length;
    document.getElementById('statStreak').textContent = `${appState.stats.streakDays} Days`;

    // Calculate percentage breakdown for Rarities
    const container = document.getElementById('rarityBreakdownContainer');
    container.innerHTML = '';
    const totalCats = appState.collection.length;
    const rarities = ['Common', 'Rare', 'Epic', 'Legendary'];

    rarities.forEach(r => {
        const count = appState.collection.filter(c => c.rarity === r).length;
        const pct = totalCats > 0 ? Math.round((count / totalCats) * 100) : 0;

        const item = document.createElement('div');
        item.innerHTML = `
      <div class="d-flex justify-content-between small mb-1">
        <span class="fw-bold">${r}</span>
        <span>${count} (${pct}%)</span>
      </div>
      <div class="progress" style="height: 8px;">
        <div class="progress-bar badge-${r}" style="width: ${pct}%"></div>
      </div>
    `;
        container.appendChild(item);
    });

    // Loop through Object.entries to render chest statistics dynamically
    const chestContainer = document.getElementById('chestBreakdownContainer');
    chestContainer.innerHTML = '';
    for (const [tier, count] of Object.entries(appState.stats.openedChestsCount)) {
        const el = document.createElement('div');
        el.className = 'd-flex justify-content-between border-bottom border-secondary py-2';
        el.innerHTML = `
      <span class="text-capitalize text-secondary">${tier} Chests Opened:</span>
      <span class="fw-bold">${count}</span>
    `;
        chestContainer.appendChild(el);
    }
}

/** Pre-fills the settings form inputs with data from appState */
function renderSettings() {
    document.getElementById('settingDailyGoal').value = appState.settings.dailyGoalMinutes;
    document.getElementById('settingApiKey').value = appState.settings.apiKey;
    document.getElementById('settingSoundToggle').checked = appState.settings.soundEnabled;
    document.getElementById('settingMusicToggle').checked = appState.settings.musicEnabled || true;
    document.getElementById('settingMusicTrack').value = appState.settings.musicTrack || './mindx-cinema/assets/study-music.mp3';
}

/** Reads the settings form inputs and pushes to appState */
function handleSaveSettings() {
    appState.settings.dailyGoalMinutes = parseInt(document.getElementById('settingDailyGoal').value, 10) || 60;
    appState.settings.apiKey = document.getElementById('settingApiKey').value.trim();
    appState.settings.soundEnabled = document.getElementById('settingSoundToggle').checked;
    appState.settings.musicEnabled = document.getElementById('settingMusicToggle').checked;
    appState.settings.musicTrack = document.getElementById('settingMusicTrack').value;

    saveState();
    triggerToast('✨ Settings successfully updated!');

    // If music is playing while they saved, restart it immediately to apply the new file
    if (isTimerRunning) {
        stopBackgroundMusic();
        playBackgroundMusic();
    }

    renderDashboard(); // Updates daily goal progress bar
}

/** Wipes the specific user's localStorage entirely */
function handleResetData() {
    if (confirm('Are you ABSOLUTELY sure? This will wipe your study streak, tasks, and cats permanently!')) {
        localStorage.removeItem(STORAGE_PREFIX + 'data_' + appState.user);
        loadUserData(appState.user); // Triggers the default template generation
        renderAllViews();
        triggerToast('⚠️ Profile data reset to default.');
    }
}

// --- UTILITIES ---

/**
 * Creates a "Toast" - a small floating notification bubble that disappears automatically.
 */
function triggerToast(msg) {
    const alertEl = document.createElement('div');
    // position-fixed bottom-0 end-0 puts it in the bottom right corner
    alertEl.className = 'position-fixed bottom-0 end-0 m-3 alert alert-primary bg-primary text-white border-0 shadow-lg';
    alertEl.style.zIndex = '9999';
    alertEl.innerHTML = `<i class="bi bi-info-circle-fill me-2"></i> ${msg}`;

    document.body.appendChild(alertEl);

    // Remove from DOM after 3.2 seconds
    setTimeout(() => alertEl.remove(), 3200);
}

/**
 * Sanitizes user input before rendering it as HTML.
 * Without this, someone typing <script>alert("hack")</script> into a task 
 * title could break the app (Cross-Site Scripting).
 */
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

/**
 * Creates 12 colorful confetti particles via DOM injection.
 * They are randomly rotated and translated across X/Y axes, then handled by CSS keyframes.
 * They auto-delete to prevent browser lag.
 */
function createConfetti(x = window.innerWidth / 2, y = window.innerHeight / 2) {
    const colors = ['#8b5cf6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];

    for (let i = 0; i < 12; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';

        // Origin point
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';

        // Randomize color and size
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.width = (Math.random() * 10 + 4) + 'px';
        particle.style.height = particle.style.width;
        particle.style.borderRadius = '50%';

        // Randomize explosion trajectory
        particle.style.transform = `
            translateX(${(Math.random() - 0.5) * 200}px)
            translateY(${(Math.random() - 0.5) * 200}px)
            rotateZ(${Math.random() * 360}deg)
        `;

        document.body.appendChild(particle);

        // CSS animation 'confettiFall' lasts 2s, so we remove the node after 2s.
        setTimeout(() => particle.remove(), 2000);
    }
}