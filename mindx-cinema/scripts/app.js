/**
 * Gamified Study & Cat Collector - Complete Application Engine
 */

// --- 1. STATE & DATA MODELS ---
const STORAGE_PREFIX = 'study_cat_app_';

const DEFAULT_STATE = {
    user: 'Scholar',
    settings: {
        dailyGoalMinutes: 60,
        apiKey: '',
        soundEnabled: true,
        musicEnabled: true,
        musicTrack: 'ambient'
    },
    stats: {
        totalStudyMinutes: 0,
        tasksCompleted: 0,
        openedChestsCount: { cardboard: 0, homework: 0, study: 0, golden: 0 },
        streakDays: 1,
        lastActiveDate: new Date().toISOString().slice(0, 10),
        minutesStudiedToday: 0
    },
    chests: {
        cardboard: 0,
        homework: 0,
        study: 0,
        golden: 0
    },
    tasks: [],
    schedule: [],
    collection: [] // Array of { id: string, url: string, rarity: string, date: string, customName: string }
};

let appState = {};
let activeTimer = null;
let timerSecondsRemaining = 25 * 60;
let isTimerRunning = false;
let sessionSecondsAccumulated = 0;

// Bootstrap Modals instances
let taskModalInstance, scheduleModalInstance, chestRevealModalInstance, catInspectModalInstance, authModalInstance;

// --- AUDIO & MUSIC CONFIGURATION ---
const STUDY_MUSIC_TRACKS = {
    disabled: { name: 'Disabled', url: null },
    ambient: {
        name: 'Ambient Focus (Looped)',
        url: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=='
    },
    piano: {
        name: 'Calm Piano (Looped)',
        url: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=='
    },
    'lo-fi': {
        name: 'Lo-Fi Study Beats (Looped)',
        url: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=='
    },
    nature: {
        name: 'Nature Sounds (Looped)',
        url: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=='
    }
};

let bgMusicPlayer = null;
let currentMusicTrack = 'ambient';
let currentInspectingCatId = null;
let audioContext = null;

/**
 * Initialize or get existing AudioContext
 */
function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

/**
 * Generate simple procedural audio for background music
 * In production, replace with actual audio files from server
 */
function generateProceduralAudio(trackType, durationSecs = 30) {
    const ctx = getAudioContext();
    const audioBuffer = ctx.createBuffer(
        2,
        ctx.sampleRate * durationSecs,
        ctx.sampleRate
    );

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);

    // Simple tone generation based on track type
    const frequencies = {
        ambient: [110, 165, 220, 165],
        piano: [261.63, 329.63, 392, 329.63],
        'lo-fi': [196, 220, 246.94, 220],
        nature: [180, 200, 220, 200]
    };

    const freqs = frequencies[trackType] || frequencies.ambient;

    for (let i = 0; i < audioBuffer.length; i++) {
        const time = i / ctx.sampleRate;
        const phaseIndex = Math.floor((time * 2) % freqs.length);
        const freq = freqs[phaseIndex];
        const phase = (time * freq * Math.PI * 2) % (Math.PI * 2);

        // Soft sine wave with envelope
        const envelope = Math.sin((time % 2) * Math.PI) * 0.15;
        const sample = Math.sin(phase) * envelope;

        left[i] = sample;
        right[i] = sample;
    }

    return audioBuffer;
}

function playBackgroundMusic() {
    if (!appState.settings.musicEnabled || appState.settings.musicTrack === 'disabled') {
        stopBackgroundMusic();
        return;
    }

    try {
        stopBackgroundMusic();
        
        const ctx = getAudioContext();
        const audioBuffer = generateProceduralAudio(appState.settings.musicTrack, 30);

        bgMusicPlayer = ctx.createBufferSource();
        bgMusicPlayer.buffer = audioBuffer;
        bgMusicPlayer.loop = true;
        bgMusicPlayer.loopStart = 0;
        bgMusicPlayer.loopEnd = audioBuffer.duration;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime);

        bgMusicPlayer.connect(gainNode);
        gainNode.connect(ctx.destination);
        bgMusicPlayer.start(0);

        updateMusicStatus('playing');
    } catch (e) {
        console.warn('Could not initialize background music:', e);
    }
}

