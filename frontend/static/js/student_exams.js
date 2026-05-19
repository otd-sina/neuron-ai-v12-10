const TOKEN_KEY = "student_token";
const EXAMS_CACHE_KEY = "student_exams_cache_v1";
const WEAK_TOPICS_KEY = "student_weak_topics_v1";
const SCHOOL_EXAMS_CACHE_KEY = "student_school_exams_cache_v1";
const ACTIVE_TAB_KEY = "student_exams_active_tab_v1";

const examsAlertEl = document.getElementById("exams-alert");
const overallProgressEl = document.getElementById("overall-progress");
const examsListEl = document.getElementById("exams-list");
const schoolExamsSummaryEl = document.getElementById("school-exams-summary");
const schoolExamsListEl = document.getElementById("school-exams-list");

const tabButtons = Array.from(document.querySelectorAll(".exam-tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".exam-tab-panel"));

const liveExamEl = document.getElementById("school-live-exam");
const liveAlertEl = document.getElementById("live-exam-alert");
const liveExamTitleEl = document.getElementById("live-exam-title");
const liveExamTopicEl = document.getElementById("live-exam-topic");
const liveExamTimerEl = document.getElementById("live-exam-timer");
const liveQuestionCounterEl = document.getElementById("live-question-counter");
const liveQuestionDifficultyEl = document.getElementById("live-question-difficulty");
const liveQuestionTextEl = document.getElementById("live-question-text");
const liveOptionsListEl = document.getElementById("live-options-list");
const liveQuestionJumpEl = document.getElementById("live-question-jump");
const livePrevBtn = document.getElementById("live-prev-btn");
const liveNextBtn = document.getElementById("live-next-btn");
const liveSubmitTopBtn = document.getElementById("live-submit-top-btn");
const liveSubmitBottomBtn = document.getElementById("live-submit-bottom-btn");

const LIVE_DIFFICULTY_LABELS = {
  easy: "آسان",
  medium: "متوسط",
  hard: "سخت",
  gifted: "تیزهوشان",
};

const state = {
  schoolExams: [],
  serverOffsetMs: 0,
  schoolTickerId: null,
  live: {
    open: false,
    examId: null,
    title: "",
    subject: "",
    questionCount: 0,
    questions: [],
    answers: {},
    currentIndex: 0,
    endAtMs: null,
    timerId: null,
    submitting: false,
    submitted: false,
    locked: false,
  },
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nowWithServerOffset() {
  return Date.now() + state.serverOffsetMs;
}

function syncServerClock(serverTime) {
  const serverMs = parseDateMs(serverTime);
  if (serverMs === null) {
    return;
  }
  state.serverOffsetMs = serverMs - Date.now();
}

function formatJalali(dateValue) {
  if (!dateValue) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateValue));
  } catch {
    return "—";
  }
}

