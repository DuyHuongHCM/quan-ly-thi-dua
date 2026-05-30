    // Default system rules/violation types 
    const defaultViolationTypes = [
      { id: 'rule_1', name: 'Đi học muộn (sau hồi trống báo)', points: 2, category: 'Chuyên cần' },
      { id: 'rule_2', name: 'Không đeo khăn quàng / Phù hiệu / Bảng tên', points: 1, category: 'Đồng phục' },
      { id: 'rule_3', name: 'Không học bài, chuẩn bị bài hoặc thiếu dụng cụ', points: 2, category: 'Học tập' },
      { id: 'rule_4', name: 'Làm việc riêng / Gây mất trật tự lớp học', points: 2, category: 'Nề nếp' },
      { id: 'rule_5', name: 'Sử dụng điện thoại không phục vụ học tập', points: 5, category: 'Nề nếp' },
      { id: 'rule_6', name: 'Nghỉ học không xin phép giáo viên', points: 5, category: 'Chuyên cần' },
      { id: 'rule_7', name: 'Vi phạm kiểu tóc / Trang phục sai quy định', points: 2, category: 'Đồng phục' },
      { id: 'rule_8', name: 'Nói bậy / Đùa nghịch thô bạo gây gổ', points: 5, category: 'Đạo đức' }
    ];
    const INITIAL_ACTIVE_TAB = 'import';

    const appState = {
      students: [],
      violations: [],
      violationTypes: [...defaultViolationTypes],
      lockedWeeks: {},
      activeTab: INITIAL_ACTIVE_TAB,
      isProgrammaticDropdownUpdate: false,
      currentGradeFilter: 0,
      currentWorkbook: null,
      currentRows: [],
      searchLimit: 40,
      filteredCache: [],
      isCloudMode: false,
      db: null,
      auth: null,
      userId: null,
      authUnsubscribe: null,
      isRealtimeLifecycleBound: false,
      confirmCallback: null,
      syncUnsubscribe: null,
      syncChannelCode: localStorage.getItem("find_hs_sync_channel") || "PDH_2026",
      activeStudentIndex: null,
      lastUpdatedAt: null
    };

    function bindStateProperty(name) {
      Object.defineProperty(window, name, {
        get() {
          return appState[name];
        },
        set(value) {
          appState[name] = value;
        },
        enumerable: false,
        configurable: true
      });
    }

    Object.keys(appState).forEach(bindStateProperty);
    window.appState = appState;
    window.defaultViolationTypes = defaultViolationTypes;

    const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
    window.appId = appId;

    // ----------------------------------------------------
    // INDEXEDDB LOCAL BACKUP ENGINE (FOR OFFLINE STABILITY)
    // ----------------------------------------------------
    const DB_NAME = "FindHS_LocalDB_Emu";
    const DB_VERSION = 1;
    const STORE_NAME = "state_store";

    function getLocalDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
    }

    async function setLocalItem(key, val) {
      try {
        const db = await getLocalDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const request = store.put(val, key);
          request.onsuccess = () => resolve();
          request.onerror = (e) => reject(e.target.error);
        });
      } catch (err) {
        console.warn("IndexedDB Write Blocked:", err);
      }
    }

    async function getLocalItem(key) {
      try {
        const db = await getLocalDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = (e) => reject(e.target.error);
        });
      } catch (err) {
        console.warn("IndexedDB Read Blocked:", err);
        return null;
      }
    }

    async function deleteLocalItem(key) {
      try {
        const db = await getLocalDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const request = store.delete(key);
          request.onsuccess = () => resolve();
          request.onerror = (e) => reject(e.target.error);
        });
      } catch (err) {
        console.warn("IndexedDB Delete Blocked:", err);
      }
    }

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

    function shouldBlockEmptyOverwrite(nextState, currentState) {
      if (!nextState || !currentState) return false;
      if (hasRealtimeDataset(nextState) || !hasRealtimeDataset(currentState)) return false;

      const currentTs = parseTimestampToMs(currentState.updatedAt);
      const nextTs = parseTimestampToMs(nextState.updatedAt);
      if (currentTs === null) return false;
      if (nextTs === null) return true;
      return currentTs > nextTs;
    }

    // Firebase initialization and realtime sync moved to js/firebase-db.js

    // Load working data from Local IndexedDB (Runs instantly offline)
    async function loadFromLocalIndexedDB() {
      try {
        const storedState = await getLocalItem("autosave_state_emu");
        if (storedState) {
          if (storedState.students && storedState.students.length > 0) {
            students = storedState.students;
            precalculateKeys(students);
          }
          if (storedState.violationTypes && storedState.violationTypes.length > 0) {
            violationTypes = storedState.violationTypes;
          }
          if (storedState.violations) {
            violations = storedState.violations;
          }
          if (storedState.lockedWeeks && typeof storedState.lockedWeeks === 'object') {
            lockedWeeks = storedState.lockedWeeks;
          }
          if (parseTimestampToMs(storedState.updatedAt) !== null) {
            appState.lastUpdatedAt = storedState.updatedAt;
          }
          
          if (storedState.status === "working") {
            const dateStr = storedState.updatedAt ? new Date(storedState.updatedAt).toLocaleTimeString('vi-VN') + ' ' + new Date(storedState.updatedAt).toLocaleDateString('vi-VN') : 'vừa qua';
            document.getElementById('incident-time').textContent = dateStr;
            document.getElementById('incident-banner').classList.remove('hidden');
          }
          
          updateStats();
          doSearch('');
          initGlobalDropdowns();
          onReportTargetChange();
          renderRules();
          renderViolationLogs();
          lucide.createIcons();
        } else {
          initGlobalDropdowns();
          renderRules();
          renderViolationLogs();
        }
      } catch (e) {
        console.error("Local recovery crashed:", e);
      }
    }

    // Load active working data from cloud
    async function loadAutosaveFromCloud() {
      // Handled inside startRealtimeSync() for live collaborative data sharing!
    }

    // Save working state to BOTH IndexedDB (Offline) & Cloud Firestore (Online)
    async function saveAutosaveToCloud(cleanExit = false) {
      const nowStr = new Date().toISOString();
      const statusValue = (students.length > 0 && !cleanExit) ? 'working' : 'idle';

      // Clean metadata before saving to avoid cyclic issues
      const cleanStudents = students.map(s => {
        const { sortKey, nameLower, nameClean, classLower, phoneClean, phone2Clean, grade, ...rest } = s;
        return rest;
      });

      const hasCurrentData = cleanStudents.length > 0 || violations.length > 0;
      const baseUpdatedAt = parseTimestampToMs(appState.lastUpdatedAt) !== null ? appState.lastUpdatedAt : nowStr;
      const nextUpdatedAt = hasCurrentData ? nowStr : baseUpdatedAt;
      const savePayload = {
        students: cleanStudents,
        violations: violations,
        violationTypes: violationTypes,
        lockedWeeks: lockedWeeks,
        updatedAt: nextUpdatedAt,
        status: statusValue
      };

      if (hasCurrentData) {
        appState.lastUpdatedAt = nextUpdatedAt;
      }

      let shouldWriteLocal = true;
      const currentLocalState = await getLocalItem("autosave_state_emu");
      if (shouldBlockEmptyOverwrite(savePayload, currentLocalState)) {
        shouldWriteLocal = false;
      }

      // 1. Always back up to local IndexedDB (Highly stable, takes 0.001s)
      if (shouldWriteLocal) {
        try {
          await setLocalItem("autosave_state_emu", savePayload);
        } catch (e) {
          console.error("Local IndexDB write failed:", e);
        }
      }

      // 2. Write to Cloud Firestore if connected (Rule 1 Strict Path - Shared public emulation room)
      if (!isCloudMode || !db) return;
      try {
        const docRef = window.FirebaseSDK.doc(db, 'artifacts', appId, 'public', 'data', 'emulation_saves', syncChannelCode);
        const docSnap = await window.FirebaseSDK.getDoc(docRef);
        if (docSnap.exists() && shouldBlockEmptyOverwrite(savePayload, docSnap.data())) {
          return;
        }
        await window.FirebaseSDK.setDoc(docRef, savePayload);
      } catch (err) {
        console.error("Cloud autosave rejected:", err);
      }
    }

    // Dismiss incident notice
    async function dismissIncidentBanner() {
      document.getElementById('incident-banner').classList.add('hidden');
      await saveAutosaveToCloud(true);
    }

    // Helper: Remove Vietnamese tones for accentless search
    function removeVietnameseTones(str) {
      if (!str) return '';
      str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a");
      str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ẽ/g,"e");
      str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i");
      str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o");
      str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u");
      str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y");
      str = str.replace(/đ/g,"d");
      str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
      str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
      str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
      str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
      str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
      str = str.replace(/Y|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
      str = str.replace(/Đ/g, "D");
      // Combining accents
      str = str.replace(/\u0300|\u0301|\u0309|\u0303|\u0323/g, ""); 
      str = str.replace(/\u02C6|\u0306|\u031B/g, ""); 
      return str;
    }

    // Advanced Vietnamese sorting helper (Sorts by Tên then Họ Đệm)
    function getVietnameseSortKey(fullName) {
      if (!fullName) return { firstName: "", lastName: "" };
      const cleaned = fullName.trim().normalize('NFC');
      const parts = cleaned.split(/\s+/);
      const firstName = parts.pop() || ""; // Tên cuối cùng
      const lastName = parts.join(" ");   // Phần họ và tên đệm
      return { firstName, lastName };
    }

    function compareVietnameseNames(a, b) {
      const compFirst = a.sortKey.firstName.localeCompare(b.sortKey.firstName, 'vi', { sensitivity: 'accent' });
      if (compFirst !== 0) return compFirst;
      return a.sortKey.lastName.localeCompare(b.sortKey.lastName, 'vi', { sensitivity: 'accent' });
    }

    // Highly optimized Batch key generator for Instant Search
    function precalculateKeys(list) {
      const len = list.length;
      for (let i = 0; i < len; i++) {
        const s = list[i];
        s.sortKey = getVietnameseSortKey(s.name);
        s.nameLower = s.name.normalize('NFC').toLowerCase();
        s.nameClean = removeVietnameseTones(s.nameLower);
        s.classLower = s.class.normalize('NFC').toLowerCase();
        s.phoneClean = String(s.phone || '').trim();
        s.phone2Clean = String(s.phone2 || '').trim();
        s.grade = getGrade(s.class);
      }
    }

    // Loader with customizable Percentage Display
    function showProgressLoader(show, percent = 0, title = "Đang xử lý dữ liệu học sinh...", subtitle = "Vui lòng đợi giây lát") {
      const overlay = document.getElementById('loading-overlay');
      const percentText = document.getElementById('loading-percent');
      const progressBar = document.getElementById('loading-progress-bar');
      const titleText = document.getElementById('loading-title');
      const subText = document.getElementById('loading-subtitle');
      
      if (show) {
        overlay.classList.remove('hidden');
        percentText.textContent = `${percent}%`;
        progressBar.style.width = `${percent}%`;
        titleText.textContent = title;
        subText.textContent = subtitle;
      } else {
        overlay.classList.add('hidden');
      }
    }

    const TOTAL_SCHOOL_WEEKS = 36;
    const WEEK_ONE_SPLIT = 18;
    const LOGS_PAGE_SIZE = 12;

    let logsHistoryExpanded = false;
    let lastLogsFilterKey = '';

    function parseDateInputValue(dateStr) {
      const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return new Date(dateStr);
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    function formatDateInputValue(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function getMondayOfWeek(date) {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dow = d.getDay();
      const shift = dow === 0 ? -6 : 1 - dow;
      d.setDate(d.getDate() + shift);
      return d;
    }

    function getSchoolYearStartDate(date) {
      const y = date.getFullYear();
      const m = date.getMonth();
      const day = date.getDate();
      const startYear = (m > 8 || (m === 8 && day >= 5)) ? y : y - 1;
      return new Date(startYear, 8, 5);
    }

    function getWeekStartDateFromWeekNumber(weekValue, baseDateStr = '') {
      const parsedWeek = parseInt(String(weekValue || ''), 10);
      const week = Math.min(TOTAL_SCHOOL_WEEKS, Math.max(1, Number.isNaN(parsedWeek) ? 1 : parsedWeek));
      const baseDate = parseDateInputValue(baseDateStr);
      const fallbackDate = new Date();
      const refDate = Number.isNaN(baseDate.getTime()) ? fallbackDate : baseDate;
      const schoolStart = getSchoolYearStartDate(refDate);
      const weekOneMonday = getMondayOfWeek(schoolStart);
      const weekStart = new Date(weekOneMonday);
      weekStart.setDate(weekOneMonday.getDate() + (week - 1) * 7);
      return weekStart;
    }

    // Populate standard dropdown selector options
    function initGlobalDropdowns() {
      appState.isProgrammaticDropdownUpdate = true;
      try {
        // 1. Select week dropdowns (Week 1 to Week 36)
        const selects = ['violation-week', 'log-filter-week'];
        selects.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          
          // Save initial selection if in logs
          const origVal = el.value;
          el.innerHTML = id === 'log-filter-week' ? '<option value="all">Tất cả các tuần</option>' : '';
          for (let w = 1; w <= TOTAL_SCHOOL_WEEKS; w++) {
            const opt = document.createElement('option');
            opt.value = w;
            opt.textContent = `Tuần ${w}`;
            el.appendChild(opt);
          }
          if (origVal) el.value = origVal;
        });
        syncWeekLockButtonState();

        // 2. Select rule dropdown in quick log modal
        const ruleSelect = document.getElementById('violation-type-select');
        if (ruleSelect) {
          ruleSelect.innerHTML = '';
          violationTypes.forEach(rule => {
            const opt = document.createElement('option');
            opt.value = rule.id;
            opt.textContent = `[${rule.category}] ${rule.name} (-${rule.points}đ)`;
            ruleSelect.appendChild(opt);
          });
        }
      } finally {
        appState.isProgrammaticDropdownUpdate = false;
      }
    }

    // Automatic calculation of school weeks from date
    function calculateSchoolParams(dateStr) {
      const d = parseDateInputValue(dateStr);
      if (Number.isNaN(d.getTime())) return { week: 1, month: 9, semester: 'Học kỳ I' };

      const schoolStart = getSchoolYearStartDate(d);
      const weekOneMonday = getMondayOfWeek(schoolStart);
      const targetMonday = getMondayOfWeek(d);
      const weekDiff = Math.floor((targetMonday - weekOneMonday) / (1000 * 60 * 60 * 24 * 7)) + 1;
      let week = weekDiff;
      if (week < 1) week = 1;
      if (week > TOTAL_SCHOOL_WEEKS) week = TOTAL_SCHOOL_WEEKS;

      const month = d.getMonth() + 1;
      const semester = week <= WEEK_ONE_SPLIT ? 'Học kỳ I' : 'Học kỳ II';
      return { week, month, semester };
    }

    function onViolationDateChange(val) {
      if (!val) return;
      const dateEl = document.getElementById('violation-date');
      const weekEl = document.getElementById('violation-week');
      const monthEl = document.getElementById('violation-month');
      const semesterEl = document.getElementById('violation-semester');
      if (!dateEl || !weekEl || !monthEl || !semesterEl) return;

      const selectedDate = parseDateInputValue(val);
      if (!Number.isNaN(selectedDate.getTime())) {
        const day = selectedDate.getDay();
        if (day === 0 || day === 6) {
          const selectedWeek = weekEl.value || String(calculateSchoolParams(val).week);
          const resetWeekStart = getWeekStartDateFromWeekNumber(selectedWeek, val);
          const resetDateStr = formatDateInputValue(resetWeekStart);
          dateEl.value = resetDateStr;

          const resetWeekEnd = new Date(resetWeekStart);
          resetWeekEnd.setDate(resetWeekStart.getDate() + 4);
          dateEl.min = resetDateStr;
          dateEl.max = formatDateInputValue(resetWeekEnd);

          const resetParams = calculateSchoolParams(resetDateStr);
          weekEl.value = resetParams.week;
          monthEl.value = resetParams.month;
          semesterEl.value = resetParams.semester;
          updateViolationModalLockState();
          showToast('❌ Ngày vi phạm phải nằm trong tuần học (Từ Thứ 2 đến Thứ 6)!');
          return;
        }
      }

      const params = calculateSchoolParams(val);
      weekEl.value = params.week;
      monthEl.value = params.month;
      semesterEl.value = params.semester;
      updateViolationModalLockState();
    }

    function onViolationWeekChange(weekVal) {
      if (appState.isProgrammaticDropdownUpdate) {
        // Ignore programmatic updates while dropdowns are being rebuilt from sync data.
        return;
      }
      const dateEl = document.getElementById('violation-date');
      const monthEl = document.getElementById('violation-month');
      const semesterEl = document.getElementById('violation-semester');
      const weekEl = document.getElementById('violation-week');
      if (!dateEl || !monthEl || !semesterEl || !weekEl) return;

      const weekStart = getWeekStartDateFromWeekNumber(weekVal, dateEl.value);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 4);
      const weekDateStr = formatDateInputValue(weekStart);
      const weekEndStr = formatDateInputValue(weekEnd);
      dateEl.min = weekDateStr;
      dateEl.max = weekEndStr;
      dateEl.value = weekDateStr;

      const params = calculateSchoolParams(weekDateStr);
      weekEl.value = params.week;
      monthEl.value = params.month;
      semesterEl.value = params.semester;
      updateViolationModalLockState();
    }

    function normalizeWeekValue(weekVal) {
      const parsedWeek = parseInt(String(weekVal ?? ''), 10);
      return Number.isNaN(parsedWeek) ? '' : String(parsedWeek);
    }

    function isWeekLocked(weekVal) {
      const normalized = normalizeWeekValue(weekVal);
      return !!(normalized && lockedWeeks && lockedWeeks[normalized]);
    }

    function ensureWeekUnlocked(weekVal, messagePrefix = 'Không thể thao tác') {
      const normalizedWeek = normalizeWeekValue(weekVal);
      if (!isWeekLocked(normalizedWeek)) return true;
      showToast(`🔒 Tuần ${normalizedWeek} đã khóa sổ thi đua. ${messagePrefix}.`);
      return false;
    }

    function getCurrentSchoolWeek() {
      const localDate = new Date();
      const tzOffset = localDate.getTimezoneOffset() * 60000;
      const localToday = new Date(localDate.getTime() - tzOffset);
      return String(calculateSchoolParams(localToday.toISOString().split('T')[0]).week);
    }

    function syncWeekLockButtonState() {
      const btn = document.getElementById('lock-week-btn');
      const txt = document.getElementById('lock-week-btn-text');
      const filterWeek = document.getElementById('log-filter-week');
      if (!btn || !txt || !filterWeek) return;

      const week = normalizeWeekValue(filterWeek.value);
      if (!week) {
        btn.disabled = true;
        btn.className = 'bg-slate-600 text-slate-300 px-3 py-1.5 rounded text-xs font-bold shadow cursor-not-allowed flex items-center gap-1.5';
        txt.textContent = 'Chọn tuần để khóa';
        return;
      }

      const locked = isWeekLocked(week);
      btn.disabled = false;
      btn.className = locked
        ? 'bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition active:scale-95 flex items-center gap-1.5'
        : 'bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-bold shadow transition active:scale-95 flex items-center gap-1.5';
      txt.textContent = locked ? `Mở khóa Tuần ${week}` : `Khóa Tuần ${week}`;
    }

    function updateViolationModalLockState() {
      const weekEl = document.getElementById('violation-week');
      const saveBtn = document.getElementById('violation-save-btn');
      const warningEl = document.getElementById('violation-lock-warning');
      if (!weekEl || !saveBtn || !warningEl) return;

      const locked = isWeekLocked(weekEl.value);
      saveBtn.disabled = locked;
      warningEl.classList.toggle('hidden', !locked);
    }

    async function toggleWeekLock() {
      const filterWeek = document.getElementById('log-filter-week').value;
      const week = normalizeWeekValue(filterWeek);
      if (!week) {
        showToast('❌ Vui lòng chọn tuần cụ thể trước khi khóa sổ!');
        return;
      }

      const nextLockedWeeks = { ...lockedWeeks };
      if (nextLockedWeeks[week]) {
        delete nextLockedWeeks[week];
        lockedWeeks = nextLockedWeeks;
        await saveAutosaveToCloud();
        showToast(`✓ Đã mở khóa sổ thi đua Tuần ${week}.`);
      } else {
        nextLockedWeeks[week] = true;
        lockedWeeks = nextLockedWeeks;
        await saveAutosaveToCloud();
        showToast(`🔒 Đã khóa sổ thi đua Tuần ${week}.`);
      }

      syncWeekLockButtonState();
      updateViolationModalLockState();
      renderViolationLogs();
    }

    // Populate dummy emulation state
    function loadSampleData() {
      showProgressLoader(true, 10, "Đang tải dữ liệu mẫu...", "Thiết lập danh sách học sinh");
      
      setTimeout(() => {
        showProgressLoader(true, 40, "Đang tạo lập đối tượng mẫu...", "Thiết lập 12 học sinh chuẩn ban đầu");
        students = [
          { name: 'Nguyễn Thành Long', class: '6A1', gender: 'Nam', birthYear: '2014', phone: '0987123456', phone2: '0901234501', boarding: 'Có' },
          { name: 'Trần Thị Thảo', class: '6A2', gender: 'Nữ', birthYear: '2014', phone: '0912345678', phone2: '0901234502', boarding: 'Không' },
          { name: 'Lê Hoàng Minh', class: '7B1', gender: 'Nam', birthYear: '2013', phone: '0901234567', phone2: '0901234503', boarding: 'Có' },
          { name: 'Phạm Hồng Đào', class: '7B2', gender: 'Nữ', birthYear: '2013', phone: '0868889991', phone2: '0901234504', boarding: 'Không' },
          { name: 'Vũ Quốc Bảo', class: '8C1', gender: 'Nam', birthYear: '2012', phone: '0356789123', phone2: '0901234505', boarding: 'Có' },
          { name: 'Đặng Mai Phương', class: '8C2', gender: 'Nữ', birthYear: '2012', phone: '0978665544', phone2: '0901234506', boarding: 'Có' },
          { name: 'Bùi Thế Kiệt', class: '9D1', gender: 'Nam', birthYear: '2011', phone: '0981223344', phone2: '0901234507', boarding: 'Không' },
          { name: 'Hoàng Ánh Nguyệt', class: '9D2', gender: 'Nữ', birthYear: '2011', phone: '0919887766', phone2: '0901234508', boarding: 'Có' },
          { name: 'Nguyễn Thảo Nguyên', class: '6A1', gender: 'Nữ', birthYear: '2014', phone: '0899123321', phone2: '0901234509', boarding: 'Có' },
          { name: 'Trịnh Khánh Vy', class: '7B1', gender: 'Nữ', birthYear: '2013', phone: '0344556677', phone2: '0901234510', boarding: 'Không' },
          { name: 'Đỗ Tuấn Kiệt', class: '9D1', gender: 'Nam', birthYear: '2011', phone: '0922114433', phone2: '0901234511', boarding: 'Có' },
          { name: 'Nguyễn Văn Thành', class: '6A1', gender: 'Nam', birthYear: '2014', phone: '0933556677', phone2: '0901234512', boarding: 'Không' }
        ];

        showProgressLoader(true, 70, "Tạo lập sổ tay lịch sử vi phạm mẫu...", "Tạo dựng dữ liệu thi đua minh họa");
        
        // Build mock violations for demonstration
        const today = new Date();
        const pastDate1 = new Date(today.getTime() - (2 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const pastDate2 = new Date(today.getTime() - (5 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

        violations = [
          {
            id: 'v_mock_1',
            studentName: 'Nguyễn Thành Long',
            studentClass: '6A1',
            ruleId: 'rule_1',
            ruleName: 'Đi học muộn (sau hồi trống báo)',
            points: 2,
            category: 'Chuyên cần',
            date: pastDate1,
            week: '10',
            month: '10',
            semester: 'Học kỳ I',
            note: 'Muộn 10 phút, tự kiểm điểm trước lớp'
          },
          {
            id: 'v_mock_2',
            studentName: 'Vũ Quốc Bảo',
            studentClass: '8C1',
            ruleId: 'rule_5',
            ruleName: 'Sử dụng điện thoại không phục vụ học tập',
            points: 5,
            category: 'Nề nếp',
            date: pastDate2,
            week: '10',
            month: '10',
            semester: 'Học kỳ I',
            note: 'Chơi game trong tiết Toán'
          },
          {
            id: 'v_mock_3',
            studentName: 'Lê Hoàng Minh',
            studentClass: '7B1',
            ruleId: 'rule_3',
            ruleName: 'Không học bài, chuẩn bị bài hoặc thiếu dụng cụ',
            points: 2,
            category: 'Học tập',
            date: pastDate1,
            week: '10',
            month: '10',
            semester: 'Học kỳ I',
            note: 'Không soạn văn'
          },
          {
            id: 'v_mock_4',
            studentName: 'Nguyễn Thảo Nguyên',
            studentClass: '6A1',
            ruleId: 'rule_2',
            ruleName: 'Không đeo khăn quàng / Phù hiệu / Bảng tên',
            points: 1,
            category: 'Đồng phục',
            date: pastDate1,
            week: '11',
            month: '10',
            semester: 'Học kỳ I',
            note: 'Quên đeo thẻ học sinh'
          }
        ];
        lockedWeeks = {};

        precalculateKeys(students);
        
        setTimeout(async () => {
          const status = document.getElementById('import-status');
          status.classList.remove('hidden');
          status.innerHTML = `<span data-lucide="check" class="w-4 h-4 text-emerald-400"></span> Đã tải thành công <strong>${students.length} học sinh mẫu</strong> & <strong>${violations.length} kỷ luật thi đua mẫu</strong>!`;
          
          await saveAutosaveToCloud();
          showPreview(true);
          updateStats();
          doSearch('');
          initGlobalDropdowns();
          onReportTargetChange();
          renderRules();
          renderViolationLogs();
          showProgressLoader(false);
          lucide.createIcons();
          showToast('✓ Đã tải dữ liệu mẫu thành công!');
        }, 150);
      }, 200);
    }

    // Manual Download Backup of whole state as JSON file
    function downloadBackup() {
      if (students.length === 0 && violations.length === 0) {
        showToast('❌ Không có dữ liệu để thực hiện sao lưu!');
        return;
      }
      try {
        const backupData = {
          app: "Find_HS_Boarding_Emulation",
          version: "3.0",
          backupDate: new Date().toISOString(),
          students: students.map(s => {
            const { sortKey, nameLower, nameClean, classLower, phoneClean, phone2Clean, grade, ...rest } = s;
            return rest;
          }),
          violations: violations,
          violationTypes: violationTypes,
          lockedWeeks: lockedWeeks
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backup_QuanLyThiDua_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✓ Tải file Sao lưu (.json) thành công!');
      } catch (e) {
        showToast('❌ Lỗi khi đóng gói bản sao lưu!');
      }
    }

    // Manual Upload Restore from JSON file
    function handleJsonRestore(e) {
      const file = e.target.files[0];
      if (!file) return;

      showProgressLoader(true, 10, "Đang chuẩn bị phục hồi sao lưu...", "Đọc cấu trúc tệp dữ liệu");
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (parsed) {
            showProgressLoader(true, 40, "Đang ánh xạ danh sách học sinh...", "Phân loại dữ liệu thi đua");
            
            if (Array.isArray(parsed.students)) {
              students = parsed.students;
              precalculateKeys(students);
            }
            if (Array.isArray(parsed.violationTypes)) {
              violationTypes = parsed.violationTypes;
            }
            if (Array.isArray(parsed.violations)) {
              violations = parsed.violations;
            }
            if (parsed.lockedWeeks && typeof parsed.lockedWeeks === 'object') {
              lockedWeeks = parsed.lockedWeeks;
            } else {
              lockedWeeks = {};
            }
            
            showProgressLoader(true, 80, "Đang biên dịch lại khóa tìm kiếm...", "Tối ưu hóa bộ nhớ đệm");
            
            const status = document.getElementById('import-status');
            status.classList.remove('hidden');
            status.innerHTML = `<span data-lucide="check-check" class="w-4 h-4 text-emerald-400"></span> Đã phục hồi <strong>${students.length} học sinh</strong> & <strong>${violations.length} vi phạm</strong> thành công!`;
            
            await saveAutosaveToCloud();
            showPreview(false);
            updateStats();
            doSearch('');
            initGlobalDropdowns();
            onReportTargetChange();
            renderRules();
            renderViolationLogs();
            showProgressLoader(false);
            lucide.createIcons();
            showToast('✓ Khôi phục dữ liệu sao lưu thành công!');
          } else {
            showProgressLoader(false);
            showToast('❌ Định dạng file sao lưu không hợp lệ!');
          }
        } catch (err) {
          showProgressLoader(false);
          showToast('❌ Không thể đọc file JSON!');
        }
      };
      reader.readAsText(file);
    }

    // Safe deletion prompt using custom confirm modal
    function clearAllDataPrompt() {
      showConfirm(
        'Xác nhận dọn sạch hệ thống',
        'Cảnh báo: Thao tác này sẽ xóa toàn bộ Học sinh, Lịch sử vi phạm rèn luyện hiện có trên thiết bị và Đám mây. Bạn có chắc chắn không?',
        async () => {
          await clearData();
        }
      );
    }

    // Function to empty/clear all current student data safely
    async function clearData() {
      students = [];
      violations = [];
      lockedWeeks = {};
      currentWorkbook = null;
      currentRows = [];
      
      // Reset file inputs
      const fileInput = document.getElementById('file-input');
      if (fileInput) fileInput.value = '';
      const backupInput = document.getElementById('backup-input');
      if (backupInput) backupInput.value = '';
      
      // Hide mapping, preview & status sections
      document.getElementById('import-status').classList.add('hidden');
      document.getElementById('mapping-card').classList.add('hidden');
      document.getElementById('preview-section').classList.add('hidden');
      
      // Delete IndexedDB store
      try {
        await deleteLocalItem("autosave_state_emu");
      } catch (e) {
        console.warn(e);
      }

      await saveAutosaveToCloud(true); // Save with Clean status
      
      // Trigger GUI updates
      updateStats();
      doSearch('');
      initGlobalDropdowns();
      onReportTargetChange();
      renderViolationLogs();
      
      showToast('✓ Đã dọn sạch dữ liệu! Bạn có thể nạp file mới.');
    }

    function switchTab(tab) {
      appState.activeTab = tab;
      ['import','search','rules','logs','report'].forEach(t => {
        document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
          btn.classList.toggle('bg-indigo-600', t === tab);
          btn.classList.toggle('text-white', t === tab);
          btn.classList.toggle('font-bold', t === tab);
          btn.classList.toggle('bg-slate-900/50', t !== tab);
          btn.classList.toggle('text-slate-300', t !== tab);
          btn.classList.toggle('font-medium', t !== tab);
        }
      });
      if (tab === 'report') {
        updateStats();
        onReportTargetChange();
      }
      if (tab === 'search') {
        currentGradeFilter = 0;
        document.getElementById('search-input').value = '';
        updateFilterButtons();
        doSearch('');
      }
      if (tab === 'rules') {
        renderRules();
      }
      if (tab === 'logs') {
        renderViolationLogs();
      }
    }

    // Load file and expose Sheets
    function handleFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      showProgressLoader(true, 10, "Đang kết nối tệp Excel...", "Đang phân tích cấu trúc cột");
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          currentWorkbook = wb;
          
          const sheetSelector = document.getElementById('sheet-selector');
          sheetSelector.innerHTML = '';
          
          wb.SheetNames.forEach(sheetName => {
            const opt = document.createElement('option');
            opt.value = sheetName;
            opt.textContent = sheetName;
            sheetSelector.appendChild(opt);
          });
          
          document.getElementById('mapping-card').classList.remove('hidden');
          onSheetSelected();
          showProgressLoader(false);
          showToast('✓ Đọc tệp Excel thành công!');
        } catch (err) {
          showProgressLoader(false);
          showToast('❌ Lỗi định dạng tệp Excel không hợp lệ!');
          console.error(err);
        }
      };
      reader.readAsBinaryString(file);
    }

    // Triggered when selected sheet changes
    function onSheetSelected() {
      if (!currentWorkbook) return;
      const sheetSelector = document.getElementById('sheet-selector');
      const ws = currentWorkbook.Sheets[sheetSelector.value];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      currentRows = rows;
      if (rows.length === 0) {
        showToast('⚠ Sheet đã chọn không chứa bất kỳ dữ liệu nào!');
        return;
      }
      
      const headers = rows[0] || [];
      const mappingSelects = ['map-name', 'map-class', 'map-gender', 'map-birth', 'map-phone', 'map-phone2', 'map-boarding'];
      
      // Setup options
      mappingSelects.forEach(selId => {
        const sel = document.getElementById(selId);
        sel.innerHTML = '<option value="-1">-- Không có / Bỏ qua --</option>';
        headers.forEach((h, idx) => {
          const option = document.createElement('option');
          option.value = idx;
          option.textContent = `Cột ${getColumnName(idx)}: "${String(h).trim()}"`;
          sel.appendChild(option);
        });
      });

      // Smart Matching Column Title Predictor
      autoGuessColumns(headers);
    }

    function getColumnName(index) {
      let label = "";
      while (index >= 0) {
        label = String.fromCharCode((index % 26) + 65) + label;
        index = Math.floor(index / 26) - 1;
      }
      return label;
    }

    // Auto smart predictor
    function autoGuessColumns(headers) {
      const mappings = {
        'map-name': ['tên', 'họ tên', 'hoten', 'ho ten', 'name', 'học sinh', 'hoc sinh', 'fullname'],
        'map-class': ['lớp', 'lop', 'class', 'mã lớp', 'malop'],
        'map-gender': ['giới tính', 'gioitinh', 'gioi tinh', 'nam/nữ', 'nam/nu', 'gender', 'phái', 'phai'],
        'map-birth': ['năm sinh', 'nam sinh', 'namsinh', 'birth', 'ngày sinh', 'ngay sinh', 'yob'],
        'map-phone': ['sđt', 'sdt', 'điện thoại', 'dien thoai', 'phone', 'liên hệ', 'tel', 'sđt 1', 'sđt chính'],
        'map-phone2': ['sđt 2', 'sđt dự phòng', 'sđt dp', 'điện thoại dự phòng', 'phone 2', 'sđt phụ', 'sdt2'],
        'map-boarding': ['bán trú', 'ban tru', 'boarding', 'đăng ký bán trú', 'ăn bán trú', 'bantru']
      };

      for (let key in mappings) {
        const sel = document.getElementById(key);
        let foundIdx = -1;
        
        for (let i = 0; i < headers.length; i++) {
          const title = String(headers[i] || '').toLowerCase().trim();
          if (mappings[key].some(keyword => title.includes(keyword))) {
            foundIdx = i;
            break;
          }
        }
        
        if (foundIdx !== -1) {
          sel.value = foundIdx;
        } else {
          // Defaults
          if (key === 'map-name') sel.value = 0;
          else if (key === 'map-class') sel.value = 1;
          else if (key === 'map-gender') sel.value = 2;
          else if (key === 'map-birth') sel.value = 3;
          else if (key === 'map-phone') sel.value = 4;
          else if (key === 'map-phone2') sel.value = -1; 
          else if (key === 'map-boarding') sel.value = -1; 
        }
      }
    }

    // Map Column to Student Array (Chunked Importer)
    function confirmImport() {
      if (currentRows.length < 2) {
        showToast('⚠ Dữ liệu quá ngắn để phân tích!');
        return;
      }

      const mapName = parseInt(document.getElementById('map-name').value);
      const mapClass = parseInt(document.getElementById('map-class').value);
      const mapGender = parseInt(document.getElementById('map-gender').value);
      const mapBirth = parseInt(document.getElementById('map-birth').value);
      const mapPhone = parseInt(document.getElementById('map-phone').value);
      const mapPhone2 = parseInt(document.getElementById('map-phone2').value);
      const mapBoarding = parseInt(document.getElementById('map-boarding').value);

      if (mapName === -1 || mapClass === -1) {
        showToast('❌ Bắt buộc phải ánh xạ cột "Họ và tên" và "Lớp học"!');
        return;
      }

      students = [];
      const totalRows = currentRows.length - 1;
      let currentIndex = 1;
      const chunkSize = 200; 

      showProgressLoader(true, 0, "Bắt đầu phân tích Excel...", `Tổng số hàng: ${totalRows}`);

      function importChunk() {
        const endLimit = Math.min(currentIndex + chunkSize, currentRows.length);
        
        for (let i = currentIndex; i < endLimit; i++) {
          const r = currentRows[i];
          if (!r || r.length === 0) continue;
          
          const name = mapName !== -1 && r[mapName] !== undefined ? String(r[mapName]).trim() : '';
          const cls = mapClass !== -1 && r[mapClass] !== undefined ? String(r[mapClass]).trim() : '';
          
          if (!name && !cls) continue;

          const gender = mapGender !== -1 && r[mapGender] !== undefined ? String(r[mapGender]).trim() : 'N/A';
          const birthYear = mapBirth !== -1 && r[mapBirth] !== undefined ? String(r[mapBirth]).trim() : 'N/A';
          const phone = mapPhone !== -1 && r[mapPhone] !== undefined ? String(r[mapPhone]).trim() : 'N/A';
          const phone2 = mapPhone2 !== -1 && r[mapPhone2] !== undefined ? String(r[mapPhone2]).trim() : 'N/A';
          
          let boarding = 'Không';
          if (mapBoarding !== -1 && r[mapBoarding] !== undefined) {
            const rawBoarding = String(r[mapBoarding]).trim().toLowerCase();
            if (['có', 'co', 'yes', 'y', 'x', '1', 'true', 'bán trú', 'ban tru'].includes(rawBoarding)) {
              boarding = 'Có';
            } else if (rawBoarding && rawBoarding !== 'không' && rawBoarding !== 'khong' && rawBoarding !== 'no' && rawBoarding !== '0' && rawBoarding !== 'false') {
              boarding = String(r[mapBoarding]).trim();
            }
          }

          students.push({ name, class: cls, gender, birthYear, phone, phone2, boarding });
        }

        currentIndex = endLimit;
        const progressPercent = Math.round(((currentIndex - 1) / totalRows) * 100);
        
        showProgressLoader(true, progressPercent, `Đang nạp dữ liệu... (${currentIndex - 1}/${totalRows})`, `Tốc độ tối ưu hóa phân khúc tránh lag`);

        if (currentIndex < currentRows.length) {
          setTimeout(importChunk, 1);
        } else {
          showProgressLoader(true, 95, "Biên dịch chỉ mục tìm kiếm...", "Tối ưu hóa bộ nhớ đệm giúp tìm kiếm siêu tốc");
          
          setTimeout(async () => {
            precalculateKeys(students);
            
            const status = document.getElementById('import-status');
            status.classList.remove('hidden');
            status.innerHTML = `<span data-lucide="check" class="w-4 h-4 text-emerald-400"></span> Đã nạp thành công <strong>${students.length} học sinh</strong> từ file của bạn!`;
            
            await saveAutosaveToCloud();
            showPreview(false);
            updateStats();
            doSearch('');
            onReportTargetChange();
            showProgressLoader(false);
            lucide.createIcons();
            showToast('✓ Đồng bộ dữ liệu thành công!');
          }, 50);
        }
      }

      setTimeout(importChunk, 1);
    }

    function getGrade(cls) {
      const m = String(cls).match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    }

    function getClassTypePriority(className) {
      const normalized = String(className || '').toUpperCase();
      if (normalized.includes('A')) return 1; // Tăng cường tiếng Anh
      if (normalized.includes('H')) return 2; // Tăng cường tiếng Hoa
      return 3; // Lớp thường
    }

    function getClassSequenceNumber(className) {
      const nums = String(className || '').match(/\d+/g);
      if (!nums || nums.length === 0) return 0;
      const parsed = parseInt(nums[nums.length - 1], 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    function compareClassNames(aClass, bClass) {
      const priorityDiff = getClassTypePriority(aClass) - getClassTypePriority(bClass);
      if (priorityDiff !== 0) return priorityDiff;

      const gradeDiff = getGrade(aClass) - getGrade(bClass);
      if (gradeDiff !== 0) return gradeDiff;

      const seqDiff = getClassSequenceNumber(aClass) - getClassSequenceNumber(bClass);
      if (seqDiff !== 0) return seqDiff;

      return String(aClass).localeCompare(String(bClass), 'vi', { numeric: true, sensitivity: 'base' });
    }

    function compareStudentsByClassPriority(a, b) {
      const classComp = compareClassNames(a.class, b.class);
      if (classComp !== 0) return classComp;
      return compareVietnameseNames(a, b);
    }

    function calculateGenderSummary(list) {
      let male = 0;
      let female = 0;
      list.forEach(s => {
        const g = removeVietnameseTones(String(s.gender || '').trim().toLowerCase());
        if (g === 'nam') male++;
        else if (g === 'nu') female++;
      });
      return { male, female };
    }

    function gradeClass(cls) {
      const g = getGrade(cls);
      if (g === 6) return 'grade-6';
      if (g === 7) return 'grade-7';
      if (g === 8) return 'grade-8';
      if (g === 9) return 'grade-9';
      return 'bg-slate-700 text-slate-200 border-l-4 border-slate-500';
    }

    function showPreview(isSample = false) {
      const section = document.getElementById('preview-section');
      const list = document.getElementById('preview-list');
      section.classList.remove('hidden');
      
      list.innerHTML = students.slice(0, 5).map(s => `
        <div class="${gradeClass(s.class)} rounded-lg p-3 text-slate-900 shadow-md">
          <div class="font-bold truncate text-sm">${s.name}</div>
          <div class="text-xs opacity-90 mt-1">Lớp: ${s.class} | Bán trú: ${s.boarding || 'Không'}</div>
          <div class="text-2xs opacity-75 mt-0.5 truncate">SĐT 1: ${s.phone}</div>
        </div>
      `).join('');

      if (students.length > 5) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'col-span-1 md:col-span-2 lg:col-span-5 text-center py-2 bg-slate-800 rounded-lg text-slate-400 text-xs border border-slate-700';
        moreDiv.textContent = `... và ${students.length - 5} học sinh khác đã được nạp thành công.`;
        list.appendChild(moreDiv);
      }
      lucide.createIcons();
    }

    // Filtering Grades in Search
    function filterGrade(grade) {
      currentGradeFilter = grade;
      updateFilterButtons();
      doSearch(document.getElementById('search-input').value);
    }

    function updateFilterButtons() {
      for (let g of [0, 6, 7, 8, 9]) {
        const btn = document.getElementById(`filter-${g}`);
        if (!btn) continue;
        if (currentGradeFilter === g) {
          btn.classList.remove('bg-slate-800', 'text-slate-300', 'hover:bg-sky-600/30', 'hover:bg-emerald-600/30', 'hover:bg-amber-600/30', 'hover:bg-pink-600/30');
          if (g === 0) btn.classList.add('bg-indigo-600', 'text-white');
          else if (g === 6) btn.classList.add('bg-sky-600', 'text-white');
          else if (g === 7) btn.classList.add('bg-emerald-600', 'text-white');
          else if (g === 8) btn.classList.add('bg-amber-600', 'text-white');
          else if (g === 9) btn.classList.add('bg-pink-600', 'text-white');
        } else {
          btn.classList.remove('bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-pink-600', 'bg-indigo-600', 'text-white');
          btn.classList.add('bg-slate-800', 'text-slate-300');
        }
      }
    }

    // High performance accented + non-accented lookup 
    function onSearchInput(val) {
      searchLimit = 40; 
      doSearch(val);
    }

    function showMoreSearchResults() {
      searchLimit += 40; 
      doSearch(document.getElementById('search-input').value);
    }

    function doSearch(q) {
      const originalQuery = q.trim().normalize('NFC');
      const lowerQuery = originalQuery.toLowerCase();
      const toneRemovedQuery = removeVietnameseTones(lowerQuery);
      
      const fontAwesomePatch = document.getElementById('search-results');
      const count = document.getElementById('search-count');
      const loadMoreBtn = document.getElementById('search-more-container');
      
      if (students.length === 0) {
        count.innerHTML = '<span class="text-rose-400 flex items-center gap-1"><span data-lucide="info" class="w-4 h-4"></span> Hệ thống trống. Hãy nạp file Excel hoặc khôi phục sao lưu!</span>';
        fontAwesomePatch.innerHTML = '';
        loadMoreBtn.classList.add('hidden');
        lucide.createIcons();
        return;
      }

      filteredCache = students.filter(s => {
        if (!originalQuery) {
          return currentGradeFilter === 0 || s.grade === currentGradeFilter;
        }

        const matchName = s.nameLower.includes(lowerQuery) || s.nameClean.includes(toneRemovedQuery);
        const matchClass = s.classLower.includes(lowerQuery);
        const matchPhone = s.phoneClean.includes(lowerQuery) || s.phone2Clean.includes(lowerQuery);

        const matchSearch = matchName || matchClass || matchPhone;
        const matchGrade = currentGradeFilter === 0 || s.grade === currentGradeFilter;

        return matchSearch && matchGrade;
      });

      if (filteredCache.length === 0) {
        count.textContent = originalQuery ? 'Không tìm thấy học sinh phù hợp!' : 'Chọn khối để hiển thị';
        fontAwesomePatch.innerHTML = `
          <div class="col-span-full py-12 text-center text-slate-500 space-y-2">
            <span data-lucide="search-code" class="w-12 h-12 mx-auto text-slate-600"></span>
            <p class="font-semibold text-slate-400">Không tìm thấy kết quả trùng khớp với "${originalQuery}"</p>
            <p class="text-xs text-slate-500">Mẹo: Hệ thống hỗ trợ tìm kiếm không dấu lẫn có dấu tự động!</p>
          </div>
        `;
        loadMoreBtn.classList.add('hidden');
        lucide.createIcons();
        return;
      }

      // Sort by custom class priority -> student name
      filteredCache.sort(compareStudentsByClassPriority);

      count.textContent = `Tìm thấy ${filteredCache.length} học sinh phù hợp`;

      const paginated = filteredCache.slice(0, searchLimit);
      
      if (filteredCache.length > searchLimit) {
        loadMoreBtn.classList.remove('hidden');
      } else {
        loadMoreBtn.classList.add('hidden');
      }
      
      fontAwesomePatch.innerHTML = paginated.map((s) => {
        const realIdx = students.indexOf(s);
        const currentWeekLocked = isWeekLocked(getCurrentSchoolWeek());
        
        // Highlight logic
        let highlightedName = s.name;
        if (originalQuery) {
          let matchIndex = s.nameLower.indexOf(lowerQuery);
          let matchLen = lowerQuery.length;
          
          if (matchIndex === -1) {
            matchIndex = s.nameClean.indexOf(toneRemovedQuery);
            matchLen = toneRemovedQuery.length;
          }

          if (matchIndex !== -1) {
            const rawMatch = s.name.substr(matchIndex, matchLen);
            highlightedName = s.name.substring(0, matchIndex) + 
                              `<span class="bg-yellow-300 text-slate-900 rounded px-0.5 font-bold">${rawMatch}</span>` + 
                              s.name.substring(matchIndex + matchLen);
          }
        }

        // Compute total violation points deducted for this student
        const studentViolations = violations.filter(v => v.studentName === s.name && v.studentClass === s.class);
        const totalDeducted = studentViolations.reduce((sum, v) => sum + parseFloat(v.points || 0), 0);

        return `
        <div class="${gradeClass(s.class)} rounded-xl p-4 text-slate-900 transition-all hover:shadow-lg hover:scale-[1.01] flex items-center justify-between">
          <div class="flex-1 min-w-0" onclick="showDetail(${realIdx})">
            <div class="flex items-center gap-2">
              <div class="font-bold text-base truncate flex-1">${highlightedName}</div>
              ${s.boarding === 'Có' ? `<span class="bg-emerald-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">Bán Trú</span>` : ''}
              ${totalDeducted > 0 ? `<span class="bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">- ${totalDeducted}đ</span>` : ''}
            </div>
            <div class="text-xs opacity-90 mt-1.5 grid grid-cols-2 gap-y-1">
              <span>Lớp: <strong class="text-slate-950 font-bold">${s.class}</strong></span>
              <span>Giới tính: <strong>${s.gender}</strong></span>
              <span class="col-span-2 truncate">SĐT: <strong>${s.phone}</strong></span>
            </div>
          </div>
          <div class="flex flex-col gap-1 ml-2 shrink-0">
            <button onclick="openViolationModal(${realIdx})" ${currentWeekLocked ? 'disabled title="Tuần hiện tại đã khóa sổ thi đua"' : ''} class="${currentWeekLocked ? 'bg-slate-600 text-slate-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white'} px-2.5 py-1.5 rounded-lg text-2xs font-extrabold flex items-center gap-1 shadow transition active:scale-95">
              <span data-lucide="shield-alert" class="w-3.5 h-3.5"></span> Phạt lỗi
            </button>
            <button onclick="showDetail(${realIdx})" class="border border-slate-700/20 bg-slate-900/10 hover:bg-slate-900/20 text-slate-800 px-2.5 py-1.5 rounded-lg text-2xs font-bold transition active:scale-95 text-center">
              Chi tiết
            </button>
          </div>
        </div>
      `;
      }).join('');
      lucide.createIcons();
    }

    // Violation logging trigger
    function openViolationModal(idx) {
      activeStudentIndex = idx;
      const s = students[idx];
      
      document.getElementById('violation-target-name').textContent = s.name;
      document.getElementById('violation-target-class').textContent = s.class;
      
      // Khắc phục lỗi lệch ngày do múi giờ bằng cách bù giờ timezone chuẩn cục bộ
      const localDate = new Date();
      const tzOffset = localDate.getTimezoneOffset() * 60000;
      const localToday = new Date(localDate.getTime() - tzOffset);
      const todayStr = localToday.toISOString().split('T')[0];
      const currentWeek = String(calculateSchoolParams(todayStr).week);
      if (!ensureWeekUnlocked(currentWeek, 'Không thể ghi thêm vi phạm')) {
        activeStudentIndex = null;
        return;
      }
      
      document.getElementById('violation-date').value = todayStr;
      document.getElementById('violation-note').value = '';
      
      onViolationDateChange(todayStr);
      document.getElementById('violation-modal').classList.remove('hidden');
    }

    function closeViolationModal() {
      document.getElementById('violation-modal').classList.add('hidden');
      activeStudentIndex = null;
    }

    // Save student infraction
    async function saveStudentViolation() {
      if (activeStudentIndex === null) return;
      
      const s = students[activeStudentIndex];
      const ruleId = document.getElementById('violation-type-select').value;
      const rule = violationTypes.find(r => r.id === ruleId);
      
      if (!rule) {
        showToast('❌ Sai quy tắc lỗi vi phạm!');
        return;
      }

      const dateStr = document.getElementById('violation-date').value;
      if (!dateStr) {
        showToast('❌ Vui lòng nhập ngày vi phạm!');
        return;
      }

      const weekVal = document.getElementById('violation-week').value;
      if (!ensureWeekUnlocked(weekVal, 'Không thể thêm vi phạm mới')) {
        return;
      }
      const monthVal = document.getElementById('violation-month').value;
      const semVal = document.getElementById('violation-semester').value;
      const noteVal = document.getElementById('violation-note').value.trim();

      const newViolation = {
        id: 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        studentName: s.name,
        studentClass: s.class,
        ruleId: rule.id,
        ruleName: rule.name,
        points: rule.points,
        category: rule.category,
        date: dateStr,
        week: String(weekVal),
        month: String(monthVal),
        semester: semVal,
        note: noteVal
      };

      violations.push(newViolation);
      await saveAutosaveToCloud();
      
      closeViolationModal();
      showToast('✓ Đã ghi sổ vi phạm của học sinh!');
      
      // Update và đồng bộ hiển thị báo cáo in tức thì
      doSearch(document.getElementById('search-input').value);
      updateStats();
      renderViolationLogs();
      generateReportPreview();
    }

    // View detailed Student Ledger with personalized history
    function showDetail(idx) {
      const s = students[idx];
      document.getElementById('detail-modal').classList.remove('hidden');
      
      const gradeNum = s.grade || getGrade(s.class);
      const gradeColors = {
        6: 'from-sky-500 to-sky-600',
        7: 'from-emerald-500 to-emerald-600',
        8: 'from-amber-500 to-amber-600',
        9: 'from-pink-500 to-pink-600'
      };
      const gradeBg = gradeColors[gradeNum] || 'from-slate-600 to-slate-700';

      // Gather history
      const studentHist = violations.filter(v => v.studentName === s.name && v.studentClass === s.class);
      const totalPoints = studentHist.reduce((sum, v) => sum + parseFloat(v.points || 0), 0);
      const currentWeekLocked = isWeekLocked(getCurrentSchoolWeek());
      
      let historyHtml = `
        <div class="text-xs text-slate-500 italic py-4 text-center">Gương mẫu rèn luyện tốt, chưa có lỗi vi phạm.</div>
      `;
      
      if (studentHist.length > 0) {
        studentHist.sort((a,b) => new Date(b.date) - new Date(a.date));
        historyHtml = studentHist.map(v => `
          <div class="bg-slate-900/40 p-2.5 rounded border border-red-500/10 space-y-1 text-2xs">
            <div class="flex justify-between items-start">
              <span class="font-bold text-red-400 truncate">${v.ruleName}</span>
              <span class="bg-red-950/60 text-red-400 font-extrabold px-1.5 py-0.5 rounded text-[9px] shrink-0">- ${v.points}đ</span>
            </div>
            <div class="text-slate-500 flex justify-between">
              <span>Ngày: ${new Date(v.date).toLocaleDateString('vi-VN')} (${v.semester} - Tuần ${v.week})</span>
              <span>Chuyên đề: ${v.category}</span>
            </div>
            ${v.note ? `<div class="text-slate-400 border-l border-slate-700 pl-2 mt-1 italic">Ghi chú: ${v.note}</div>` : ''}
          </div>
        `).join('');
      }
      
      document.getElementById('detail-content').innerHTML = `
        <div class="bg-gradient-to-r ${gradeBg} rounded-xl p-5 text-white -mx-6 -mt-6 mb-4 shadow-inner">
          <div class="text-xs opacity-80 font-semibold tracking-wider uppercase">Thẻ thông tin rèn luyện học sinh</div>
          <div class="text-2xl font-bold mt-1.5 truncate">${s.name}</div>
          <div class="text-xs opacity-90 mt-1 bg-black/20 inline-block px-2.5 py-0.5 rounded-full">Khối ${gradeNum ? gradeNum : 'Khác'} - Lớp ${s.class}</div>
        </div>
        
        <div class="space-y-1.5 text-xs text-slate-300">
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2"><span data-lucide="id-card" class="w-4 h-4"></span> Lớp học</span>
            <span class="font-bold text-slate-100">${s.class}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2"><span data-lucide="user" class="w-4 h-4"></span> Giới tính</span>
            <span class="font-bold text-slate-100">${s.gender}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2"><span data-lucide="calendar" class="w-4 h-4"></span> Năm sinh</span>
            <span class="font-bold text-slate-100">${s.birthYear}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2"><span data-lucide="phone" class="w-4 h-4"></span> Số điện thoại 1</span>
            <span class="font-bold text-slate-100">${s.phone}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2 text-indigo-400"><span data-lucide="phone-call" class="w-4 h-4"></span> SĐT 2 (Dự phòng)</span>
            <span class="font-bold text-indigo-300">${s.phone2 || 'Không có'}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-slate-700/60">
            <span class="text-slate-400 flex items-center gap-2 text-emerald-400"><span data-lucide="home" class="w-4 h-4"></span> Trạng thái Bán trú</span>
            <span class="font-bold ${s.boarding === 'Có' ? 'text-emerald-400' : 'text-rose-400'}">${s.boarding || 'Không'}</span>
          </div>
          <div class="flex justify-between items-center py-2.5">
            <span class="text-slate-400 flex items-center gap-2 text-red-400"><span data-lucide="award" class="w-4 h-4"></span> Thi đua rèn luyện</span>
            <span class="font-bold text-red-400 bg-red-950/40 px-3 py-1 border border-red-500/20 rounded-lg">Tổng điểm trừ: ${totalPoints}đ</span>
          </div>
        </div>

        <!-- Scrollable Infractions ledger -->
        <div class="mt-4 pt-3 border-t border-slate-700 space-y-2">
          <div class="flex justify-between items-center">
            <h4 class="font-bold text-xs text-slate-300">Nhật ký vi phạm đã ghi nhận</h4>
            <button onclick="closeDetail(); openViolationModal(${idx});" ${currentWeekLocked ? 'disabled title="Tuần hiện tại đã khóa sổ thi đua"' : ''} class="${currentWeekLocked ? 'bg-slate-700 border-slate-600 text-slate-400 cursor-not-allowed' : 'bg-red-900/40 border border-red-500/30 hover:bg-red-800/40 text-red-300'} text-3xs font-extrabold uppercase tracking-wide px-2 py-1 rounded">
              + Ghi lỗi nhanh
            </button>
          </div>
          <div class="max-h-40 overflow-y-auto space-y-1.5 scrollbar-thin">
            ${historyHtml}
          </div>
        </div>
      `;
      lucide.createIcons();
    }

    function closeDetail() {
      document.getElementById('detail-modal').classList.add('hidden');
    }

    // ----------------------------------------------------
    // RULES MANAGEMENT PANEL ENGINE (NEW)
    // ----------------------------------------------------
    function renderRules() {
      const tbody = document.getElementById('rules-table-body');
      const badge = document.getElementById('rules-count-badge');
      
      badge.textContent = `${violationTypes.length} lỗi`;
      tbody.innerHTML = violationTypes.map(rule => `
        <tr class="hover:bg-slate-700/30">
          <td class="py-2.5 px-2">
            <span class="bg-slate-900 text-slate-400 text-3xs font-bold px-2 py-0.5 rounded border border-slate-700">${rule.category}</span>
          </td>
          <td class="py-2.5 px-2 font-semibold text-slate-100">${rule.name}</td>
          <td class="py-2.5 px-2 text-center">
            <span class="text-red-400 font-extrabold text-xs">-${rule.points}đ</span>
          </td>
          <td class="py-2.5 px-2 text-center">
            <div class="flex justify-center gap-1.5">
              <button onclick="editRulePrompt('${rule.id}')" class="p-1 rounded bg-slate-900 hover:bg-slate-700 text-sky-400 transition" title="Sửa">
                <span data-lucide="pencil" class="w-3.5 h-3.5"></span>
              </button>
              <button onclick="deleteRulePrompt('${rule.id}')" class="p-1 rounded bg-slate-900 hover:bg-rose-950/50 text-rose-500 transition" title="Xóa">
                <span data-lucide="trash" class="w-3.5 h-3.5"></span>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
      lucide.createIcons();
    }

    function editRulePrompt(id) {
      const rule = violationTypes.find(r => r.id === id);
      if (!rule) return;

      document.getElementById('edit-rule-id').value = rule.id;
      document.getElementById('rule-name-input').value = rule.name;
      document.getElementById('rule-points-input').value = rule.points;
      document.getElementById('rule-category-input').value = rule.category;

      document.getElementById('rule-form-title').innerHTML = `<span data-lucide="pencil" class="w-4 h-4 text-sky-400"></span> Hiệu chỉnh lỗi vi phạm`;
      document.getElementById('rule-cancel-btn').classList.remove('hidden');
      lucide.createIcons();
    }

    function resetRuleForm() {
      document.getElementById('edit-rule-id').value = '';
      document.getElementById('rule-name-input').value = '';
      document.getElementById('rule-points-input').value = '';
      document.getElementById('rule-category-input').value = 'Nề nếp';

      document.getElementById('rule-form-title').innerHTML = `<span data-lucide="plus-circle" class="w-4 h-4 text-emerald-400"></span> Thêm lỗi vi phạm mới`;
      document.getElementById('rule-cancel-btn').classList.add('hidden');
      lucide.createIcons();
    }

    async function saveRule() {
      const name = document.getElementById('rule-name-input').value.trim();
      const points = parseFloat(document.getElementById('rule-points-input').value);
      const category = document.getElementById('rule-category-input').value;
      const editId = document.getElementById('edit-rule-id').value;

      if (!name || isNaN(points)) {
        showToast('❌ Vui lòng nhập đầy đủ Tên lỗi và Điểm trừ!');
        return;
      }

      if (editId) {
        // Edit mode
        const ruleIdx = violationTypes.findIndex(r => r.id === editId);
        if (ruleIdx !== -1) {
          violationTypes[ruleIdx].name = name;
          violationTypes[ruleIdx].points = points;
          violationTypes[ruleIdx].category = category;
          showToast('✓ Đã cập nhật định nghĩa lỗi!');
        }
      } else {
        // Create mode
        const newRule = {
          id: 'rule_' + Date.now(),
          name: name,
          points: points,
          category: category
        };
        violationTypes.push(newRule);
        showToast('✓ Đã thêm quy chế lỗi vi phạm mới!');
      }

      await saveAutosaveToCloud();
      resetRuleForm();
      initGlobalDropdowns();
      renderRules();
      generateReportPreview();
    }

    function deleteRulePrompt(id) {
      const rule = violationTypes.find(r => r.id === id);
      if (!rule) return;

      showConfirm(
        'Xóa quy định lỗi',
        `Xóa lỗi: "${rule.name}"? Việc này không ảnh hưởng đến các vi phạm cũ đã ghi vào sổ rèn luyện.`,
        async () => {
          violationTypes = violationTypes.filter(r => r.id !== id);
          await saveAutosaveToCloud();
          initGlobalDropdowns();
          renderRules();
          generateReportPreview();
          showToast('✓ Đã xóa quy định lỗi thành công!');
        }
      );
    }

    // ----------------------------------------------------
    // VIOLATION LEDGER LOGS TAB ENGINE (NEW)
    // ----------------------------------------------------
    function buildRepeatedViolationMap(scopeViolations) {
      const repeatMap = {};
      scopeViolations.forEach(v => {
        const key = `${v.studentName}|${v.studentClass}`;
        repeatMap[key] = (repeatMap[key] || 0) + 1;
      });
      return repeatMap;
    }

    function expandViolationLogsHistory() {
      logsHistoryExpanded = true;
      renderViolationLogs();
    }

    function renderViolationLogs() {
      const tbody = document.getElementById('logs-table-body');
      const emptyView = document.getElementById('logs-empty-view');
      const historyFooter = document.getElementById('logs-history-footer');
      syncWeekLockButtonState();
      // Skip log filtering rerender when dropdown values are being set programmatically.
      if (appState.isProgrammaticDropdownUpdate) return;
      const filterWeek = document.getElementById('log-filter-week').value;
      const searchQ = document.getElementById('log-search-input').value.trim().toLowerCase();
      const normSearch = removeVietnameseTones(searchQ);
      const currentFilterKey = JSON.stringify({ filterWeek, normSearch });

      if (currentFilterKey !== lastLogsFilterKey) {
        logsHistoryExpanded = false;
        lastLogsFilterKey = currentFilterKey;
      }

      let filteredLogs = violations.filter(v => {
        const matchWeek = (filterWeek === 'all') || (v.week === filterWeek);
        const matchText = (v.studentName.toLowerCase().includes(searchQ) || 
                           v.studentClass.toLowerCase().includes(searchQ) ||
                           removeVietnameseTones(v.studentName.toLowerCase()).includes(normSearch) ||
                           v.ruleName.toLowerCase().includes(searchQ));
        return matchWeek && matchText;
      });

      // Sort by newest date
      filteredLogs.sort((a,b) => new Date(b.date) - new Date(a.date));

      if (filteredLogs.length === 0) {
        tbody.innerHTML = '';
        emptyView.classList.remove('hidden');
        historyFooter.classList.add('hidden');
        return;
      }
      emptyView.classList.add('hidden');
      const repeatedMap = buildRepeatedViolationMap(filteredLogs);
      const shouldSlice = !logsHistoryExpanded && filteredLogs.length > LOGS_PAGE_SIZE;
      const visibleLogs = shouldSlice ? filteredLogs.slice(0, LOGS_PAGE_SIZE) : filteredLogs;
      historyFooter.classList.toggle('hidden', !shouldSlice);

      tbody.innerHTML = visibleLogs.map(v => {
        const key = `${v.studentName}|${v.studentClass}`;
        const repeatedCount = repeatedMap[key] || 0;
        const isRepeated = repeatedCount >= 3;
        return `
        <tr class="hover:bg-slate-700/30 ${isRepeated ? 'bg-red-950/35' : ''}">
          <td class="py-3 px-2 text-slate-400 text-2xs font-mono">
            ${new Date(v.date).toLocaleDateString('vi-VN')}<br>
            <span class="text-indigo-400">T. ${v.week} • ${v.semester}</span>
          </td>
          <td class="py-3 px-2 font-bold text-slate-100">${v.studentName}${isRepeated ? ' <span class="text-rose-300 text-2xs">⚠️ [Tái phạm nhiều lần]</span>' : ''}</td>
          <td class="py-3 px-2 text-center">
            <span class="bg-indigo-950 text-indigo-300 font-bold px-2 py-0.5 rounded border border-indigo-900/30 text-[10px]">${v.studentClass}</span>
          </td>
          <td class="py-3 px-2 font-medium text-red-300">${v.ruleName}</td>
          <td class="py-3 px-2 text-center text-red-400 font-extrabold">-${v.points}đ</td>
          <td class="py-3 px-2 text-center">
            <span class="bg-slate-900 text-slate-400 text-3xs font-bold px-1.5 py-0.5 rounded border border-slate-700">${v.category}</span>
          </td>
          <td class="py-3 px-2 text-slate-400 italic text-2xs truncate max-w-[120px]" title="${v.note || ''}">${v.note || '-'}</td>
          <td class="py-3 px-2 text-center">
            ${
              isWeekLocked(v.week)
                ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-900/40 border border-amber-700/30 text-amber-300 text-3xs font-bold"><span data-lucide="lock" class="w-3 h-3"></span>Đã khóa</span>`
                : `<button onclick="deleteViolationLogPrompt('${v.id}')" class="p-1 rounded bg-slate-900 hover:bg-rose-950/40 text-rose-500 transition" title="Xóa ghi chép">
                    <span data-lucide="trash" class="w-3.5 h-3.5"></span>
                  </button>`
            }
          </td>
        </tr>
      `;
      }).join('');
      lucide.createIcons();
    }

    function deleteViolationLogPrompt(id) {
      showConfirm(
        'Xóa bản ghi lỗi',
        'Xóa bản ghi vi phạm này khỏi sổ rèn luyện học sinh và khôi phục điểm thi đua?',
        async () => {
          const currentLog = violations.find(v => v.id === id);
          if (currentLog && !ensureWeekUnlocked(currentLog.week, 'Không thể chỉnh sửa lịch sử')) {
            return;
          }
          violations = violations.filter(v => v.id !== id);
          await saveAutosaveToCloud();
          renderViolationLogs();
          updateStats();
          generateReportPreview(); // Làm mới hiển thị bản in
          showToast('✓ Đã xóa bản ghi vi phạm!');
        }
      );
    }

    // ----------------------------------------------------
    // ANALYTICAL STATS ENGINE
    // ----------------------------------------------------
    function updateStats() {
      const grades = [6,7,8,9];
      const colors = ['bg-sky-600','bg-emerald-600','bg-amber-600','bg-pink-600'];
      
      const statsPanel = document.getElementById('stats');
      statsPanel.innerHTML = grades.map((g,i) => {
        const c = students.filter(s => (s.grade || getGrade(s.class)) === g).length;
        return `
          <div class="${colors[i]} rounded-xl p-4 text-center hover:scale-[1.03] transition-all shadow-md">
            <div class="text-3xl font-black">${c}</div>
            <div class="text-xs opacity-90 mt-1 font-bold">Khối ${g}</div>
          </div>`;
      }).join('') + `
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-4 text-center col-span-2 md:col-span-1 hover:scale-[1.03] transition-all shadow-md">
          <div class="text-3xl font-black">${students.length}</div>
          <div class="text-xs opacity-90 mt-1 font-bold">Tổng Học Sinh</div>
        </div>`;
    }

    // Dynamic Navigation controls on report tab target selectors
    function onReportTargetChange() {
      const gradeVal = document.getElementById('report-grade-select').value;
      const classSelect = document.getElementById('report-class-select');
      classSelect.innerHTML = '<option value="all">Tất cả lớp học</option>';

      let availableClasses = [];
      students.forEach(s => {
        const g = s.grade || getGrade(s.class);
        if (gradeVal === 'all' || String(g) === gradeVal) {
          if (!availableClasses.includes(s.class)) {
            availableClasses.push(s.class);
          }
        }
      });

      availableClasses.sort(compareClassNames);
      availableClasses.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = `Lớp ${cls}`;
        classSelect.appendChild(opt);
      });

      generateReportPreview();
    }

    // Control toggles between standard vs Emulation score reports
    function onReportTypeChange() {
      const type = document.getElementById('report-type-select').value;
      document.getElementById('sub-report-students').classList.toggle('hidden', type !== 'students');
      document.getElementById('sub-report-emulation').classList.toggle('hidden', !['emulation', 'violations'].includes(type));
      
      if (type === 'emulation' || type === 'violations') {
        onEmuScopeTypeChange();
      } else {
        generateReportPreview();
      }
    }

    function getScopeViolations(scopeType, scopeValue) {
      return violations.filter(v => {
        if (scopeType === 'week') return v.week === scopeValue;
        if (scopeType === 'month') return v.month === scopeValue;
        if (scopeType === 'semester') return v.semester === scopeValue;
        if (scopeType === 'year') return true;
        return true;
      });
    }

    function getScopeLabel(scopeType, scopeValue) {
      if (scopeType === 'week') return `Tuần ${scopeValue}`;
      if (scopeType === 'month') return `Tháng ${scopeValue}`;
      if (scopeType === 'semester') return `${scopeValue}`;
      if (scopeType === 'year') return 'Cả năm';
      return scopeValue;
    }

    // Dynamic populated parameters in Emulation time frame selections
    function onEmuScopeTypeChange() {
      const scopeType = document.getElementById('emu-scope-type').value;
      const scopeValSelect = document.getElementById('emu-scope-value');
      scopeValSelect.innerHTML = '';

      if (scopeType === 'week') {
        for (let w = 1; w <= TOTAL_SCHOOL_WEEKS; w++) {
          const opt = document.createElement('option');
          opt.value = w;
          opt.textContent = `Tuần ${w}`;
          scopeValSelect.appendChild(opt);
        }
        // default to week 10 for sample data visibility
        if (violations.some(v => v.week === '10')) {
          scopeValSelect.value = '10';
        }
      } else if (scopeType === 'month') {
        for (let m = 1; m <= 12; m++) {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = `Tháng ${m}`;
          scopeValSelect.appendChild(opt);
        }
        if (violations.some(v => v.month === '10')) {
          scopeValSelect.value = '10';
        }
      } else if (scopeType === 'semester') {
        const opts = ['Học kỳ I', 'Học kỳ II'];
        opts.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          scopeValSelect.appendChild(opt);
        });
      } else if (scopeType === 'year') {
        const opt = document.createElement('option');
        opt.value = 'all';
        opt.textContent = 'Cả năm học';
        scopeValSelect.appendChild(opt);
      }

      generateReportPreview();
    }

    // High quality live visual layout preview in A4 format simulation (including Boarding & Emulations)
    function generateReportPreview() {
      const previewContainer = document.getElementById('report-preview-sheet');
      const reportType = document.getElementById('report-type-select').value;
      
      if (students.length === 0) {
        previewContainer.innerHTML = `
          <div class="text-center py-20 text-slate-400 space-y-3">
            <span data-lucide="file-spreadsheet" class="w-16 h-16 mx-auto text-slate-300"></span>
            <p class="text-sm font-semibold text-slate-500">Chưa có dữ liệu để lập báo cáo. Hãy chọn "Sử dụng dữ liệu mẫu" hoặc nạp từ tệp Excel!</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      let currentDate = new Date();
      let dateString = `Ngày ${currentDate.getDate()} tháng ${currentDate.getMonth() + 1} năm ${currentDate.getFullYear()}`;

      if (reportType === 'students') {
        // Render 1: Standard Students List
        const selectedGrade = document.getElementById('report-grade-select').value;
        const selectedClass = document.getElementById('report-class-select').value;
        const selectedBoarding = document.getElementById('report-boarding-select').value;

        let targetList = students.filter(s => {
          const g = s.grade || getGrade(s.class);
          const matchGrade = (selectedGrade === 'all') || (String(g) === selectedGrade);
          const matchClass = (selectedClass === 'all') || (s.class === selectedClass);
          
          let matchBoarding = true;
          if (selectedBoarding === 'yes') {
            matchBoarding = (s.boarding === 'Có');
          } else if (selectedBoarding === 'no') {
            matchBoarding = (s.boarding === 'Không');
          }
          
          return matchGrade && matchClass && matchBoarding;
        });

        targetList.sort(compareStudentsByClassPriority);
        const genderSummary = calculateGenderSummary(targetList);

        let titleReport = "DANH SÁCH HỌC SINH TOÀN TRƯỜNG";
        if (selectedClass !== 'all') {
          titleReport = `DANH SÁCH HỌC SINH LỚP ${selectedClass}`;
        } else if (selectedGrade !== 'all') {
          titleReport = `DANH SÁCH HỌC SINH KHỐI ${selectedGrade}`;
        }

        if (selectedBoarding === 'yes') {
          titleReport += " - ĐĂNG KÝ BÁN TRÚ";
        } else if (selectedBoarding === 'no') {
          titleReport += " - KHÔNG BÁN TRÚ";
        }

        previewContainer.innerHTML = `
          <div class="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
            <div class="text-center space-y-0.5">
              <div class="font-semibold uppercase tracking-wide text-[10px]">ỦY BAN NHÂN DÂN PHƯỜNG BÌNH TIÊN</div>
              <div class="font-bold uppercase tracking-wider text-xs text-indigo-900">TRƯỜNG THCS PHẠM ĐÌNH HỔ</div>
            </div>
            <div class="text-center space-y-0.5">
              <div class="font-bold text-[10px] text-slate-800">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div class="font-semibold text-[9px] text-slate-700 underline">Độc lập - Tự do - Hạnh phúc</div>
            </div>
          </div>

          <div class="text-center py-4">
            <h2 class="text-base font-black tracking-wide text-slate-900">${titleReport}</h2>
            <p class="text-[9px] italic text-slate-500 mt-1">Năm học: 2025 - 2026 • Tổng số: ${targetList.length} học sinh (Nam: ${genderSummary.male} / Nữ: ${genderSummary.female})</p>
          </div>

          <table class="w-full border-collapse border border-slate-400 text-[10px] text-slate-900">
            <thead>
              <tr class="bg-slate-100 text-slate-950 font-bold">
                <th class="border border-slate-400 p-2 text-center w-[5%]">STT</th>
                <th class="border border-slate-400 p-2 text-left w-[25%]">Họ và Tên</th>
                <th class="border border-slate-400 p-2 text-center w-[8%]">Lớp học</th>
                <th class="border border-slate-400 p-2 text-center w-[8%]">Giới tính</th>
                <th class="border border-slate-400 p-2 text-center w-[8%]">Năm sinh</th>
                <th class="border border-slate-400 p-2 text-center w-[18%]">SĐT liên hệ</th>
                <th class="border border-slate-400 p-2 text-center w-[18%]">SĐT dự phòng</th>
                <th class="border border-slate-400 p-2 text-center w-[10%]">Bán trú</th>
              </tr>
            </thead>
            <tbody>
              ${targetList.map((s, idx) => `
                <tr class="hover:bg-slate-50">
                  <td class="border border-slate-400 p-2 text-center font-medium">${idx + 1}</td>
                  <td class="border border-slate-400 p-2 font-bold">${s.name}</td>
                  <td class="border border-slate-400 p-2 text-center font-semibold">${s.class}</td>
                  <td class="border border-slate-400 p-2 text-center">${s.gender}</td>
                  <td class="border border-slate-400 p-2 text-center">${s.birthYear}</td>
                  <td class="border border-slate-400 p-2 text-center">${s.phone}</td>
                  <td class="border border-slate-400 p-2 text-center text-slate-700">${s.phone2 !== 'N/A' ? s.phone2 : '-'}</td>
                  <td class="border border-slate-400 p-2 text-center font-bold ${s.boarding === 'Có' ? 'text-emerald-700' : 'text-slate-400'}">${s.boarding || 'Không'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="grid grid-cols-2 pt-8 text-center text-[10px] gap-6 text-slate-900">
            <div class="space-y-1">
              <p class="font-semibold uppercase">Hiệu trưởng phê duyệt</p>
              <p class="text-[9px] text-slate-400 italic">(Ký tên và đóng dấu)</p>
              <div class="h-16"></div>
              <p class="font-bold">BAN GIÁM HIỆU</p>
            </div>
            <div class="space-y-1">
              <p class="italic text-slate-600">${dateString}</p>
              <p class="font-semibold uppercase">Người lập báo cáo</p>
              <p class="text-[9px] text-slate-400 italic">(Ký, ghi rõ họ tên)</p>
              <div class="h-16"></div>
            </div>
          </div>
        `;
      } else if (reportType === 'emulation') {
        // Render 2: Collective Class Emulation Board Score Grouped by Grade and Sorted internally (NEW)
        const scopeType = document.getElementById('emu-scope-type').value;
        const scopeValueEl = document.getElementById('emu-scope-value');
        const scopeValue = scopeValueEl ? scopeValueEl.value : '';
        
        if (!scopeValue) {
          previewContainer.innerHTML = `
            <div class="text-center py-20 text-slate-400 space-y-3">
              <span data-lucide="award" class="w-16 h-16 mx-auto text-slate-300"></span>
              <p class="text-sm font-semibold text-slate-500">Chưa có đủ thông tin hoặc mốc thời gian để kết xuất bảng thi đua.</p>
            </div>
          `;
          lucide.createIcons();
          return;
        }

        // 1. Compute list of unique classes present
        let allClasses = [...new Set(students.map(s => s.class))];
        allClasses.sort(compareClassNames);

        // 2. Filter violations inside designated scope
        const scopeViolations = getScopeViolations(scopeType, scopeValue);

        // 3. Score calculation
        let classEmuList = allClasses.map(className => {
          const classViolations = scopeViolations.filter(v => v.studentClass === className);
          const totalDeducted = classViolations.reduce((sum, v) => sum + parseFloat(v.points || 0), 0);
          const startingScore = 100;
          const finalScore = startingScore - totalDeducted;

          return {
            className,
            grade: getGrade(className),
            violationsCount: classViolations.length,
            pointsDeducted: totalDeducted,
            finalScore: finalScore,
            violationsList: classViolations
          };
        });

        // 4. Group by Grade and rank within each grade (with tie handling / standard competition ranking)
        const gradesList = [6, 7, 8, 9];
        let classEmuByGrade = { 6: [], 7: [], 8: [], 9: [], 'other': [] };

        classEmuList.forEach(item => {
          const g = item.grade;
          if (gradesList.includes(g)) {
            classEmuByGrade[g].push(item);
          } else {
            classEmuByGrade['other'].push(item);
          }
        });

        // Sort and rank inside each grade
        gradesList.concat(['other']).forEach(g => {
          if (!classEmuByGrade[g]) return;
          // Sort descending by finalScore, then ascending by class name alphabetically
          classEmuByGrade[g].sort((a, b) => b.finalScore - a.finalScore || compareClassNames(a.className, b.className));
          
          let rank = 0;
          let skipped = 1;
          let lastScore = null;
          classEmuByGrade[g].forEach((item) => {
            if (item.finalScore !== lastScore) {
              rank += skipped;
              skipped = 1;
              lastScore = item.finalScore;
            } else {
              skipped++;
            }
            item.rank = rank;
          });
        });

        // Generate rows with grade block dividers
        let tableRowsHtml = '';
        const allTargetGrades = [6, 7, 8, 9, 'other'];
        
        allTargetGrades.forEach(g => {
          const list = classEmuByGrade[g];
          if (!list || list.length === 0) return;
          
          const titleLabel = g === 'other' ? 'KHỐI KHÁC / CHƯA PHÂN LOẠI' : `KHỐI LỚP ${g}`;
          
          tableRowsHtml += `
            <tr class="bg-indigo-50/80 font-bold text-indigo-900 text-center">
              <td colspan="6" class="border border-slate-400 p-2 text-left uppercase tracking-wider text-[10px] font-extrabold">${titleLabel}</td>
            </tr>
          `;
          
          list.forEach(item => {
            let badge = `Hạng ${item.rank}`;
            if (item.rank === 1) badge = '🥇 Hạng 1';
            if (item.rank === 2) badge = '🥈 Hạng 2';
            if (item.rank === 3) badge = '🥉 Hạng 3';

            let evaluation = 'Xuất sắc';
            let evalClass = 'text-emerald-700 font-bold';
            if (item.finalScore < 100 && item.finalScore >= 90) {
              evaluation = 'Tốt';
            } else if (item.finalScore < 90 && item.finalScore >= 80) {
              evaluation = 'Khá';
              evalClass = 'text-amber-700 font-bold';
            } else if (item.finalScore < 80) {
              evaluation = 'Yếu - Cần Chấn Chỉnh';
              evalClass = 'text-rose-700 font-extrabold';
            }

            tableRowsHtml += `
              <tr class="hover:bg-slate-50 font-medium">
                <td class="border border-slate-400 p-2 text-center ${item.rank <= 3 ? 'font-bold bg-indigo-50/20' : ''}">${badge}</td>
                <td class="border border-slate-400 p-2 font-bold text-slate-950 text-left">${item.className}</td>
                <td class="border border-slate-400 p-2 text-center">${item.violationsCount}</td>
                <td class="border border-slate-400 p-2 text-center text-red-600 font-bold">-${item.pointsDeducted}đ</td>
                <td class="border border-slate-400 p-2 text-center text-indigo-900 font-extrabold text-xs">${item.finalScore}đ</td>
                <td class="border border-slate-400 p-2 text-center ${evalClass}">${evaluation}</td>
              </tr>
            `;
          });
        });

        // 5. Gather top individual infractions for the emulation section
        let studentViolMap = {};
        const repeatedMap = buildRepeatedViolationMap(scopeViolations);
        scopeViolations.forEach(v => {
          const k = `${v.studentName} (${v.studentClass})`;
          if (!studentViolMap[k]) {
            studentViolMap[k] = { name: v.studentName, class: v.studentClass, pts: 0, count: 0, isRepeated: false };
          }
          studentViolMap[k].pts += parseFloat(v.points || 0);
          studentViolMap[k].count += 1;
          studentViolMap[k].isRepeated = (repeatedMap[`${v.studentName}|${v.studentClass}`] || 0) >= 3;
        });
        
        let seriousInfractions = Object.values(studentViolMap);
        seriousInfractions.sort((a,b) => b.pts - a.pts);

        const scopeText = getScopeLabel(scopeType, scopeValue);
        let scopeTitle = `BÁO CÁO THI ĐUA TẬP THỂ - ${scopeText.toUpperCase()}`;

        previewContainer.innerHTML = `
          <div class="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
            <div class="text-center space-y-0.5">
              <div class="font-semibold uppercase tracking-wide text-[10px]">ỦY BAN NHÂN DÂN PHƯỜNG BÌNH TIÊN</div>
              <div class="font-bold uppercase tracking-wider text-xs text-indigo-900">TRƯỜNG THCS PHẠM ĐÌNH HỔ</div>
            </div>
            <div class="text-center space-y-0.5">
              <div class="font-bold text-[10px] text-slate-800">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div class="font-semibold text-[9px] text-slate-700 underline">Độc lập - Tự do - Hạnh phúc</div>
            </div>
          </div>

          <div class="text-center py-4">
            <h2 class="text-base font-black tracking-wide text-slate-900">${scopeTitle}</h2>
            <p class="text-[9px] italic text-slate-500 mt-1">Năm học: 2025 - 2026 • Thống kê độc lập theo từng khối học (Đồng điểm xếp cùng hạng)</p>
          </div>

          <!-- Collective Class Emulation board -->
          <div class="space-y-2">
            <h3 class="font-bold text-[11px] text-slate-800 uppercase tracking-wider border-b border-slate-200 pb-1">1. Bảng Điểm Thi Đua Khối Lớp (Thang điểm chuẩn: 100)</h3>
            <table class="w-full border-collapse border border-slate-400 text-[10px] text-slate-900">
              <thead>
                <tr class="bg-slate-100 text-slate-950 font-bold">
                  <th class="border border-slate-400 p-2 text-center w-[12%]">Hạng</th>
                  <th class="border border-slate-400 p-2 text-left w-[20%]">Lớp học</th>
                  <th class="border border-slate-400 p-2 text-center w-[12%]">Số vi phạm</th>
                  <th class="border border-slate-400 p-2 text-center w-[15%]">Điểm bị trừ</th>
                  <th class="border border-slate-400 p-2 text-center w-[15%]">Điểm rèn luyện</th>
                  <th class="border border-slate-400 p-2 text-center w-[26%]">Đánh giá chung</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
          </div>

          <!-- Top Individual infractions -->
          <div class="space-y-2 pt-4">
            <h3 class="font-bold text-[11px] text-slate-800 uppercase tracking-wider border-b border-slate-200 pb-1">2. Danh Sách Học Sinh Cần Lưu Ý Giáo Dục Trong Kỳ</h3>
            ${seriousInfractions.length === 0 ? `
              <p class="text-[9px] text-slate-500 italic">Tuyệt vời! Không ghi nhận học sinh vi phạm kỷ luật trong mốc thời gian này.</p>
            ` : `
              <table class="w-full border-collapse border border-slate-400 text-[9px] text-slate-900">
                <thead>
                  <tr class="bg-red-50 text-slate-950 font-bold">
                    <th class="border border-slate-400 p-2 text-center w-[8%]">STT</th>
                    <th class="border border-slate-400 p-2 text-left w-[35%]">Họ và tên</th>
                    <th class="border border-slate-400 p-2 text-center w-[15%]">Lớp</th>
                    <th class="border border-slate-400 p-2 text-center w-[20%]">Số lỗi vi phạm</th>
                    <th class="border border-slate-400 p-2 text-center w-[22%]">Tổng điểm trừ</th>
                  </tr>
                </thead>
                <tbody>
                  ${seriousInfractions.slice(0, 5).map((inf, idx) => `
                    <tr class="${inf.isRepeated ? 'bg-red-50' : ''}">
                      <td class="border border-slate-400 p-2 text-center">${idx + 1}</td>
                      <td class="border border-slate-400 p-2 font-bold">${inf.name}${inf.isRepeated ? ' ⚠️ [Tái phạm nhiều lần]' : ''}</td>
                      <td class="border border-slate-400 p-2 text-center font-semibold">${inf.class}</td>
                      <td class="border border-slate-400 p-2 text-center">${inf.count} lần</td>
                      <td class="border border-slate-400 p-2 text-center font-extrabold text-red-600">-${inf.pts}đ</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <p class="text-[8px] text-slate-500 italic">* Lưu ý: Danh sách này thống kê các học sinh có tổng điểm trừ cao nhất, yêu cầu GVCN phối hợp chặt chẽ với phụ huynh để có biện pháp nhắc nhở.</p>
            `}
          </div>

          <div class="grid grid-cols-2 pt-8 text-center text-[10px] gap-6 text-slate-900">
            <div class="space-y-1">
              <p class="font-semibold uppercase">Hiệu trưởng phê duyệt</p>
              <p class="text-[9px] text-slate-400 italic">(Ký tên và đóng dấu)</p>
              <div class="h-16"></div>
              <p class="font-bold">BAN GIÁM HIỆU</p>
            </div>
            <div class="space-y-1">
              <p class="italic text-slate-600">${dateString}</p>
              <p class="font-semibold uppercase">Tổng phụ trách Đội lập</p>
              <p class="text-[9px] text-slate-400 italic">(Ký, ghi rõ họ tên)</p>
              <div class="h-16"></div>
            </div>
          </div>
        `;
      } else {
        const scopeType = document.getElementById('emu-scope-type').value;
        const scopeValueEl = document.getElementById('emu-scope-value');
        const scopeValue = scopeValueEl ? scopeValueEl.value : '';

        if (!scopeValue) {
          previewContainer.innerHTML = `
            <div class="text-center py-20 text-slate-400 space-y-3">
              <span data-lucide="list-x" class="w-16 h-16 mx-auto text-slate-300"></span>
              <p class="text-sm font-semibold text-slate-500">Chưa có đủ thông tin hoặc mốc thời gian để kết xuất báo cáo vi phạm.</p>
            </div>
          `;
          lucide.createIcons();
          return;
        }

        const scopeViolations = getScopeViolations(scopeType, scopeValue);
        const repeatedMap = buildRepeatedViolationMap(scopeViolations);
        const studentSummaryMap = {};

        scopeViolations.forEach(v => {
          const key = `${v.studentName}|${v.studentClass}`;
          if (!studentSummaryMap[key]) {
            studentSummaryMap[key] = { name: v.studentName, class: v.studentClass, count: 0, pts: 0 };
          }
          studentSummaryMap[key].count += 1;
          studentSummaryMap[key].pts += parseFloat(v.points || 0);
        });

        const studentSummary = Object.values(studentSummaryMap)
          .map(item => ({
            ...item,
            isRepeated: (repeatedMap[`${item.name}|${item.class}`] || 0) >= 3
          }))
          .sort((a, b) => b.count - a.count || b.pts - a.pts || compareClassNames(a.class, b.class));

        const scopeText = getScopeLabel(scopeType, scopeValue);
        previewContainer.innerHTML = `
          <div class="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
            <div class="text-center space-y-0.5">
              <div class="font-semibold uppercase tracking-wide text-[10px]">ỦY BAN NHÂN DÂN PHƯỜNG BÌNH TIÊN</div>
              <div class="font-bold uppercase tracking-wider text-xs text-indigo-900">TRƯỜNG THCS PHẠM ĐÌNH HỔ</div>
            </div>
            <div class="text-center space-y-0.5">
              <div class="font-bold text-[10px] text-slate-800">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div class="font-semibold text-[9px] text-slate-700 underline">Độc lập - Tự do - Hạnh phúc</div>
            </div>
          </div>

          <div class="text-center py-4">
            <h2 class="text-base font-black tracking-wide text-slate-900">BÁO CÁO TỔNG HỢP VI PHẠM HỌC SINH - ${scopeText.toUpperCase()}</h2>
            <p class="text-[9px] italic text-slate-500 mt-1">Năm học: 2025 - 2026 • Tổng lượt vi phạm: ${scopeViolations.length} • Tổng số học sinh vi phạm: ${studentSummary.length}</p>
          </div>

          <div class="space-y-2">
            ${studentSummary.length === 0 ? `
              <p class="text-[9px] text-slate-500 italic">Không ghi nhận học sinh vi phạm trong mốc thời gian đã chọn.</p>
            ` : `
              <table class="w-full border-collapse border border-slate-400 text-[10px] text-slate-900">
                <thead>
                  <tr class="bg-red-50 text-slate-950 font-bold">
                    <th class="border border-slate-400 p-2 text-center w-[8%]">STT</th>
                    <th class="border border-slate-400 p-2 text-left w-[35%]">Họ và tên</th>
                    <th class="border border-slate-400 p-2 text-center w-[12%]">Lớp</th>
                    <th class="border border-slate-400 p-2 text-center w-[15%]">Số lần vi phạm</th>
                    <th class="border border-slate-400 p-2 text-center w-[15%]">Tổng điểm trừ</th>
                    <th class="border border-slate-400 p-2 text-center w-[15%]">Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  ${studentSummary.map((item, idx) => `
                    <tr class="${item.isRepeated ? 'bg-red-50' : ''}">
                      <td class="border border-slate-400 p-2 text-center">${idx + 1}</td>
                      <td class="border border-slate-400 p-2 font-bold">${item.name}${item.isRepeated ? ' ⚠️ [Tái phạm nhiều lần]' : ''}</td>
                      <td class="border border-slate-400 p-2 text-center font-semibold">${item.class}</td>
                      <td class="border border-slate-400 p-2 text-center">${item.count}</td>
                      <td class="border border-slate-400 p-2 text-center font-extrabold text-red-600">-${item.pts}đ</td>
                      <td class="border border-slate-400 p-2 text-center">${item.isRepeated ? '⚠️ Cần theo dõi' : '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>

          <div class="grid grid-cols-2 pt-8 text-center text-[10px] gap-6 text-slate-900">
            <div class="space-y-1">
              <p class="font-semibold uppercase">Hiệu trưởng phê duyệt</p>
              <p class="text-[9px] text-slate-400 italic">(Ký tên và đóng dấu)</p>
              <div class="h-16"></div>
              <p class="font-bold">BAN GIÁM HIỆU</p>
            </div>
            <div class="space-y-1">
              <p class="italic text-slate-600">${dateString}</p>
              <p class="font-semibold uppercase">Tổng phụ trách Đội lập</p>
              <p class="text-[9px] text-slate-400 italic">(Ký, ghi rõ họ tên)</p>
              <div class="h-16"></div>
            </div>
          </div>
        `;
      }
      lucide.createIcons();
    }

    // High Quality Print logic
    function printReport() {
      if (students.length === 0) {
        showToast('❌ Không có dữ liệu để in!');
        return;
      }
      
      const previewHtml = document.getElementById('report-preview-sheet').innerHTML;
      document.getElementById('print-content').innerHTML = previewHtml;
      window.print();
    }

    function generateExcelFileBlob() {
      if (!students.length) { 
        showToast('❌ Chưa có dữ liệu để xuất file!'); 
        return null; 
      }

      const reportType = document.getElementById('report-type-select').value;
      const wb = XLSX.utils.book_new();
      let filename = '';

      if (reportType === 'students') {
        const selectedGrade = document.getElementById('report-grade-select').value;
        const selectedClass = document.getElementById('report-class-select').value;
        const selectedBoarding = document.getElementById('report-boarding-select').value;

        let filtered = students.filter(s => {
          const g = s.grade || getGrade(s.class);
          const matchGrade = (selectedGrade === 'all') || (String(g) === selectedGrade);
          const matchClass = (selectedClass === 'all') || (s.class === selectedClass);
          
          let matchBoarding = true;
          if (selectedBoarding === 'yes') {
            matchBoarding = (s.boarding === 'Có');
          } else if (selectedBoarding === 'no') {
            matchBoarding = (s.boarding === 'Không');
          }
          
          return matchGrade && matchClass && matchBoarding;
        });

        filtered.sort(compareStudentsByClassPriority);
        const genderSummary = calculateGenderSummary(filtered);

        const wsData = [
          ['TRƯỜNG THCS PHẠM ĐÌNH HỔ - BAN GIÁM HIỆU'],
          ['DANH SÁCH LÝ LỊCH HỌC SINH CHI TIẾT'],
          [`Năm học: 2025 - 2026 • Tổng số: ${filtered.length} học sinh (Nam: ${genderSummary.male} / Nữ: ${genderSummary.female})`],
          [`Thời gian xuất bản: ${new Date().toLocaleDateString('vi-VN')}`],
          [], 
          ['STT', 'Họ và tên học sinh', 'Lớp học', 'Giới tính', 'Năm sinh', 'SĐT chính', 'SĐT dự phòng', 'Bán trú']
        ];

        filtered.forEach((s, idx) => {
          wsData.push([
            idx + 1, 
            s.name, 
            s.class, 
            s.gender, 
            s.birthYear, 
            { v: s.phone, t: 's' },
            { v: s.phone2 !== 'N/A' ? s.phone2 : '', t: 's' },
            s.boarding || 'Không'
          ]);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
          { wch: 6 },  { wch: 30 }, { wch: 12 }, { wch: 12 },
          { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 }
        ];
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
          { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo Học Sinh');
        
        filename = 'BaoCao_LyLich_HocSinh.xlsx';
        if (selectedClass !== 'all') {
          filename = `Danh_Sach_Hoc_Sinh_Lop_${selectedClass}.xlsx`;
        } else if (selectedGrade !== 'all') {
          filename = `Danh_Sach_Hoc_Sinh_Khoi_${selectedGrade}.xlsx`;
        }

      } else if (reportType === 'emulation') {
        // Export collective class emulation board score grouped by grade and sorted internally
        const scopeType = document.getElementById('emu-scope-type').value;
        const scopeValue = document.getElementById('emu-scope-value').value;

        let allClasses = [...new Set(students.map(s => s.class))];
        allClasses.sort(compareClassNames);

        const scopeViolations = getScopeViolations(scopeType, scopeValue);

        let classEmuList = allClasses.map(className => {
          const classViolations = scopeViolations.filter(v => v.studentClass === className);
          const totalDeducted = classViolations.reduce((sum, v) => sum + parseFloat(v.points || 0), 0);
          return {
            className,
            grade: getGrade(className),
            violationsCount: classViolations.length,
            pointsDeducted: totalDeducted,
            finalScore: 100 - totalDeducted
          };
        });

        // Group by Grade and rank within each grade (equal-score tie-breaker handled)
        const gradesList = [6, 7, 8, 9];
        let classEmuByGrade = { 6: [], 7: [], 8: [], 9: [], 'other': [] };

        classEmuList.forEach(item => {
          const g = item.grade;
          if (gradesList.includes(g)) {
            classEmuByGrade[g].push(item);
          } else {
            classEmuByGrade['other'].push(item);
          }
        });

        // Sort and rank inside each grade
        gradesList.concat(['other']).forEach(g => {
          if (!classEmuByGrade[g]) return;
          classEmuByGrade[g].sort((a, b) => b.finalScore - a.finalScore || compareClassNames(a.className, b.className));
          
          let rank = 0;
          let skipped = 1;
          let lastScore = null;
          classEmuByGrade[g].forEach((item) => {
            if (item.finalScore !== lastScore) {
              rank += skipped;
              skipped = 1;
              lastScore = item.finalScore;
            } else {
              skipped++;
            }
            item.rank = rank;
          });
        });

        const labelMap = { 'week': 'Tuần', 'month': 'Tháng', 'semester': 'Học kỳ', 'year': 'Cả năm' };
        const wsData = [
          ['TRƯỜNG THCS PHẠM ĐÌNH HỔ - BAN THI ĐUA'],
          [`BẢNG ĐIỂM THI ĐUA TẬP THỂ LỚP - ${getScopeLabel(scopeType, scopeValue).toUpperCase()}`],
          [`Thời gian xuất bản: ${new Date().toLocaleDateString('vi-VN')}`],
          [],
          ['Hạng', 'Lớp học', 'Số vi phạm rèn luyện', 'Điểm thi đua bị trừ', 'Điểm thi đua chung', 'Xếp loại chung']
        ];

        const allTargetGrades = [6, 7, 8, 9, 'other'];
        allTargetGrades.forEach(g => {
          const list = classEmuByGrade[g];
          if (!list || list.length === 0) return;
          
          const blockTitle = g === 'other' ? 'KHỐI KHÁC / CHƯA PHÂN LOẠI' : `KHỐI LỚP ${g}`;
          // Section header in Excel sheet
          wsData.push([blockTitle, '', '', '', '', '']);

          list.forEach(item => {
            let evalStr = 'Xuất sắc';
            if (item.finalScore < 100 && item.finalScore >= 90) evalStr = 'Tốt';
            else if (item.finalScore < 90 && item.finalScore >= 80) evalStr = 'Khá';
            else if (item.finalScore < 80) evalStr = 'Yếu';

            wsData.push([
              `Hạng ${item.rank}`,
              item.className,
              item.violationsCount,
              -item.pointsDeducted,
              item.finalScore,
              evalStr
            ]);
          });
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
          { wch: 12 }, { wch: 15 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 25 }
        ];
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Báo Cáo Thi Đua');
        filename = `BaoCao_ThiDua_TapThe_${labelMap[scopeType]}_${scopeValue}.xlsx`;
      } else {
        const scopeType = document.getElementById('emu-scope-type').value;
        const scopeValue = document.getElementById('emu-scope-value').value;
        const scopeText = getScopeLabel(scopeType, scopeValue);
        const scopeViolations = getScopeViolations(scopeType, scopeValue);
        const repeatedMap = buildRepeatedViolationMap(scopeViolations);
        const studentSummaryMap = {};

        scopeViolations.forEach(v => {
          const key = `${v.studentName}|${v.studentClass}`;
          if (!studentSummaryMap[key]) {
            studentSummaryMap[key] = { name: v.studentName, class: v.studentClass, count: 0, pts: 0 };
          }
          studentSummaryMap[key].count += 1;
          studentSummaryMap[key].pts += parseFloat(v.points || 0);
        });

        const studentSummary = Object.values(studentSummaryMap)
          .map(item => ({
            ...item,
            isRepeated: (repeatedMap[`${item.name}|${item.class}`] || 0) >= 3
          }))
          .sort((a, b) => b.count - a.count || b.pts - a.pts || compareClassNames(a.class, b.class));

        const wsData = [
          ['TRƯỜNG THCS PHẠM ĐÌNH HỔ - BAN THI ĐUA'],
          [`BÁO CÁO TỔNG HỢP VI PHẠM HỌC SINH - ${scopeText.toUpperCase()}`],
          [`Tổng lượt vi phạm: ${scopeViolations.length} • Tổng số học sinh vi phạm: ${studentSummary.length}`],
          [`Thời gian xuất bản: ${new Date().toLocaleDateString('vi-VN')}`],
          [],
          ['STT', 'Họ và tên học sinh', 'Lớp', 'Số lần vi phạm', 'Tổng điểm trừ', 'Cảnh báo']
        ];

        studentSummary.forEach((item, idx) => {
          wsData.push([
            idx + 1,
            item.name,
            item.class,
            item.count,
            -item.pts,
            item.isRepeated ? '⚠️ Tái phạm nhiều lần (>= 3)' : ''
          ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
          { wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 28 }
        ];
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
          { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Bao Cao Vi Pham');
        filename = `BaoCao_TongHop_ViPham_${scopeText.replace(/\s+/g, '_')}.xlsx`;
      }

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const file = new File([blob], filename, { type: blob.type });
      return file;
    }

    // Tải tệp Excel về thiết bị theo tên tệp đã tạo sẵn
    function downloadExcelFile(file) {
      const fileUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(fileUrl);
    }

    // Export beautiful styled excel spreadsheet matching selection parameters
    function exportReport() {
      const file = generateExcelFileBlob();
      if (!file) return;

      downloadExcelFile(file);
      showToast('✓ Đã xuất file báo cáo Excel thành công!');
    }

    async function shareReportToZalo() {
      const reportType = document.getElementById('report-type-select').value;
      if (reportType === 'students') {
        showToast('ℹ️ Hãy chọn báo cáo thi đua hoặc tổng hợp vi phạm để chia sẻ nhanh qua Zalo.');
        return;
      }

      const file = generateExcelFileBlob();
      if (!file) return;

      const canShareFile = navigator.canShare && navigator.canShare({ files: [file] });

      if (canShareFile && navigator.share) {
        try {
          await navigator.share({
            files: [file],
            title: 'Báo cáo vi phạm thi đua rèn luyện',
            text: 'Gửi kết quả tổng hợp thi đua trường THCS Phạm Đình Hổ'
          });
          showToast('✓ Đã mở khay chia sẻ hệ thống, chọn Zalo để gửi tệp.');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') {
            showToast('ℹ️ Đã hủy chia sẻ tệp.');
            return;
          }
          showToast('⚠️ Trình duyệt/thiết bị chưa hỗ trợ chia sẻ tệp trực tiếp ổn định, hệ thống sẽ tải file để gửi qua Zalo.');
        }
      }

      downloadExcelFile(file);
      alert('💡 Đã xuất file Excel thành công! Thầy/Cô chỉ cần kéo thả tệp tin vừa tải ở góc màn hình vào khung chat ứng dụng Zalo để gửi ngay.');
    }

    // ----------------------------------------------------
    // MOBILE QR CONNECTION ENGINE (NEW)
    // ----------------------------------------------------
    function openQrModal() {
      const modal = document.getElementById('qr-modal');
      const img = document.getElementById('qr-code-img');
      const urlText = document.getElementById('qr-link-url');
      const syncInput = document.getElementById('sync-channel-input');

      // Detect active hosting url dynamically
      let activeUrl = window.location.href;
      
      // If run locally via file protocol, warn teacher how local IP network scan works
      if (activeUrl.startsWith('file:///')) {
        activeUrl = "http://localhost:5500/"; // Placeholder instruction
        showToast("💡 Gợi ý: Hãy upload file lên Github Pages hoặc Vercel để quét QR thuận tiện nhất!");
      }

      // Encode URL and trigger beautiful stable free QR API 
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(activeUrl)}`;
      
      img.src = qrApiUrl;
      urlText.textContent = activeUrl;
      syncInput.value = syncChannelCode;

      modal.classList.remove('hidden');
      lucide.createIcons();
    }

    function closeQrModal() {
      document.getElementById('qr-modal').classList.add('hidden');
    }

    function copyQrLink() {
      const url = window.location.href;
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast('✓ Đã copy liên kết hệ thống vào khay nhớ tạm!');
    }

    async function changeSyncChannel() {
      const val = document.getElementById('sync-channel-input').value.trim().toUpperCase();
      if (!val) {
        showToast('❌ Tên kênh không được bỏ trống!');
        return;
      }
      
      syncChannelCode = val;
      localStorage.setItem("find_hs_sync_channel", val);
      
      showToast(`✓ Đang thiết lập và tải kênh đồng bộ mới: ${val}...`);
      
      // Re-trigger auth sync on new channel room
      if (isCloudMode) {
        window.FirebaseDB?.stopRealtimeSync?.();
        window.FirebaseDB?.startRealtimeSync?.();
      }
      closeQrModal();
    }

    // Troubleshoot guidelines for non-configured Firebase projects
    function showFirebaseTroubleshoot() {
      document.getElementById('troubleshoot-modal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeTroubleshootModal() {
      document.getElementById('troubleshoot-modal').classList.add('hidden');
    }

    // Custom non-blocking Confirmation dialog modal handlers
    function showConfirm(title, message, onConfirm) {
      document.getElementById('confirm-title').innerText = title;
      document.getElementById('confirm-message').innerText = message;
      confirmCallback = onConfirm;
      document.getElementById('confirm-modal').classList.remove('hidden');
    }

    function closeConfirm(agreed) {
      document.getElementById('confirm-modal').classList.add('hidden');
      if (agreed && confirmCallback) {
        confirmCallback();
      }
      confirmCallback = null;
    }

    function showToast(msg) {
      const existing = document.getElementById('dynamic-toast');
      if (existing) existing.remove();

      const t = document.createElement('div');
      t.id = 'dynamic-toast';
      t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white border border-indigo-500 px-5 py-3 rounded-xl shadow-2xl text-xs z-50 animate-bounce font-medium flex items-center gap-2 max-w-sm text-center';
      t.innerHTML = `<span>${msg}</span>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    // Runs on ready (Kiểm tra cả hai trường hợp Firebase module sẵn sàng sớm hay muộn)
    let firebaseInitRequested = false;
    function bootstrapFirebaseApp() {
      if (firebaseInitRequested) return;
      if (window.FirebaseDB && typeof window.FirebaseDB.initFirebase === 'function') {
        firebaseInitRequested = true;
        window.FirebaseDB.initFirebase();
      }
    }

    bootstrapFirebaseApp();
    window.addEventListener('firebase-db-ready', bootstrapFirebaseApp);
    window.addEventListener('firebase-sdk-ready', bootstrapFirebaseApp);

    window.onload = function() {
      lucide.createIcons();
    };