function stopBackgroundMusic() {
    if (bgMusicPlayer) {
        try {
            bgMusicPlayer.stop();
        } catch (e) {
            console.warn('Error stopping music:', e);
        }
        bgMusicPlayer = null;
    }
    updateMusicStatus('stopped');
}

function updateMusicStatus(status) {
    let badge = document.querySelector('.music-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'music-status-badge';
        document.body.appendChild(badge);
    }

    if (status === 'playing') {
        badge.textContent = '🎵 Study music playing...';
        badge.classList.add('playing');
        badge.classList.remove('paused');
        badge.style.display = 'block';
    } else if (status === 'paused') {
        badge.textContent = '⏸ Music paused';
        badge.classList.add('paused');
        badge.classList.remove('playing');
    } else {
        badge.style.display = 'none';
    }
}

// Audio synthesized effects using Web Audio API (No external sound files required)
const playBeep = (freq = 440, type = 'sine', duration = 0.15) => {
    if (!appState.settings.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn('Audio Context not allowed without interaction yet');
    }
};

// --- 2. INITIALIZATION & AUTH ---
document.addEventListener('DOMContentLoaded', () => {
    // Init modals
    taskModalInstance = new bootstrap.Modal(document.getElementById('taskModal'));
    scheduleModalInstance = new bootstrap.Modal(document.getElementById('scheduleModal'));
    chestRevealModalInstance = new bootstrap.Modal(document.getElementById('chestRevealModal'));
    catInspectModalInstance = new bootstrap.Modal(document.getElementById('catInspectModal'));
    authModalInstance = new bootstrap.Modal(document.getElementById('authModal'));

    // Load session or default
    const activeUser = localStorage.getItem(STORAGE_PREFIX + 'active_user') || 'Scholar';
    loadUserData(activeUser);

    setupEventListeners();
    checkDailyStreakRollover();
    renderAllViews();
});

function loadUserData(username) {
    const data = localStorage.getItem(STORAGE_PREFIX + 'data_' + username);
    if (data) {
        try {
            appState = JSON.parse(data);
        } catch (e) {
            appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
            appState.user = username;
        }
    } else {
        appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
        appState.user = username;
        // Seed initial mock tasks
        appState.tasks = [
            { id: 't1', title: 'Complete Math Exercise 3.2', subject: 'Math', type: 'homework', priority: 'High', deadline: new Date().toISOString().slice(0, 10), completed: false },
            { id: 't2', title: 'Review Chemistry Flashcards', subject: 'Chemistry', type: 'small', priority: 'Medium', deadline: new Date().toISOString().slice(0, 10), completed: false }
        ];
        saveState();
    }

    localStorage.setItem(STORAGE_PREFIX + 'active_user', username);
    document.getElementById('currentUserDisplay').textContent = appState.user;
    document.getElementById('authProfileDisplay').classList.remove('d-none');
    document.getElementById('authProfileDisplay').classList.add('d-flex');
    document.getElementById('loginModalBtn').classList.add('d-none');
}

function saveState() {
    localStorage.setItem(STORAGE_PREFIX + 'data_' + appState.user, JSON.stringify(appState));
}

function checkDailyStreakRollover() {
    const today = new Date().toISOString().slice(0, 10);
    if (appState.stats.lastActiveDate !== today) {
        const last = new Date(appState.stats.lastActiveDate);
        const curr = new Date(today);
        const diffDays = Math.round((curr - last) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            appState.stats.streakDays += 1;
        } else if (diffDays > 1) {
            appState.stats.streakDays = 1;
        }
        appState.stats.minutesStudiedToday = 0;
        appState.stats.lastActiveDate = today;
        saveState();
    }
}