function formatTimer(secondsValue) {
  const totalSeconds = Math.max(0, Number(secondsValue) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseArrayCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObjectCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function showAlert(message) {
  examsAlertEl.textContent = message;
  examsAlertEl.classList.remove("hidden");
}

function hideAlert() {
  examsAlertEl.textContent = "";
  examsAlertEl.classList.add("hidden");
}

function showLiveAlert(message) {
  liveAlertEl.textContent = message;
  liveAlertEl.classList.remove("hidden");
}

function hideLiveAlert() {
  liveAlertEl.textContent = "";
  liveAlertEl.classList.add("hidden");
}

function setActiveTab(tabKey) {
  const safeKey = tabKey === "school" ? "school" : "personal";
  localStorage.setItem(ACTIVE_TAB_KEY, safeKey);

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === safeKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  tabPanels.forEach((panel) => {
    const isVisible = panel.dataset.tabPanel === safeKey;
    panel.classList.toggle("hidden", !isVisible);
  });
}

function restoreActiveTab() {
  const fromCache = localStorage.getItem(ACTIVE_TAB_KEY);
  setActiveTab(fromCache === "school" ? "school" : "personal");
}

function normalizeExams(exams) {
  if (!Array.isArray(exams)) {
    return [];
  }

  return exams
    .map((exam, index) => {
      const source = String(exam.source || "").trim().toLowerCase();
      const normalizedSource = source === "school" ? "school" : "personal";
      return {
        id: exam.exam_id || exam.id || `exam-${index}`,
        school_exam_id: exam.school_exam_id || null,
        source: normalizedSource,
        exam_title: exam.exam_title || "",
        subject: exam.subject || "آزمون",
        score: Number(exam.score ?? 0),
        total: Number(exam.total ?? 20),
        percentage: Number.isFinite(Number(exam.percentage)) ? Number(exam.percentage) : null,
        weak_points: Array.isArray(exam.weak_points) ? exam.weak_points : [],
        created_at: exam.created_at || exam.timestamp,
      };
    })
    .sort((left, right) => {
      const leftTime = parseDateMs(left.created_at) || 0;
      const rightTime = parseDateMs(right.created_at) || 0;
      return rightTime - leftTime;
    });
}

function normalizeSchoolExams(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((exam, index) => ({
      exam_id: exam.exam_id ?? exam.id ?? `school-${index}`,
      title: exam.title || "آزمون مدرسه",
      subject: exam.subject || "درس نامشخص",
      focus_area: exam.focus_area || "بدون محدوده اعلام‌شده",
      duration: Number(exam.duration ?? 0),
      question_count: Number(exam.question_count ?? 0),
      start_time: exam.start_time,
      end_time: exam.end_time,
      status: exam.status || "invalid",
      seconds_until_start: Number(exam.seconds_until_start ?? 0),
      seconds_until_end: Number(exam.seconds_until_end ?? 0),
      already_submitted: Boolean(exam.already_submitted),
      can_enter: Boolean(exam.can_enter),
    }))
    .sort((left, right) => {
      const leftStart = parseDateMs(left.start_time) || 0;
      const rightStart = parseDateMs(right.start_time) || 0;
      return leftStart - rightStart;
    });
}

function normalizeLiveQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  const normalized = [];

  questions.forEach((question, index) => {
    if (!question || typeof question !== "object") {
      return;
    }

    const optionsRaw = question.options;
    let options = [];
    if (Array.isArray(optionsRaw)) {
      options = optionsRaw.slice(0, 4).map((item) => String(item || "").trim());
    } else if (optionsRaw && typeof optionsRaw === "object") {
      options = ["A", "B", "C", "D"].map((key) => String(optionsRaw[key] || optionsRaw[key.toLowerCase()] || "").trim());
    }

    if (options.length !== 4 || options.some((item) => !item)) {
      return;
    }

    const rawId = question.id ?? index + 1;
    normalized.push({
      id: String(rawId),
      order: index + 1,
      text: String(question.question || "").trim(),
      difficulty: String(question.difficulty || "").trim().toLowerCase(),
      options,
    });
  });

  return normalized;
}

function buildAnalytics(exams, apiAnalytics, weakTopics) {
  const analytics = apiAnalytics && typeof apiAnalytics === "object" ? apiAnalytics : {};
  const examCount = Number.isFinite(Number(analytics.exam_count))
    ? Number(analytics.exam_count)
    : exams.length;

  let averagePercentage = Number(analytics.average_percentage);
  if (!Number.isFinite(averagePercentage)) {
    const computed = exams.map((exam) => {
      if (Number.isFinite(exam.percentage)) {
        return exam.percentage;
      }
      return exam.total > 0 ? (exam.score / exam.total) * 100 : 0;
    });
    averagePercentage = computed.length
      ? Math.round((computed.reduce((acc, value) => acc + value, 0) / computed.length) * 100) / 100
      : 0;
  }

  const bestSubject = analytics.best_subject || (exams[0] ? exams[0].subject : "—");
  const topWeakTopic = analytics.top_weak_topic || weakTopics[0] || "—";
  const sourceBreakdown = analytics.source_breakdown && typeof analytics.source_breakdown === "object"
    ? analytics.source_breakdown
    : {};

  return {
    examCount,
    averagePercentage,
    bestSubject,
    topWeakTopic,
    sourceBreakdown,
  };
}

function renderOverview(exams, analytics) {
  const personalCount = Number(analytics.sourceBreakdown?.personal?.exam_count ?? 0);
  const schoolCount = Number(analytics.sourceBreakdown?.school?.exam_count ?? 0);
  const breakdownText = personalCount || schoolCount
    ? ` • شخصی: ${personalCount} • مدرسه: ${schoolCount}`
    : "";

  overallProgressEl.innerHTML = `
    <div>
      <h2>آنالیتیکس عملکرد</h2>
      <p class="muted">${analytics.examCount} آزمون ثبت شده${breakdownText} • آخرین بروزرسانی: ${formatJalali(exams[0]?.created_at)}</p>
    </div>
    <div class="analytics-top">
      <article class="stat-box">
        <p>میانگین عملکرد</p>
        <strong>${Math.round(analytics.averagePercentage)}%</strong>
      </article>
      <article class="stat-box">
        <p>بهترین درس</p>
        <strong>${escapeHtml(analytics.bestSubject || "—")}</strong>
      </article>
      <article class="stat-box">
        <p>نیاز به تمرین</p>
        <strong>${escapeHtml(analytics.topWeakTopic || "—")}</strong>
      </article>
    </div>
    <div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${Math.max(6, Math.min(Math.round(analytics.averagePercentage), 100))}%"></div>
      </div>
    </div>
  `;
}

function sourceBadge(source) {
  if (source === "school") {
    return '<span class="exam-source-badge school">مدرسه</span>';
  }
  return '<span class="exam-source-badge personal">تمرینی</span>';
}

function renderExamList(exams) {
  if (!exams.length) {
    examsListEl.innerHTML = '<p class="empty-note">هنوز نتیجه آزمونی برای نمایش ثبت نشده است.</p>';
    return;
  }

  examsListEl.innerHTML = exams
    .map((exam) => {
      const total = exam.total || 20;
      const percent = Number.isFinite(exam.percentage)
        ? Math.round(exam.percentage)
        : total > 0
          ? Math.round((exam.score / total) * 100)
          : 0;
      const weakText = exam.weak_points.length ? exam.weak_points.slice(0, 3).join("، ") : "موردی ثبت نشده";
      const titleText = exam.source === "school" && exam.exam_title
        ? `${escapeHtml(exam.exam_title)} — ${escapeHtml(exam.subject)}`
        : escapeHtml(exam.subject);

      return `
        <article class="list-item-card">
          <div class="exam-history-head">
            <p class="list-item-title"><strong>${titleText}</strong></p>
            ${sourceBadge(exam.source)}
          </div>
          <div class="list-item-meta">
            <span>تاریخ: ${formatJalali(exam.created_at)}</span>
            <span>نمره: ${exam.score} / ${total}</span>
            <span>درصد: ${percent}%</span>
          </div>
          <div class="list-item-meta">
            <span>نقاط ضعف: ${escapeHtml(weakText)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function evaluateSchoolExamState(exam) {
  const nowMs = nowWithServerOffset();
  const startMs = parseDateMs(exam.start_time);
  const endMs = parseDateMs(exam.end_time) || (
    startMs !== null && Number.isFinite(exam.duration)
      ? startMs + (Math.max(1, Number(exam.duration)) * 60 * 1000)
      : null
  );

  if (exam.already_submitted) {
    return {
      status: "completed",
      badge: "تکمیل شده",
      badgeTone: "completed",
      countdownLabel: "وضعیت: نتیجه شما ثبت شده است.",
      countdownValue: "پایان یافته",
      canEnter: false,
      remainingSeconds: 0,
    };
  }

  if (startMs === null || endMs === null) {
    return {
      status: "invalid",
      badge: "نامعتبر",
      badgeTone: "expired",
      countdownLabel: "وضعیت زمان‌بندی معتبر نیست.",
      countdownValue: "نامشخص",
      canEnter: false,
      remainingSeconds: 0,
    };
  }

  if (nowMs < startMs) {
    const remainingSeconds = Math.max(0, Math.floor((startMs - nowMs) / 1000));
    return {
      status: "scheduled",
      badge: "زمان‌بندی شده",
      badgeTone: "scheduled",
      countdownLabel: "شروع آزمون تا",
      countdownValue: formatTimer(remainingSeconds),
      canEnter: false,
      remainingSeconds,
    };
  }

  if (nowMs < endMs) {
    const remainingSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));
    return {
      status: "live",
      badge: "در حال برگزاری",
      badgeTone: "live",
      countdownLabel: "زمان باقی‌مانده آزمون",
      countdownValue: formatTimer(remainingSeconds),
      canEnter: true,
      remainingSeconds,
    };
  }

  return {
    status: "expired",
    badge: "پایان یافته",
    badgeTone: "expired",
    countdownLabel: "وضعیت: مهلت آزمون تمام شده است.",
    countdownValue: "00:00",
    canEnter: false,
    remainingSeconds: 0,
  };
}

function renderSchoolExamsSummary() {
  if (!state.schoolExams.length) {
    schoolExamsSummaryEl.textContent = "در حال حاضر آزمون مدرسه‌ای برای پایه یا کلاس شما ثبت نشده است.";
    return;
  }

  const counts = {
    scheduled: 0,
    live: 0,
    expired: 0,
    completed: 0,
    invalid: 0,
  };

  state.schoolExams.forEach((exam) => {
    const evaluated = evaluateSchoolExamState(exam);
    counts[evaluated.status] = (counts[evaluated.status] || 0) + 1;
  });

  schoolExamsSummaryEl.textContent = `${state.schoolExams.length} آزمون • در حال برگزاری: ${counts.live} • زمان‌بندی‌شده: ${counts.scheduled} • تکمیل‌شده: ${counts.completed} • پایان‌یافته: ${counts.expired}`;
}

function renderSchoolExams() {
  if (!state.schoolExams.length) {
    schoolExamsListEl.innerHTML = '<p class="empty-note">هیچ آزمون مدرسه‌ای برای نمایش وجود ندارد.</p>';
    return;
  }

  schoolExamsListEl.innerHTML = state.schoolExams
    .map((exam) => {
      const evaluated = evaluateSchoolExamState(exam);
      const durationText = Number.isFinite(exam.duration) && exam.duration > 0
        ? `${exam.duration} دقیقه`
        : "نامشخص";
      const questionCount = Number.isFinite(exam.question_count) && exam.question_count > 0
        ? exam.question_count
        : "—";
      const canEnter = evaluated.canEnter && !state.live.open;
      const buttonLabel = evaluated.status === "live" ? "ورود به آزمون" : "غیرفعال";

      return `
        <article class="list-item-card school-exam-card" data-exam-id="${escapeHtml(exam.exam_id)}">
          <div class="school-exam-head">
            <div>
              <p class="list-item-title"><strong>${escapeHtml(exam.title)}</strong></p>
              <p class="muted school-exam-focus">${escapeHtml(exam.focus_area)}</p>
            </div>
            <span class="school-status-badge ${evaluated.badgeTone}">${evaluated.badge}</span>
          </div>

          <div class="list-item-meta">
            <span>درس: ${escapeHtml(exam.subject)}</span>
            <span>تعداد سوال: ${questionCount}</span>
            <span>مدت: ${durationText}</span>
          </div>
          <div class="list-item-meta">
            <span>شروع: ${formatJalali(exam.start_time)}</span>
            <span>پایان: ${formatJalali(exam.end_time)}</span>
          </div>
          <div class="school-exam-timer-row">
            <span>${evaluated.countdownLabel}</span>
            <strong class="school-countdown ${evaluated.status}">${evaluated.countdownValue}</strong>
          </div>
          <button
            type="button"
            class="list-item-action school-enter-btn"
            data-exam-id="${escapeHtml(exam.exam_id)}"
            ${canEnter ? "" : "disabled"}
          >
            ${buttonLabel}
          </button>
        </article>
      `;
    })
    .join("");

  schoolExamsListEl.querySelectorAll(".school-enter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const examId = button.dataset.examId;
      if (!examId) {
        return;
      }
      openSchoolExam(examId);
    });
  });
}

function stopSchoolTicker() {
  if (state.schoolTickerId) {
    window.clearInterval(state.schoolTickerId);
    state.schoolTickerId = null;
  }
}

function startSchoolTicker() {
  stopSchoolTicker();
  if (!state.schoolExams.length) {
    return;
  }

  state.schoolTickerId = window.setInterval(() => {
    if (state.live.open) {
      return;
    }
    renderSchoolExamsSummary();
    renderSchoolExams();
  }, 1000);
}

function resetLiveState() {
  if (state.live.timerId) {
    window.clearInterval(state.live.timerId);
  }

  state.live = {
    open: false,
    examId: null,
    title: "",
    subject: "",
    questionCount: 0,
    questions: [],
    answers: {},
    currentIndex: 0,
    endAtMs: null,
    timerId: null,
    submitting: false,
    submitted: false,
    locked: false,
  };
}

function setLiveControlsState() {
  const lockAll = state.live.submitting || state.live.submitted;
  const lockNav = lockAll || state.live.locked;
  const lockAnswering = lockAll || state.live.locked;

  livePrevBtn.disabled = lockNav || state.live.currentIndex <= 0;
  liveNextBtn.disabled = lockNav || state.live.currentIndex >= state.live.questions.length - 1;
  liveSubmitTopBtn.disabled = lockAll;
  liveSubmitBottomBtn.disabled = lockAll;

  liveOptionsListEl.querySelectorAll("input[type='radio']").forEach((input) => {
    input.disabled = lockAnswering;
  });
}

function renderLiveJumpButtons() {
  const jumpButtonsHtml = state.live.questions
    .map((question, index) => {
      const isCurrent = index === state.live.currentIndex;
      const isAnswered = Number.isInteger(state.live.answers[question.id]);
      const classes = [
        "live-jump-btn",
        isCurrent ? "is-active" : "",
        isAnswered ? "is-answered" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<button type="button" class="${classes}" data-jump-index="${index}">${index + 1}</button>`;
    })
    .join("");

  liveQuestionJumpEl.innerHTML = jumpButtonsHtml;

  liveQuestionJumpEl.querySelectorAll(".live-jump-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.live.submitting || state.live.submitted || state.live.locked) {
        return;
      }
      const jumpIndex = Number(button.dataset.jumpIndex);
      if (!Number.isInteger(jumpIndex) || jumpIndex < 0 || jumpIndex >= state.live.questions.length) {
        return;
      }
      state.live.currentIndex = jumpIndex;
      renderLiveQuestion();
    });
  });
}

