const TOKEN_KEY = "student_token";
const SUBJECT_ID_KEY = "selected_subject_id";
const SUBJECT_NAME_KEY = "selected_subject_name";
const SUBJECT_COLOR_KEY = "selected_subject_color";
const BOT_TYPE_KEY = "selected_bot_type";
const BOT_NAME_KEY = "selected_bot_name";
const HOMEWORK_ID_KEY = "selected_homework_id";
const HOMEWORK_TITLE_KEY = "selected_homework_title";
const HOMEWORK_MESSAGE_KEY = "selected_homework_message";
const EXAMS_CACHE_KEY = "student_exams_cache_v1";
const WEAK_TOPICS_KEY = "student_weak_topics_v1";

const chatTitleEl = document.getElementById("chat-title");
const chatMessagesEl = document.getElementById("chat-messages");
const chatAlertEl = document.getElementById("chat-alert");
const typingIndicatorEl = document.getElementById("typing-indicator");
const chatFormEl = document.getElementById("chat-form");
const chatInputEl = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send");
const retryButton = document.getElementById("retry-button");
const backToBotsButton = document.getElementById("back-to-bots");

const examPanelEl = document.getElementById("exam-panel");
const examDifficultyEl = document.getElementById("exam-difficulty");
const examCountEl = document.getElementById("exam-count");
const startExamButton = document.getElementById("start-exam-button");
const examPanelNoteEl = document.getElementById("exam-panel-note");
const examContentEl = document.getElementById("exam-content");