// --- 3. NAVIGATION (SPA VIEWS) ---
function setupEventListeners() {
    // Navigation tabs
    document.querySelectorAll('header [data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.currentTarget.getAttribute('data-view');
            switchView(view);
        });
    });

    // Task Filters
    document.getElementById('taskCategoryFilter').addEventListener('change', renderTasks);
    document.getElementById('collectionRarityFilter').addEventListener('change', renderCollection);

    // Forms
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    document.getElementById('scheduleForm').addEventListener('submit', handleScheduleSubmit);
    document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);

    // Settings
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
    document.getElementById('resetDataBtn').addEventListener('click', handleResetData);

    // Music controls
    const musicToggle = document.getElementById('settingMusicToggle');
    const musicTrack = document.getElementById('settingMusicTrack');
    if (musicToggle) {
        musicToggle.addEventListener('change', () => {
            appState.settings.musicEnabled = musicToggle.checked;
            saveState();
            musicToggle.checked ? playBackgroundMusic() : stopBackgroundMusic();
        });
    }
    if (musicTrack) {
        musicTrack.addEventListener('change', () => {
            appState.settings.musicTrack = musicTrack.value;
            saveState();
            stopBackgroundMusic();
            playBackgroundMusic();
        });
    }

    // Cat inspection modal handlers for rename
    const saveNameBtn = document.getElementById('saveCustomNameBtn');
    const removeCatBtn = document.getElementById('removeCatBtn');
    if (saveNameBtn) {
        saveNameBtn.addEventListener('click', saveCustomCatName);
    }
    if (removeCatBtn) {
        removeCatBtn.addEventListener('click', removeCatFromCollection);
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_PREFIX + 'active_user');
        location.reload();
    });

    // Timer controls
    document.getElementById('timerToggleBtn').addEventListener('click', toggleTimer);
    document.getElementById('timerResetBtn').addEventListener('click', resetTimer);
    document.getElementById('claimSessionRewardBtn').addEventListener('click', claimSessionChest);

    document.querySelectorAll('[data-timer-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-timer-type]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const type = e.currentTarget.getAttribute('data-timer-type');
            if (type === 'stopwatch') {
                timerSecondsRemaining = 0;
            } else {
                timerSecondsRemaining = parseInt(type, 10) * 60;
            }
            sessionSecondsAccumulated = 0;
            updateTimerDisplay();
            if (isTimerRunning) toggleTimer();
        });
    });
}