function renderLiveQuestion() {
  const question = state.live.questions[state.live.currentIndex];
  if (!question) {
    return;
  }

  const selectedIndex = state.live.answers[question.id];
  liveQuestionCounterEl.textContent = `سوال ${state.live.currentIndex + 1} از ${state.live.questions.length}`;
  liveQuestionTextEl.textContent = question.text || "متن سوال در دسترس نیست.";

  const difficultyLabel = LIVE_DIFFICULTY_LABELS[question.difficulty] || "نامشخص";
  liveQuestionDifficultyEl.textContent = `سطح: ${difficultyLabel}`;

  liveOptionsListEl.innerHTML = question.options
    .map((option, index) => {
      const isChecked = Number(selectedIndex) === index;
      const optionLabel = String.fromCharCode(65 + index);
      return `
        <label class="option-item school-option-item ${isChecked ? "selected" : ""}">
          <input
            type="radio"
            name="live-q-${escapeHtml(question.id)}"
            value="${index}"
            ${isChecked ? "checked" : ""}
          />
          <span>${optionLabel}) ${escapeHtml(option)}</span>
        </label>
      `;
    })
    .join("");

  liveOptionsListEl.querySelectorAll("input[type='radio']").forEach((input) => {
    input.addEventListener("change", () => {
      if (state.live.submitting || state.live.submitted || state.live.locked) {
        return;
      }
      const optionIndex = Number(input.value);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
        return;
      }
      state.live.answers[question.id] = optionIndex;
      renderLiveQuestion();
    });
  });

  renderLiveJumpButtons();
  setLiveControlsState();
}