const state = {
  context: null,
  processing: false,
  activeExam: null,
  retryAction: null,
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

function getContext() {
  return {
    subjectId: localStorage.getItem(SUBJECT_ID_KEY),
    subjectName: localStorage.getItem(SUBJECT_NAME_KEY),
    subjectColor: localStorage.getItem(SUBJECT_COLOR_KEY) || "#4de0c1",
    botType: localStorage.getItem(BOT_TYPE_KEY),
    botName: localStorage.getItem(BOT_NAME_KEY),
    homeworkId: localStorage.getItem(HOMEWORK_ID_KEY),
    homeworkTitle: localStorage.getItem(HOMEWORK_TITLE_KEY),
    homeworkMessage: localStorage.getItem(HOMEWORK_MESSAGE_KEY),
  };
}

function clearHomeworkContext() {
  localStorage.removeItem(HOMEWORK_ID_KEY);
  localStorage.removeItem(HOMEWORK_TITLE_KEY);
  localStorage.removeItem(HOMEWORK_MESSAGE_KEY);
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTimestamp(value) {
  if (!value) {
    return formatTime();
  }

  try {
    return new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    }).format(new Date(value));
  } catch {
    return formatTime();
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function showAlert(message) {
  chatAlertEl.textContent = message;
  chatAlertEl.classList.remove("hidden");
}

function hideAlert() {
  chatAlertEl.textContent = "";
  chatAlertEl.classList.add("hidden");
}

function clearRetry() {
  state.retryAction = null;
  retryButton.classList.add("hidden");
}

function setRetry(action) {
  state.retryAction = typeof action === "function" ? action : null;
  retryButton.classList.toggle("hidden", !state.retryAction);
}

function addMessage({ sender, senderLabel, text, timestamp }) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  const bubble = document.createElement("article");
  bubble.className = "glass-card message-bubble";

  const senderEl = document.createElement("p");
  senderEl.className = "message-sender";
  senderEl.textContent = senderLabel;

  const textEl = document.createElement("p");
  textEl.className = "message-text";
  textEl.textContent = text || "";

  const timeEl = document.createElement("time");
  timeEl.className = "message-time";
  timeEl.textContent = formatTimestamp(timestamp);

  bubble.appendChild(senderEl);
  bubble.appendChild(textEl);
  bubble.appendChild(timeEl);
  row.appendChild(bubble);
  chatMessagesEl.appendChild(row);

  scrollToBottom();
}

function setTyping(isTyping) {
  typingIndicatorEl.classList.toggle("hidden", !isTyping);
  if (isTyping) {
    scrollToBottom();
  }
}

function updateInputState() {
  const isExamLocked = state.context.botType === "exam_generator" && Boolean(state.activeExam);
  const disableInput = state.processing || isExamLocked;

  chatSendButton.disabled = disableInput;
  chatInputEl.disabled = disableInput;

  if (state.context.botType === "exam_generator") {
    if (isExamLocked) {
      chatInputEl.placeholder = "ابتدا پاسخ‌های آزمون را ثبت کن.";
    } else {
      chatInputEl.placeholder = "می‌خواهی آزمون جدید شروع شود؟ یک پیام بفرست یا روی شروع آزمون بزن.";
    }
  } else {
    chatInputEl.placeholder = "پیام خود را بنویسید...";
  }

  startExamButton.disabled = state.processing;
}

function setProcessing(isProcessing) {
  state.processing = isProcessing;
  updateInputState();
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

function initHeader(context) {
  document.documentElement.style.setProperty("--subject-accent", context.subjectColor);
  chatTitleEl.textContent = `${context.subjectName} | Smart Tutor`;
}

function cacheExamInsights(result) {
  const examHistory = parseArrayCache(EXAMS_CACHE_KEY);
  const weakTopics = parseArrayCache(WEAK_TOPICS_KEY);

  const examRecord = {
    id: `exam-${Date.now()}`,
    subject: state.context?.subjectName || "آزمون",
    score: Number(result.score ?? 0),
    total: Number(result.total ?? 20),
    created_at: new Date().toISOString(),
    weak_points: Array.isArray(result.weak_points) ? result.weak_points : [],
  };

  const mergedExams = [examRecord, ...examHistory].slice(0, 30);
  localStorage.setItem(EXAMS_CACHE_KEY, JSON.stringify(mergedExams));

  const mergedWeakTopics = Array.from(
    new Set([...weakTopics, ...(examRecord.weak_points || [])].filter(Boolean))
  ).slice(0, 20);
  localStorage.setItem(WEAK_TOPICS_KEY, JSON.stringify(mergedWeakTopics));
}

function validateContext() {
  const context = getContext();
  if (!context.subjectId || !context.subjectName || !context.botType || !context.botName) {
    window.location.replace("/student/dashboard");
    return null;
  }

  if (!getToken()) {
    window.location.replace("/student/login");
    return null;
  }

  return context;
}

function initBotMode(context) {
  examPanelEl.classList.toggle("hidden", context.botType !== "exam_generator");
  examContentEl.classList.add("hidden");

  if (context.botType === "exam_generator") {
    addMessage({
      sender: "bot",
      senderLabel: context.botName,
      text: "آماده‌ام برایت آزمون بسازم. سطح سختی و تعداد سوال را انتخاب کن و روی «شروع آزمون» بزن.",
    });
    return;
  }

  if (context.botType === "homework_helper") {
    const titleHint = context.homeworkTitle ? ` برای «${context.homeworkTitle}»` : "";
    addMessage({
      sender: "bot",
      senderLabel: context.botName,
      text: `سلام! برای درس ${context.subjectName}${titleHint} راهنمایی می‌کنم، اما پاسخ نهایی مستقیم نمی‌دم.`,
    });
    return;
  }

  addMessage({
    sender: "bot",
    senderLabel: context.botName,
    text: `سلام! من ${context.botName} هستم. هر سوالی از درس ${context.subjectName} داری بپرس.`,
  });
}

async function apiRequest(url, payload) {
  const token = getToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    clearSession();
    window.location.replace("/student/login");
    throw new Error("نشست شما منقضی شده است. لطفاً دوباره وارد شوید.");
  }

  if (!res.ok) {
    const error = new Error(data.message || "درخواست با خطا مواجه شد.");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

function examConfig() {
  const difficulty = examDifficultyEl.value || "medium";
  let questionCount = Number(examCountEl.value);
  if (!Number.isFinite(questionCount)) {
    questionCount = 10;
  }

  questionCount = Math.max(3, Math.min(20, Math.floor(questionCount)));
  examCountEl.value = String(questionCount);

  return { difficulty, questionCount };
}

function renderExamQuestions(examId, questions) {
  state.activeExam = {
    examId,
    questions,
  };

  const formParts = questions
    .map((question) => {
      const optionsHtml = ["A", "B", "C", "D"]
        .map((optionKey) => {
          const optionText = question.options?.[optionKey] || "";
          return `
            <label class="option-item">
              <input type="radio" name="q-${question.id}" value="${optionKey}" required />
              <span>${optionKey}) ${escapeHtml(optionText)}</span>
            </label>
          `;
        })
        .join("");

      return `
        <article class="exam-question">
          <span class="question-topic">${escapeHtml(question.topic || "مبحث")}</span>
          <p><strong>سوال ${question.id}:</strong> ${escapeHtml(question.question || "")}</p>
          <div class="option-list">${optionsHtml}</div>
        </article>
      `;
    })
    .join("");

  examContentEl.innerHTML = `
    <form id="exam-form" class="exam-form">
      ${formParts}
      <button id="submit-exam-button" class="btn-primary submit-exam-btn" type="submit">ارسال پاسخ‌ها</button>
    </form>
  `;
  examContentEl.classList.remove("hidden");

  const examForm = document.getElementById("exam-form");
  examForm.addEventListener("submit", handleExamSubmit);

  examPanelNoteEl.textContent = "آزمون فعال شد. همه سوال‌ها را پاسخ بده و سپس ارسال کن.";
  updateInputState();

  addMessage({
    sender: "bot",
    senderLabel: state.context.botName,
    text: `آزمون ${questions.length} سوالی آماده است. بعد از پاسخ‌دادن، روی «ارسال پاسخ‌ها» بزن.`,
  });
}

function renderExamResult(result) {
  cacheExamInsights(result);

  const weakPoints = Array.isArray(result.weak_points) ? result.weak_points : [];
  const explanations = Array.isArray(result.explanations) ? result.explanations : [];

  const weakPointsHtml = weakPoints.length
    ? `<ul class="weak-points">${weakPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>نقطه‌ضعف مشخصی ثبت نشد. عالی بود!</p>";

  const explanationsHtml = explanations
    .map((item) => {
      const statusText = item.is_correct ? "✅ پاسخ درست" : "❌ پاسخ نادرست";
      return `
        <details>
          <summary>سوال ${escapeHtml(item.question_id)} - ${statusText}</summary>
          <p>پاسخ شما: ${escapeHtml(item.student_answer || "بدون پاسخ")}</p>
          <p>پاسخ صحیح: ${escapeHtml(item.correct_answer || "-")}</p>
          <p>توضیح: ${escapeHtml(item.explanation || "")}</p>
        </details>
      `;
    })
    .join("");

  examContentEl.innerHTML = `
    <section class="exam-result">
      <p class="exam-score"><strong>نتیجه:</strong> ${escapeHtml(result.score)} از ${escapeHtml(result.total)} - ${escapeHtml(result.percentage)}٪</p>
      <div>
        <h3>مباحث نیازمند تمرین بیشتر</h3>
        ${weakPointsHtml}
      </div>
      <div>
        <h3>توضیح سوال‌ها</h3>
        <div class="result-explanations">${explanationsHtml || "<p>توضیحی ثبت نشده است.</p>"}</div>
      </div>
      <div class="result-actions">
        <button id="new-exam-button" class="btn-primary" type="button">شروع آزمون جدید</button>
        <button id="return-to-bots-button" class="btn-secondary" type="button">بازگشت به انتخاب ربات</button>
      </div>
    </section>
  `;

  const newExamButton = document.getElementById("new-exam-button");
  const returnToBotsButton = document.getElementById("return-to-bots-button");

  newExamButton.addEventListener("click", () => {
    examContentEl.classList.add("hidden");
    examContentEl.innerHTML = "";
    examPanelNoteEl.textContent = "برای آزمون جدید، تنظیمات را انتخاب کن.";
    state.activeExam = null;
    updateInputState();
  });

  returnToBotsButton.addEventListener("click", () => {
    window.location.href = "/student/bots";
  });

  examContentEl.classList.remove("hidden");
}

async function startExamFlow() {
  hideAlert();
  clearRetry();

  const { difficulty, questionCount } = examConfig();
  const payload = {
    subject_id: state.context.subjectId,
    difficulty,
    question_count: questionCount,
  };

  setProcessing(true);
  setTyping(true);

  try {
    const data = await apiRequest("/api/student/ai/exam/start", payload);
    if (!Array.isArray(data.questions) || !data.exam_id) {
      throw new Error("فرمت آزمون دریافتی معتبر نیست.");
    }

    renderExamQuestions(data.exam_id, data.questions);
    examPanelNoteEl.textContent = "آزمون ساخته شد و آماده پاسخ‌دهی است.";
  } catch (error) {
    const message = error.message || "خطا در ساخت آزمون. لطفاً دوباره تلاش کن.";
    showAlert(message);
    addMessage({
      sender: "bot",
      senderLabel: state.context.botName,
      text: message,
    });
    setRetry(() => startExamFlow());
  } finally {
    setTyping(false);
    setProcessing(false);
  }
}

async function handleExamSubmit(event) {
  event.preventDefault();

  if (!state.activeExam) {
    showAlert("ابتدا یک آزمون بساز.");
    return;
  }

  hideAlert();
  clearRetry();

  const formData = new FormData(event.currentTarget);
  const answers = {};

  state.activeExam.questions.forEach((question) => {
    const answer = formData.get(`q-${question.id}`);
    if (typeof answer === "string") {
      answers[String(question.id)] = answer;
    }
  });

  if (Object.keys(answers).length < state.activeExam.questions.length) {
    showAlert("لطفاً پاسخ همه سوال‌ها را انتخاب کن.");
    return;
  }

  setProcessing(true);
  setTyping(true);

  try {
    const data = await apiRequest("/api/student/ai/exam/submit", {
      exam_id: state.activeExam.examId,
      answers,
    });

    renderExamResult(data);
    state.activeExam = null;
    updateInputState();

    addMessage({
      sender: "bot",
      senderLabel: state.context.botName,
      text: "نتیجه آزمون آماده شد. می‌تونی توضیح هر سوال را باز کنی و بررسی کنی.",
      timestamp: data.timestamp,
    });
  } catch (error) {
    const message = error.message || "ثبت پاسخ آزمون با خطا مواجه شد.";
    showAlert(message);
    addMessage({
      sender: "bot",
      senderLabel: state.context.botName,
      text: message,
    });
    setRetry(() => {
      const examForm = document.getElementById("exam-form");
      if (examForm) {
        handleExamSubmit({ preventDefault: () => {}, currentTarget: examForm });
      }
    });
  } finally {
    setTyping(false);
    setProcessing(false);
  }
}

async function sendGeneralMessage(messageText) {
  const data = await apiRequest("/api/student/ai/general", {
    subject_id: state.context.subjectId,
    message: messageText,
  });

  addMessage({
    sender: "bot",
    senderLabel: state.context.botName,
    text: data.response || "پاسخی دریافت نشد.",
    timestamp: data.timestamp,
  });
}

async function sendHomeworkMessage(messageText) {
  const data = await apiRequest("/api/student/ai/homework", {
    subject_id: state.context.subjectId,
    message: messageText,
    homework_id: state.context.homeworkId || undefined,
  });

  const titlePrefix = data.assignment_title ? `تکلیف: ${data.assignment_title}\n` : "";
  addMessage({
    sender: "bot",
    senderLabel: state.context.botName,
    text: `${titlePrefix}${data.response || "پاسخی دریافت نشد."}`,
    timestamp: data.timestamp,
  });
}

async function startHomeworkFromContext() {
  if (state.context.botType !== "homework_helper") {
    clearHomeworkContext();
    return;
  }

  const initialMessage = (state.context.homeworkMessage || "").trim();
  if (!initialMessage) {
    return;
  }

  state.context.homeworkMessage = "";
  localStorage.removeItem(HOMEWORK_MESSAGE_KEY);

  addMessage({
    sender: "user",
    senderLabel: "شما",
    text: initialMessage,
  });

  setProcessing(true);
  setTyping(true);

  try {
    await sendHomeworkMessage(initialMessage);
  } catch (error) {
    const message = error.message || "شروع راهنمایی تکلیف با خطا مواجه شد.";
    showAlert(message);
    addMessage({
      sender: "bot",
      senderLabel: state.context.botName,
      text: message,
    });
    setRetry(() => sendHomeworkMessage(initialMessage));
  } finally {
    setTyping(false);
    setProcessing(false);
  }
}

async function handleMessageByBotType(messageText) {
  if (state.context.botType === "exam_generator") {
    if (state.activeExam) {
      addMessage({
        sender: "bot",
        senderLabel: state.context.botName,
        text: "آزمون فعلی فعال است. ابتدا پاسخ‌ها را ارسال کن یا آزمون جدید بساز.",
      });
      return;
    }

    await startExamFlow();
    return;
  }

  if (state.context.botType === "homework_helper") {
    await sendHomeworkMessage(messageText);
    return;
  }

  await sendGeneralMessage(messageText);
}

chatFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.processing) {
    return;
  }

  hideAlert();
  clearRetry();

  const messageText = chatInputEl.value.trim();
  if (!messageText) {
    return;
  }

  addMessage({
    sender: "user",
    senderLabel: "شما",
    text: messageText,
  });

  chatInputEl.value = "";
  setProcessing(true);
  setTyping(true);

  try {
    await handleMessageByBotType(messageText);
  } catch (error) {
    const message = error.message || "در ارتباط با سرور خطایی رخ داد. لطفاً دوباره تلاش کن.";
    showAlert(message);
    addMessage({
      sender: "bot",
      senderLabel: state.context.botName,
      text: message,
    });
    setRetry(() => handleMessageByBotType(messageText));
  } finally {
    setTyping(false);
    setProcessing(false);
    chatInputEl.focus();
  }
});

startExamButton.addEventListener("click", async () => {
  if (state.processing || state.context?.botType !== "exam_generator") {
    return;
  }

  await startExamFlow();
});

retryButton.addEventListener("click", async () => {
  if (state.processing || !state.retryAction) {
    return;
  }

  hideAlert();
  const action = state.retryAction;
  clearRetry();

  try {
    await action();
  } catch {
    showAlert("تلاش دوباره ناموفق بود. لطفاً چند لحظه بعد مجدداً امتحان کن.");
  }
});

backToBotsButton.addEventListener("click", () => {
  clearHomeworkContext();
  window.location.href = "/student/bots";
});

const initialContext = validateContext();
if (initialContext) {
  state.context = initialContext;
  initHeader(initialContext);
  initBotMode(initialContext);
  updateInputState();
  startHomeworkFromContext();
}