function switchView(viewName) {
    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('header [data-view]').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewName}`);
    const targetNavBtn = document.querySelector(`header [data-view="${viewName}"]`);

    if (targetView) targetView.classList.add('active');
    if (targetNavBtn) targetNavBtn.classList.add('active');

    // Trigger targeted renders
    if (viewName === 'stats') renderStats();
    if (viewName === 'collection') renderCollection();
    if (viewName === 'chests') renderChests();
}

// --- 4. TIMER LOGIC ---
function toggleTimer() {
    const btn = document.getElementById('timerToggleBtn');
    if (isTimerRunning) {
        clearInterval(activeTimer);
        isTimerRunning = false;
        btn.innerHTML = '<i class="bi bi-play-fill"></i> Resume';
        btn.className = 'btn btn-sm btn-success';
        stopBackgroundMusic();
        document.getElementById('timerDisplay').classList.remove('timer-active');
    } else {
        isTimerRunning = true;
        btn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause';
        btn.className = 'btn btn-sm btn-warning text-dark';
        playBackgroundMusic();
        document.getElementById('timerDisplay').classList.add('timer-active');

        activeTimer = setInterval(() => {
            sessionSecondsAccumulated++;

            // If countdown vs stopwatch
            const isStopwatch = document.querySelector('[data-timer-type="stopwatch"]').classList.contains('active');
            if (!isStopwatch) {
                if (timerSecondsRemaining > 0) {
                    timerSecondsRemaining--;
                } else {
                    // Timer finished
                    clearInterval(activeTimer);
                    isTimerRunning = false;
                    stopBackgroundMusic();
                    playBeep(880, 'triangle', 0.5);
                    alert('Study session complete! You earned rewards!');
                    recordStudyTime(Math.floor(sessionSecondsAccumulated / 60));
                    appState.chests.study++;
                    saveState();
                    renderChests();
                    renderDashboard();
                    btn.innerHTML = '<i class="bi bi-play-fill"></i> Start';
                    btn.className = 'btn btn-sm btn-success';
                    document.getElementById('timerDisplay').classList.remove('timer-active');
                    return;
                }
            } else {
                timerSecondsRemaining++;
            }

            // Check session claim threshold (at least 15 min for quick manual claim)
            if (sessionSecondsAccumulated >= 900) {
                document.getElementById('claimSessionRewardBtn').removeAttribute('disabled');
            }

            // Record 1 minute increments to state
            if (sessionSecondsAccumulated > 0 && sessionSecondsAccumulated % 60 === 0) {
                recordStudyTime(1);
            }

            updateTimerDisplay();
        }, 1000);
    }
}

function resetTimer() {
    if (isTimerRunning) toggleTimer();
    sessionSecondsAccumulated = 0;
    const activeType = document.querySelector('[data-timer-type].active').getAttribute('data-timer-type');
    timerSecondsRemaining = activeType === 'stopwatch' ? 0 : parseInt(activeType, 10) * 60;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const m = Math.floor(timerSecondsRemaining / 60).toString().padStart(2, '0');
    const s = (timerSecondsRemaining % 60).toString().padStart(2, '0');
    document.getElementById('timerDisplay').textContent = `${m}:${s}`;
}

function recordStudyTime(mins) {
    if (mins <= 0) return;
    appState.stats.totalStudyMinutes += mins;
    appState.stats.minutesStudiedToday += mins;
    saveState();
    renderDashboard();
}

function claimSessionChest() {
    if (sessionSecondsAccumulated >= 900) {
        appState.chests.study++;
        playBeep(523.25, 'sine', 0.3);
        createConfetti();
        triggerToast('🎉 Awesome focus session! 1 Study Chest added to your Chest Room.');
        sessionSecondsAccumulated = 0;
        document.getElementById('claimSessionRewardBtn').setAttribute('disabled', 'true');
        saveState();
        renderChests();
        renderDashboard();
    }
}

// --- 5. TASK MANAGEMENT ---
function openCreateTaskModal(taskId = null) {
    document.getElementById('taskForm').reset();
    document.getElementById('taskFormId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Add New Study Task';
    document.getElementById('taskDeadlineInput').value = new Date().toISOString().slice(0, 10);

    if (taskId) {
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
    taskModalInstance.show();
}

function handleTaskSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('taskFormId').value || 'task_' + Date.now();
    const title = document.getElementById('taskTitleInput').value.trim();
    const subject = document.getElementById('taskSubjectInput').value.trim();
    const deadline = document.getElementById('taskDeadlineInput').value;
    const type = document.getElementById('taskTypeInput').value;
    const priority = document.getElementById('taskPriorityInput').value;

    const existingIdx = appState.tasks.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
        appState.tasks[existingIdx] = { ...appState.tasks[existingIdx], title, subject, deadline, type, priority };
    } else {
        appState.tasks.push({ id, title, subject, deadline, type, priority, completed: false, createdAt: new Date().toISOString() });
    }

    saveState();
    taskModalInstance.hide();
    renderTasks();
    renderDashboard();
}

function toggleTaskComplete(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    if (task.completed) {
        appState.stats.tasksCompleted++;
        playBeep(659.25, 'triangle', 0.25);

        // Reward dispatch mapping
        let rewardTier = 'cardboard';
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

function deleteTask(taskId) {
    if (confirm('Delete this task?')) {
        appState.tasks = appState.tasks.filter(t => t.id !== taskId);
        saveState();
        renderTasks();
        renderDashboard();
    }
}

// --- 6. SCHEDULE MANAGEMENT ---
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
const RARITY_WEIGHTS = {
    cardboard: { Common: 0.70, Rare: 0.25, Epic: 0.05, Legendary: 0.00 },
    homework: { Common: 0.40, Rare: 0.45, Epic: 0.13, Legendary: 0.02 },
    study: { Common: 0.30, Rare: 0.45, Epic: 0.20, Legendary: 0.05 },
    golden: { Common: 0.00, Rare: 0.40, Epic: 0.45, Legendary: 0.15 }
};

function rollRarity(tier) {
    const weights = RARITY_WEIGHTS[tier] || RARITY_WEIGHTS.cardboard;
    const rand = Math.random();
    let cumulative = 0;
    for (const [rarity, chance] of Object.entries(weights)) {
        cumulative += chance;
        if (rand <= cumulative) return rarity;
    }
    return 'Common';
}

/**
 * Robust fetch for The Cat API with deduplication checks.
 * Retries if cat is already in collection.
 */
async function fetchUniqueCat(maxRetries = 6) {
    const apiKey = appState.settings.apiKey.trim();
    const headers = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch('https://api.thecatapi.com/v1/images/search?limit=1', { headers });
            if (!response.ok) throw new Error('Network error from CatAPI');
            const data = await response.json();
            if (!data || !data.length) continue;

            const catData = data[0];
            const exists = appState.collection.some(c => c.id === catData.id);
            if (!exists && catData.url) {
                return catData;
            }
            console.info(`Duplicate Cat ID ${catData.id} encountered. Retrying (${attempt + 1}/${maxRetries})...`);
        } catch (err) {
            console.warn('API error, retrying...', err);
        }
    }

    // Fallback unique object in rare case API rate-limits
    const randomFallbackId = 'cat_offline_' + Math.random().toString(36).substr(2, 6);
    return {
        id: randomFallbackId,
        url: `https://cataas.com/cat?random=${Date.now()}` // auxiliary fallback mirror
    };
}