function closeLiveExamMode() {
  liveExamEl.classList.add("hidden");
  document.body.classList.remove("exam-mode-open");
  hideLiveAlert();
  resetLiveState();
  startSchoolTicker();
}

function showLiveExamMode() {
  stopSchoolTicker();
  hideLiveAlert();
  document.body.classList.add("exam-mode-open");
  liveExamEl.classList.remove("hidden");
  renderLiveQuestion();
  tickLiveTimer();
  startLiveTimer();
}

function tickLiveTimer() {
  if (!state.live.open || state.live.endAtMs === null) {
    return;
  }

  const remainingMs = state.live.endAtMs - nowWithServerOffset();
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  liveExamTimerEl.textContent = formatTimer(remainingSeconds);
  liveExamTimerEl.classList.toggle("warning", remainingSeconds <= 60);
  liveExamTimerEl.classList.toggle("critical", remainingSeconds <= 20);

  if (remainingMs <= 0 && !state.live.submitted && !state.live.submitting) {
    state.live.locked = true;
    showLiveAlert("زمان آزمون به پایان رسید. پاسخ‌ها به‌صورت خودکار در حال ارسال هستند.");
    submitLiveExam({ auto: true });
  }
}

function startLiveTimer() {
  if (state.live.timerId) {
    window.clearInterval(state.live.timerId);
  }
  state.live.timerId = window.setInterval(tickLiveTimer, 1000);
}

