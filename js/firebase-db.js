import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAPxckGbSh74tOdJpUnVKY3krLyBlJqHEY",
  authDomain: "thidua-pdh.firebaseapp.com",
  projectId: "thidua-pdh",
  storageBucket: "thidua-pdh.firebasestorage.app",
  messagingSenderId: "683199553309",
  appId: "1:683199553309:web:dc5a65fe37cb207581cbf4",
  measurementId: "G-X0G6G46PZ6"
};

window.__firebase_config = window.__firebase_config || firebaseConfig;
window.FirebaseSDK = { initializeApp, getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, getFirestore, doc, setDoc, getDoc, collection, onSnapshot };

function parseTimestampToMs(value) {
  if (value == null || typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function hasRealtimeDataset(state) {
  return !!(
    state &&
    ((Array.isArray(state.students) && state.students.length > 0) ||
     (Array.isArray(state.violations) && state.violations.length > 0))
  );
}

async function initFirebase() {
  const modeText = document.getElementById('system-mode-text');

  if (typeof window.loadFromLocalIndexedDB === 'function') {
    await window.loadFromLocalIndexedDB();
  }

  if (typeof window.FirebaseSDK === 'undefined' || typeof window.__firebase_config === 'undefined' || !window.__firebase_config) {
    window.isCloudMode = false;
    if (modeText) {
      modeText.innerHTML = `<span class="text-emerald-400 font-bold flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span> Chế độ Ngoại tuyến (Đã bảo vệ bằng IndexedDB)</span>`;
    }
    return;
  }

  try {
    const resolvedConfig = typeof window.__firebase_config === 'string'
      ? JSON.parse(window.__firebase_config)
      : window.__firebase_config;

    const app = window.FirebaseSDK.initializeApp(resolvedConfig);
    window.auth = window.FirebaseSDK.getAuth(app);
    window.db = window.FirebaseSDK.getFirestore(app);

    if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
      await window.FirebaseSDK.signInWithCustomToken(window.auth, window.__initial_auth_token);
    } else {
      await window.FirebaseSDK.signInAnonymously(window.auth);
    }

    if (window.authUnsubscribe) {
      window.authUnsubscribe();
    }

    window.authUnsubscribe = window.FirebaseSDK.onAuthStateChanged(window.auth, async (user) => {
      if (!user) return;
      window.userId = user.uid;
      window.isCloudMode = true;
      if (modeText) {
        modeText.innerHTML = `<span class="text-sky-400 font-bold flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-sky-500 animate-ping"></span> Chế độ Đám mây (Đang liên kết kênh: ${window.syncChannelCode})</span>`;
      }
      startRealtimeSync();
      bindRealtimeLifecycleHandlers();
    });
  } catch (err) {
    window.isCloudMode = false;
    if (modeText) {
      modeText.innerHTML = `
        <span class="text-rose-400 font-bold flex items-center gap-1 cursor-pointer" onclick="showFirebaseTroubleshoot()">
          <span data-lucide="alert-circle" class="w-4 h-4 inline"></span> Chế độ Đám mây lỗi (Bấm để xem chi tiết)
        </span>
      `;
    }
    window.lucide?.createIcons?.();
    console.warn("Firebase initialization blocked. Running local sandbox mode.", err);
  }
}

function stopRealtimeSync() {
  if (typeof window.syncUnsubscribe === 'function') {
    window.syncUnsubscribe();
  }
  window.syncUnsubscribe = null;
}

function applyRemoteState(data) {
  const remoteTs = parseTimestampToMs(data.updatedAt);
  const localTs = parseTimestampToMs(window.lastUpdatedAt);
  if (remoteTs === null || (localTs !== null && remoteTs < localTs)) return;

  window.lastUpdatedAt = data.updatedAt;
  let hasChanged = false;

  if (JSON.stringify(window.students) !== JSON.stringify(data.students || [])) {
    window.students = data.students || [];
    window.precalculateKeys?.(window.students);
    hasChanged = true;
  }
  if (JSON.stringify(window.violations) !== JSON.stringify(data.violations || [])) {
    window.violations = data.violations || [];
    hasChanged = true;
  }
  if (JSON.stringify(window.violationTypes) !== JSON.stringify(data.violationTypes || [])) {
    window.violationTypes = data.violationTypes || [];
    hasChanged = true;
  }

  const remoteLockedWeeks = (data.lockedWeeks && typeof data.lockedWeeks === 'object') ? data.lockedWeeks : {};
  if (JSON.stringify(window.lockedWeeks) !== JSON.stringify(remoteLockedWeeks)) {
    window.lockedWeeks = remoteLockedWeeks;
    hasChanged = true;
  }

  if (hasChanged) {
    window.updateStats?.();
    window.doSearch?.(document.getElementById('search-input')?.value || '');
    window.initGlobalDropdowns?.();
    window.onReportTargetChange?.();
    window.renderRules?.();
    window.renderViolationLogs?.();
    window.generateReportPreview?.();
    window.lucide?.createIcons?.();
    window.switchTab?.(window.activeTab);
    window.showToast?.('🔄 Dữ liệu rèn luyện vừa tự động đồng bộ thời gian thực!');
  }
}

function startRealtimeSync() {
  if (!window.db || !window.isCloudMode) return;
  stopRealtimeSync();

  const docRef = window.FirebaseSDK.doc(window.db, 'artifacts', window.appId, 'public', 'data', 'emulation_saves', window.syncChannelCode);

  window.syncUnsubscribe = window.FirebaseSDK.onSnapshot(docRef, async (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.updatedAt) {
        applyRemoteState(data);
      }
    } else {
      const offlineState = await window.getLocalItem?.("autosave_state_emu");
      const hasOfflineData = hasRealtimeDataset(offlineState);
      const offlineTs = parseTimestampToMs(offlineState && offlineState.updatedAt);
      if (hasOfflineData && offlineTs !== null) {
        if (!hasRealtimeDataset({ students: window.students, violations: window.violations })) {
          window.students = Array.isArray(offlineState.students) ? offlineState.students : [];
          window.violations = Array.isArray(offlineState.violations) ? offlineState.violations : [];
          window.violationTypes = Array.isArray(offlineState.violationTypes) && offlineState.violationTypes.length > 0
            ? offlineState.violationTypes
            : [...(window.defaultViolationTypes || [])];
          window.lockedWeeks = (offlineState.lockedWeeks && typeof offlineState.lockedWeeks === 'object') ? offlineState.lockedWeeks : {};
          window.precalculateKeys?.(window.students);
          window.updateStats?.();
          window.doSearch?.(document.getElementById('search-input')?.value || '');
          window.initGlobalDropdowns?.();
          window.onReportTargetChange?.();
          window.renderRules?.();
          window.renderViolationLogs?.();
          window.generateReportPreview?.();
          window.lucide?.createIcons?.();
        }
        window.lastUpdatedAt = offlineState.updatedAt;
        await window.saveAutosaveToCloud?.();
      }
    }

    const modeText = document.getElementById('system-mode-text');
    if (modeText) {
      modeText.innerHTML = `
        <span class="text-emerald-400 font-bold flex items-center gap-1.5 cursor-pointer" onclick="openQrModal()">
          <span class="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span> Chế độ Đám mây (Kênh: ${window.syncChannelCode})
        </span>
      `;
    }
    window.lucide?.createIcons?.();
  }, (err) => {
    stopRealtimeSync();
    console.error("Realtime sync channel rejected:", err);

    const modeText = document.getElementById('system-mode-text');
    if (modeText) {
      modeText.innerHTML = `
        <span class="text-rose-400 font-bold flex items-center gap-1 cursor-pointer" onclick="showFirebaseTroubleshoot()">
          <span data-lucide="alert-circle" class="w-4 h-4 inline"></span> Lỗi đồng bộ dữ liệu (Click xem)
        </span>
      `;
    }
    window.lucide?.createIcons?.();
  });
}

function bindRealtimeLifecycleHandlers() {
  if (window.isRealtimeLifecycleBound) return;
  window.isRealtimeLifecycleBound = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRealtimeSync();
      return;
    }
    if (window.isCloudMode) {
      startRealtimeSync();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopRealtimeSync();
    if (window.authUnsubscribe) {
      window.authUnsubscribe();
      window.authUnsubscribe = null;
    }
  });
}

window.FirebaseDB = {
  initFirebase,
  startRealtimeSync,
  stopRealtimeSync,
  bindRealtimeLifecycleHandlers
};

window.dispatchEvent(new Event('firebase-sdk-ready'));
window.dispatchEvent(new Event('firebase-db-ready'));