async function openChest(tier) {
    if (appState.chests[tier] <= 0) return;

    // Consume chest
    appState.chests[tier]--;
    appState.stats.openedChestsCount[tier]++;
    saveState();
    renderChests();
    renderDashboard();

    // Show opening modal
    document.getElementById('unboxingSpinner').classList.remove('d-none');
    document.getElementById('unboxingResult').classList.add('d-none');
    chestRevealModalInstance.show();

    playBeep(440, 'sawtooth', 0.2);

    try {
        const uniqueCat = await fetchUniqueCat();
        const rarity = rollRarity(tier);

        const savedCat = {
            id: uniqueCat.id,
            url: uniqueCat.url,
            rarity: rarity,
            date: new Date().toLocaleDateString(),
            customName: ''
        };

        appState.collection.unshift(savedCat);
        saveState();

        // Display result in modal
        const imgEl = document.getElementById('revealCatImage');
        imgEl.src = savedCat.url;
        imgEl.classList.add('chest-opening-celebration');
        const badge = document.getElementById('catRarityBadge');
        badge.textContent = rarity;
        badge.className = `badge mb-2 px-3 py-1 fs-6 text-uppercase fw-bold badge-${rarity}`;

        document.getElementById('catRevealId').textContent = `ID: ${savedCat.id}`;
        document.getElementById('catRevealDate').textContent = `Discovered: ${savedCat.date}`;

        // Play fanfare based on rarity
        setTimeout(() => {
            document.getElementById('unboxingSpinner').classList.add('d-none');
            document.getElementById('unboxingResult').classList.remove('d-none');
            playBeep(rarity === 'Legendary' ? 880 : 587, 'sine', 0.4);
        }, 600);

    } catch (error) {
        alert('Failed to connect to Cat API. Please verify internet connection.');
        chestRevealModalInstance.hide();
    }
}

