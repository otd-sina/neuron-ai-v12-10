const TOKEN_KEY = "student_token";
const SUBJECT_ID_KEY = "selected_subject_id";
const SUBJECT_NAME_KEY = "selected_subject_name";
const SUBJECT_COLOR_KEY = "selected_subject_color";
const BOT_TYPE_KEY = "selected_bot_type";
const BOT_NAME_KEY = "selected_bot_name";
const HOMEWORK_ID_KEY = "selected_homework_id";
const HOMEWORK_TITLE_KEY = "selected_homework_title";
const HOMEWORK_MESSAGE_KEY = "selected_homework_message";

const subjectsGridEl = document.getElementById("subjects-grid");
const subjectsLoadingEl = document.getElementById("subjects-loading");
const subjectsAlertEl = document.getElementById("subjects-alert");
const backToDashboardButton = document.getElementById("back-to-dashboard");

const SUBJECT_ICON_MAP = {
  calculator: "🧮",
  atom: "⚛️",
  flask: "🧪",
  dna: "🧬",
  "book-open": "📚",
  language: "🗣️",
  globe: "🌍",
  scroll: "📜",
  map: "🗺️",
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

function showAlert(message) {
  subjectsAlertEl.textContent = message;
  subjectsAlertEl.classList.remove("hidden");
}

function hideAlert() {
  subjectsAlertEl.textContent = "";
  subjectsAlertEl.classList.add("hidden");
}

function getSubjectIcon(iconId) {
  return SUBJECT_ICON_MAP[iconId] || "📘";
}

function renderSubjects(subjects) {
  subjectsGridEl.innerHTML = "";

  subjects.forEach((subject, index) => {
    const card = document.createElement("article");
    card.className = "glass-card selectable-card subject-card";
    card.style.setProperty("--subject-color", subject.theme_color || "#4de0c1");
    card.style.setProperty("--subject-color-soft", `${subject.theme_color || "#4de0c1"}33`);
    card.style.setProperty("--card-order", String(index));

    card.innerHTML = `
      <div class="card-icon" aria-hidden="true">${getSubjectIcon(subject.icon)}</div>
      <h2>${subject.name}</h2>
      <p class="muted">برای شروع یادگیری ${subject.name} کلیک کن.</p>
    `;

    card.addEventListener("click", () => {
      localStorage.setItem(SUBJECT_ID_KEY, subject.id);
      localStorage.setItem(SUBJECT_NAME_KEY, subject.name);
      localStorage.setItem(SUBJECT_COLOR_KEY, subject.theme_color || "#4de0c1");
      localStorage.removeItem(BOT_TYPE_KEY);
      localStorage.removeItem(BOT_NAME_KEY);
      localStorage.removeItem(HOMEWORK_ID_KEY);
      localStorage.removeItem(HOMEWORK_TITLE_KEY);
      localStorage.removeItem(HOMEWORK_MESSAGE_KEY);
      window.location.href = "/student/bots";
    });

    subjectsGridEl.appendChild(card);

    requestAnimationFrame(() => {
      card.classList.add("visible");
    });
  });
}

async function loadSubjects() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const res = await fetch("/api/student/subjects", {
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

    if (!res.ok || !Array.isArray(data.subjects)) {
      showAlert(data.message || "دریافت فهرست درس‌ها با خطا مواجه شد.");
      return;
    }

    renderSubjects(data.subjects);
    subjectsLoadingEl.classList.add("hidden");
    subjectsGridEl.classList.remove("hidden");
  } catch {
    showAlert("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کن.");
  } finally {
    subjectsLoadingEl.classList.add("hidden");
  }
}

backToDashboardButton.addEventListener("click", () => {
  window.location.href = "/student/dashboard";
});

loadSubjects();
