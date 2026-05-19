const TOKEN_KEY = "student_token";
const SUBJECT_ID_KEY = "selected_subject_id";
const SUBJECT_NAME_KEY = "selected_subject_name";
const SUBJECT_COLOR_KEY = "selected_subject_color";
const BOT_TYPE_KEY = "selected_bot_type";
const BOT_NAME_KEY = "selected_bot_name";
const HOMEWORK_ID_KEY = "selected_homework_id";
const HOMEWORK_TITLE_KEY = "selected_homework_title";
const HOMEWORK_MESSAGE_KEY = "selected_homework_message";

const botsTitleEl = document.getElementById("bots-title");
const botsSubtitleEl = document.getElementById("bots-subtitle");
const botsGridEl = document.getElementById("bots-grid");
const botsLoadingEl = document.getElementById("bots-loading");
const botsAlertEl = document.getElementById("bots-alert");
const backToSubjectsButton = document.getElementById("back-to-subjects");

const BOT_ICON_MAP = {
  "question-circle": "❓",
  "exam-paper": "📝",
  notebook: "📓",
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

function showAlert(message) {
  botsAlertEl.textContent = message;
  botsAlertEl.classList.remove("hidden");
}

function hideAlert() {
  botsAlertEl.textContent = "";
  botsAlertEl.classList.add("hidden");
}

function getBotIcon(iconId) {
  return BOT_ICON_MAP[iconId] || "🤖";
}

function getSubjectContext() {
  return {
    id: localStorage.getItem(SUBJECT_ID_KEY),
    name: localStorage.getItem(SUBJECT_NAME_KEY),
    color: localStorage.getItem(SUBJECT_COLOR_KEY) || "#4de0c1",
  };
}

function renderBotCards(bots, subjectColor) {
  botsGridEl.innerHTML = "";

  bots.forEach((bot, index) => {
    const card = document.createElement("article");
    card.className = "glass-card selectable-card bot-card";
    card.style.setProperty("--subject-color", subjectColor);
    card.style.setProperty("--card-order", String(index));

    card.innerHTML = `
      <div class="card-icon" aria-hidden="true">${getBotIcon(bot.icon)}</div>
      <h2>${bot.name}</h2>
      <p class="muted">${bot.description}</p>
    `;

    card.addEventListener("click", () => {
      localStorage.setItem(BOT_TYPE_KEY, bot.type);
      localStorage.setItem(BOT_NAME_KEY, bot.name);
      localStorage.removeItem(HOMEWORK_ID_KEY);
      localStorage.removeItem(HOMEWORK_TITLE_KEY);
      localStorage.removeItem(HOMEWORK_MESSAGE_KEY);
      window.location.href = "/student/chat";
    });

    botsGridEl.appendChild(card);

    requestAnimationFrame(() => {
      card.classList.add("visible");
    });
  });
}

function updateHeader(subjectName) {
  botsTitleEl.textContent = `برای درس ${subjectName} یک ربات انتخاب کن`;
  botsSubtitleEl.textContent = "هر ربات برای یک نوع نیاز آموزشی طراحی شده است.";
}

async function loadBots() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  const subject = getSubjectContext();
  if (!subject.id || !subject.name) {
    window.location.replace("/student/dashboard");
    return;
  }

  updateHeader(subject.name);
  hideAlert();

  try {
    const res = await fetch("/api/student/bots", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();

    if (res.status === 401) {
      clearSession();
      window.location.replace("/student/login");
      return;
    }

    if (!res.ok || !Array.isArray(data.bots)) {
      showAlert(data.message || "دریافت فهرست ربات‌ها با خطا مواجه شد.");
      return;
    }

    renderBotCards(data.bots, subject.color);
    botsLoadingEl.classList.add("hidden");
    botsGridEl.classList.remove("hidden");
  } catch {
    showAlert("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کن.");
  } finally {
    botsLoadingEl.classList.add("hidden");
  }
}

backToSubjectsButton.addEventListener("click", () => {
  window.location.href = "/student/subjects";
});

loadBots();