function buildLiveAnswersPayload() {
  const answers = {};
  state.live.questions.forEach((question) => {
    const selected = state.live.answers[question.id];
    if (Number.isInteger(selected)) {
      answers[question.id] = selected;
    }
  });
  return answers;
}

async function submitLiveExam({ auto = false } = {}) {
  if (!state.live.open || state.live.submitting || state.live.submitted || !state.live.examId) {
    return;
  }

  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  const answeredCount = Object.keys(buildLiveAnswersPayload()).length;
  const unansweredCount = Math.max(0, state.live.questions.length - answeredCount);
  if (!auto) {
    const confirmText = unansweredCount > 0
      ? `هنوز ${unansweredCount} سوال بی‌پاسخ است. آیا آزمون ارسال شود؟`
      : "آیا از ارسال نهایی پاسخ‌ها مطمئن هستی؟";
    if (!window.confirm(confirmText)) {
      return;
    }
  }

  state.live.submitting = true;
  if (auto) {
    state.live.locked = true;
  }
  setLiveControlsState();

  try {
    const response = await fetch(`/api/student/school-exams/${encodeURIComponent(state.live.examId)}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        answers: buildLiveAnswersPayload(),
      }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.status === 401) {
      clearSession();
      window.location.replace("/student/login");
      return;
    }

    if (!response.ok) {
      state.live.submitting = false;
      setLiveControlsState();
      const fallback = auto
        ? "ارسال خودکار انجام نشد. اتصال را بررسی کن و دوباره ارسال را بزن."
        : "ارسال پاسخ‌ها با خطا مواجه شد.";
      showLiveAlert(data.message || fallback);
      return;
    }

    state.live.submitted = true;
    const score = data.score ?? "—";
    const total = data.total ?? "—";
    const percentage = Number.isFinite(Number(data.percentage))
      ? `${Math.round(Number(data.percentage))}%`
      : "—";

    closeLiveExamMode();
    setActiveTab("school");
    const successMessage = `آزمون با موفقیت ثبت شد: ${score} از ${total} (${percentage})`;
    await loadExams();
    showAlert(successMessage);
  } catch {
    state.live.submitting = false;
    setLiveControlsState();
    const fallback = auto
      ? "ارسال خودکار انجام نشد. اتصال اینترنت را بررسی کن و دوباره ارسال کن."
      : "ارسال پاسخ‌ها با خطا مواجه شد. دوباره تلاش کن.";
    showLiveAlert(fallback);
  }
}

async function openSchoolExam(examId) {
  if (!examId || state.live.open) {
    return;
  }

  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const response = await fetch(`/api/student/school-exams/${encodeURIComponent(examId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.status === 401) {
      clearSession();
      window.location.replace("/student/login");
      return;
    }

    if (!response.ok) {
      const errorMessage = data.message || "ورود به آزمون امکان‌پذیر نیست.";
      await loadExams();
      showAlert(errorMessage);
      return;
    }

    syncServerClock(data.server_time);

    const questions = normalizeLiveQuestions(data.questions);
    if (!questions.length) {
      showAlert("سوالات آزمون ناقص است. لطفاً با پشتیبانی تماس بگیرید.");
      return;
    }

    const endAtMs = parseDateMs(data.status?.end_time) || parseDateMs(data.exam?.end_time);
    if (endAtMs === null) {
      showAlert("زمان پایان آزمون نامعتبر است.");
      return;
    }

    resetLiveState();
    state.live.open = true;
    state.live.examId = String(data.exam?.exam_id || examId);
    state.live.title = String(data.exam?.title || "آزمون مدرسه");
    state.live.subject = String(data.exam?.subject || "درس نامشخص");
    state.live.questionCount = questions.length;
    state.live.questions = questions;
    state.live.answers = {};
    state.live.currentIndex = 0;
    state.live.endAtMs = endAtMs;

    liveExamTitleEl.textContent = state.live.title;
    liveExamTopicEl.textContent = `${state.live.subject} • ${state.live.questionCount} سوال`;

    showLiveExamMode();
  } catch {
    showAlert("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کن.");
  }
}

function renderPortalData(exams, analytics, weakTopics, schoolExams, serverTime) {
  localStorage.setItem(EXAMS_CACHE_KEY, JSON.stringify(exams));
  localStorage.setItem(WEAK_TOPICS_KEY, JSON.stringify(weakTopics));
  localStorage.setItem(SCHOOL_EXAMS_CACHE_KEY, JSON.stringify(schoolExams));
  if (serverTime) {
    localStorage.setItem("student_server_time_cache_v1", JSON.stringify({ server_time: serverTime }));
  }

  state.schoolExams = schoolExams;

  renderOverview(exams, analytics);
  renderExamList(exams);
  renderSchoolExamsSummary();
  renderSchoolExams();
  startSchoolTicker();
}

function renderFromCache() {
  const exams = normalizeExams(parseArrayCache(EXAMS_CACHE_KEY));
  const weakTopics = parseArrayCache(WEAK_TOPICS_KEY).filter(Boolean);
  const schoolExams = normalizeSchoolExams(parseArrayCache(SCHOOL_EXAMS_CACHE_KEY));
  const analytics = buildAnalytics(exams, null, weakTopics);
  const serverTimeCache = parseObjectCache("student_server_time_cache_v1");
  syncServerClock(serverTimeCache?.server_time);
  renderPortalData(exams, analytics, weakTopics, schoolExams, serverTimeCache?.server_time);
}

async function loadExams() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const response = await fetch("/api/student/exams", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.status === 401) {
      clearSession();
      window.location.replace("/student/login");
      return;
    }

    if (!response.ok || !Array.isArray(data.exams)) {
      showAlert(data.message || "دریافت داده آزمون‌ها با خطا مواجه شد.");
      renderFromCache();
      return;
    }

    syncServerClock(data.server_time);

    const exams = normalizeExams(data.exams);
    const weakTopics = Array.isArray(data.weak_topics)
      ? data.weak_topics.filter(Boolean)
      : Array.from(new Set(exams.flatMap((exam) => exam.weak_points).filter(Boolean)));
    const schoolExams = normalizeSchoolExams(data.school_exams);
    const analytics = buildAnalytics(exams, data.analytics, weakTopics);

    renderPortalData(exams, analytics, weakTopics, schoolExams, data.server_time);
  } catch {
    showAlert("ارتباط با سرور برقرار نشد. داده ذخیره‌شده نمایش داده شد.");
    renderFromCache();
  }
}

function bindEvents() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tabTarget === "school" ? "school" : "personal";
      setActiveTab(target);
    });
  });

  livePrevBtn.addEventListener("click", () => {
    if (!state.live.open || state.live.submitting || state.live.submitted || state.live.locked) {
      return;
    }
    state.live.currentIndex = Math.max(0, state.live.currentIndex - 1);
    renderLiveQuestion();
  });

  liveNextBtn.addEventListener("click", () => {
    if (!state.live.open || state.live.submitting || state.live.submitted || state.live.locked) {
      return;
    }
    state.live.currentIndex = Math.min(state.live.questions.length - 1, state.live.currentIndex + 1);
    renderLiveQuestion();
  });

  liveSubmitTopBtn.addEventListener("click", () => submitLiveExam({ auto: false }));
  liveSubmitBottomBtn.addEventListener("click", () => submitLiveExam({ auto: false }));
}

bindEvents();
restoreActiveTab();
loadExams();