// --- 8. RENDERING FUNCTIONS ---
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
    const pct = Math.min(100, Math.round((appState.stats.minutesStudiedToday / appState.settings.dailyGoalMinutes) * 100));
    const progressBar = document.getElementById('dashGoalProgress');
    progressBar.style.width = `${pct}%`;
    
    // Glow when goal reached
    if (pct >= 100) {
        progressBar.classList.add('goal-complete-glow');
        document.getElementById('dashStudyMinutes').classList.add('text-success');
    } else {
        progressBar.classList.remove('goal-complete-glow');
        document.getElementById('dashStudyMinutes').classList.remove('text-success');
    }

    document.getElementById('dashStreakText').textContent = `🔥 ${appState.stats.streakDays}-day study streak`;

    const totalChests = Object.values(appState.chests).reduce((a, b) => a + b, 0);
    document.getElementById('dashChestCount').textContent = `${totalChests} Unopened`;
    document.getElementById('dashCatCount').textContent = `${appState.collection.length} Collected`;

    // Badge in header
    const navBadge = document.getElementById('navChestBadge');
    if (totalChests > 0) {
        navBadge.textContent = totalChests;
        navBadge.classList.remove('d-none');
    } else {
        navBadge.classList.add('d-none');
    }

    // Dashboard Priority Tasks
    const taskList = document.getElementById('dashTaskList');
    taskList.innerHTML = '';
    const pendingTasks = appState.tasks.filter(t => !t.completed).slice(0, 5);
    if (pendingTasks.length === 0) {
        taskList.innerHTML = '<div class="text-secondary text-center py-4">No priority tasks today. Relax or add a new one!</div>';
    } else {
        pendingTasks.forEach(task => {
            const el = document.createElement('div');
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

    // Dashboard Recent Cats
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
            <span class="badge badge-${cat.rarity}">${cat.customName || '✨ Unnamed'}</span>
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
    if (filter !== 'all') {
        list = list.filter(t => t.type === filter);
    }

    if (list.length === 0) {
        container.innerHTML = `<div class="col-12 text-center text-secondary py-5">No tasks found. Click "Add Task" to start earning chests.</div>`;
        return;
    }

    list.forEach(task => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
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

    // Sort schedule items by day
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
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
            btn.disabled = count <= 0;
            if (count > 0) {
                btn.classList.add('chest-available');
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
        <img src="${cat.url}" class="cat-thumbnail rounded-top" alt="Cat ${cat.id}" loading="lazy" />
        <div class="p-2 text-center">
          <span class="badge badge-${cat.rarity} w-100 mb-1">${cat.rarity}</span>
          <div class="small text-secondary font-monospace text-truncate fw-bold">${cat.customName || '✨ Unnamed'}</div>
          <div class="small text-secondary font-monospace text-truncate" style="font-size: 0.7rem;">${cat.id}</div>
        </div>
      </div>
    `;
        grid.appendChild(col);
    });
}

function inspectCat(catId) {
    const cat = appState.collection.find(c => c.id === catId);
    if (!cat) return;

    currentInspectingCatId = catId;

    document.getElementById('inspectTitle').textContent = `Cat ID: ${cat.id}`;
    document.getElementById('inspectImage').src = cat.url;
    document.getElementById('inspectId').textContent = `${cat.customName || 'Unnamed Cat'} | Token: ${cat.id}`;
    const rBadge = document.getElementById('inspectRarity');
    rBadge.textContent = cat.rarity;
    rBadge.className = `badge px-3 py-1 badge-${cat.rarity}`;
    document.getElementById('inspectDate').textContent = `Discovered on: ${cat.date}`;

    // Populate rename input
    const renameInput = document.getElementById('catCustomName');
    renameInput.value = cat.customName || '';
    renameInput.placeholder = 'Give your cat a custom name...';

    catInspectModalInstance.show();
}

function saveCustomCatName() {
    if (!currentInspectingCatId) return;

    const cat = appState.collection.find(c => c.id === currentInspectingCatId);
    if (!cat) return;

    const newName = document.getElementById('catCustomName').value.trim();
    if (newName.length > 0) {
        cat.customName = newName;
        playBeep(587.33, 'sine', 0.2);
        triggerToast(`✨ Your cat is now called "${newName}"!`);
    } else {
        cat.customName = '';
        triggerToast('Custom name removed.');
    }

    saveState();
    document.getElementById('inspectId').textContent = `${cat.customName || 'Unnamed Cat'} | Token: ${cat.id}`;
    renderCollection();
    renderDashboard();
}

function removeCatFromCollection() {
    if (!currentInspectingCatId) return;

    if (!confirm('Are you sure you want to remove this cat? This cannot be undone!')) {
        return;
    }

    appState.collection = appState.collection.filter(c => c.id !== currentInspectingCatId);
    saveState();
    catInspectModalInstance.hide();
    triggerToast('🗑️ Cat removed from collection.');
    renderCollection();
    renderDashboard();
}

function renderStats() {
    document.getElementById('statTotalMinutes').textContent = `${appState.stats.totalStudyMinutes}m`;
    document.getElementById('statCompletedTasks').textContent = appState.stats.tasksCompleted;
    document.getElementById('statCatsCount').textContent = appState.collection.length;
    document.getElementById('statStreak').textContent = `${appState.stats.streakDays} Days`;

    // Rarity distribution
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

    // Chests breakdown
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

function renderSettings() {
    document.getElementById('settingDailyGoal').value = appState.settings.dailyGoalMinutes;
    document.getElementById('settingApiKey').value = appState.settings.apiKey;
    document.getElementById('settingSoundToggle').checked = appState.settings.soundEnabled;
    document.getElementById('settingMusicToggle').checked = appState.settings.musicEnabled || true;
    document.getElementById('settingMusicTrack').value = appState.settings.musicTrack || 'ambient';
}

function handleSaveSettings() {
    appState.settings.dailyGoalMinutes = parseInt(document.getElementById('settingDailyGoal').value, 10) || 60;
    appState.settings.apiKey = document.getElementById('settingApiKey').value.trim();
    appState.settings.soundEnabled = document.getElementById('settingSoundToggle').checked;
    appState.settings.musicEnabled = document.getElementById('settingMusicToggle').checked;
    appState.settings.musicTrack = document.getElementById('settingMusicTrack').value;
    saveState();
    triggerToast('✨ Settings successfully updated!');
    
    // Apply music changes immediately
    if (isTimerRunning) {
        stopBackgroundMusic();
        playBackgroundMusic();
    }
    
    renderDashboard();
}

function handleResetData() {
    if (confirm('Are you ABSOLUTELY sure? This will wipe your study streak, tasks, and cats permanently!')) {
        localStorage.removeItem(STORAGE_PREFIX + 'data_' + appState.user);
        loadUserData(appState.user);
        renderAllViews();
        triggerToast('⚠️ Profile data reset to default.');
    }
}

function handleAuthSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('authUsernameInput').value.trim();
    if (!username) return;
    loadUserData(username);
    authModalInstance.hide();
    renderAllViews();
    triggerToast(`👋 Switched profile to: ${username}`);
}

// Simple Toast / Alert helper
function triggerToast(msg) {
    const alertEl = document.createElement('div');
    alertEl.className = 'position-fixed bottom-0 end-0 m-3 alert alert-primary bg-primary text-white border-0 shadow-lg';
    alertEl.style.zIndex = '9999';
    alertEl.innerHTML = `<i class="bi bi-info-circle-fill me-2"></i> ${msg}`;
    document.body.appendChild(alertEl);
    setTimeout(() => alertEl.remove(), 3200);
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// Create confetti particles for celebrations
function createConfetti(x = window.innerWidth / 2, y = window.innerHeight / 2) {
    const colors = ['#8b5cf6', '#38bdf8', '#34d399', '#fbbf24', '#fb7185'];
    for (let i = 0; i < 12; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.width = (Math.random() * 10 + 4) + 'px';
        particle.style.height = particle.style.width;
        particle.style.borderRadius = '50%';
        particle.style.transform = `
            translateX(${(Math.random() - 0.5) * 200}px)
            translateY(${(Math.random() - 0.5) * 200}px)
            rotateZ(${Math.random() * 360}deg)
        `;
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 2000);
    }
}