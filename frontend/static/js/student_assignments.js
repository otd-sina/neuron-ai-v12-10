const TOKEN_KEY = "student_token";
const SUBJECT_ID_KEY = "selected_subject_id";
const SUBJECT_NAME_KEY = "selected_subject_name";
const SUBJECT_COLOR_KEY = "selected_subject_color";
const BOT_TYPE_KEY = "selected_bot_type";
const BOT_NAME_KEY = "selected_bot_name";
const HOMEWORK_ID_KEY = "selected_homework_id";
const HOMEWORK_TITLE_KEY = "selected_homework_title";
const HOMEWORK_MESSAGE_KEY = "selected_homework_message";
const ASSIGNMENTS_CACHE_KEY = "student_assignments_cache_v1";

const DEFAULT_BOT_TYPE = "homework_helper";
const DEFAULT_BOT_NAME = "دستیار تکالیف";
const DEFAULT_SUBJECT_ID = "math";
const DEFAULT_SUBJECT_NAME = "ریاضی";
const DEFAULT_SUBJECT_COLOR = "#3B82F6";

const assignmentsAlertEl = document.getElementById("assignments-alert");
const assignmentsListEl = document.getElementById("assignments-list");
const assignmentsSummaryEl = document.getElementById("assignments-summary");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

function showAlert(message) {
  assignmentsAlertEl.textContent = message;
  assignmentsAlertEl.classList.remove("hidden");
}

function hideAlert() {
  assignmentsAlertEl.textContent = "";
  assignmentsAlertEl.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatJalali(dateValue) {
  if (!dateValue) {
    return "بدون تاریخ";
  }

  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateValue));
  } catch {
    return "بدون تاریخ";
  }
}

function deadlineLabel(dueAt) {
  const dueDate = Date.parse(dueAt || "");
  if (Number.isNaN(dueDate)) {
    return { tone: "normal", text: "بدون موعد" };
  }

  const diffDays = Math.ceil((dueDate - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { tone: "urgent", text: "موعد گذشته" };
  }
  if (diffDays <= 1) {
    return { tone: "urgent", text: "فوری" };
  }
  if (diffDays <= 3) {
    return { tone: "soon", text: "نزدیک" };
  }
  return { tone: "normal", text: "عادی" };
}

function normalizeAssignments(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((assignment, index) => ({
      id: assignment.id ?? `assignment-${index}`,
      title: assignment.title || "تکلیف بدون عنوان",
      description: assignment.description || "",
      due_at: assignment.due_at,
      created_at: assignment.created_at,
      subject_id: assignment.subject_id || DEFAULT_SUBJECT_ID,
      subject_name: assignment.subject_name || assignment.subject || DEFAULT_SUBJECT_NAME,
      subject_theme_color: assignment.subject_theme_color || DEFAULT_SUBJECT_COLOR,
    }))
    .sort((left, right) => Date.parse(left.due_at || "") - Date.parse(right.due_at || ""));
}

function updateSummary(assignments) {
  if (!assignments.length) {
    assignmentsSummaryEl.textContent = "در حال حاضر تکلیف فعالی برای کلاس شما ثبت نشده است.";
    return;
  }

  const nextDue = assignments.find((item) => item.due_at);
  if (!nextDue) {
    assignmentsSummaryEl.textContent = `${assignments.length} تکلیف فعال ثبت شده است.`;
    return;
  }

  assignmentsSummaryEl.textContent = `${assignments.length} تکلیف فعال • نزدیک‌ترین موعد: ${formatJalali(nextDue.due_at)}`;
}

function setHomeworkContext(assignment) {
  localStorage.setItem(SUBJECT_ID_KEY, assignment.subject_id || DEFAULT_SUBJECT_ID);
  localStorage.setItem(SUBJECT_NAME_KEY, assignment.subject_name || DEFAULT_SUBJECT_NAME);
  localStorage.setItem(SUBJECT_COLOR_KEY, assignment.subject_theme_color || DEFAULT_SUBJECT_COLOR);
  localStorage.setItem(BOT_TYPE_KEY, DEFAULT_BOT_TYPE);
  localStorage.setItem(BOT_NAME_KEY, DEFAULT_BOT_NAME);
  localStorage.setItem(HOMEWORK_ID_KEY, String(assignment.id));
  localStorage.setItem(HOMEWORK_TITLE_KEY, assignment.title || "تکلیف کلاس");
  localStorage.setItem(
    HOMEWORK_MESSAGE_KEY,
    `برای شروع تکلیف «${assignment.title || "تکلیف"}» مرحله‌به‌مرحله راهنمایی‌ام کن.`
  );
}

function renderAssignments(assignments) {
  if (!assignments.length) {
    assignmentsListEl.innerHTML = '<p class="empty-note">تکلیف فعالی برای نمایش وجود ندارد.</p>';
    return;
  }

  assignmentsListEl.innerHTML = assignments
    .map((assignment) => {
      const tone = deadlineLabel(assignment.due_at);
      const description = assignment.description
        ? `<p class="muted">${escapeHtml(assignment.description)}</p>`
        : "";

      return `
        <article class="list-item-card">
          <p class="list-item-title"><strong>${escapeHtml(assignment.title)}</strong></p>
          ${description}
          <div class="list-item-meta">
            <span>${escapeHtml(assignment.subject_name)}</span>
            <span>مهلت: ${formatJalali(assignment.due_at)}</span>
          </div>
          <div>
            <span class="deadline-chip ${tone.tone}">وضعیت موعد: ${tone.text}</span>
          </div>
          <button
            class="list-item-action start-homework-btn"
            type="button"
            data-assignment-id="${escapeHtml(assignment.id)}"
          >
            شروع با دستیار تکالیف
          </button>
        </article>
      `;
    })
    .join("");

  assignmentsListEl.querySelectorAll(".start-homework-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const assignmentId = button.dataset.assignmentId;
      const selected = assignments.find((item) => String(item.id) === assignmentId);
      if (!selected) {
        showAlert("اطلاعات تکلیف برای شروع گفتگو کامل نیست.");
        return;
      }

      setHomeworkContext(selected);
      window.location.href = "/student/chat";
    });
  });
}

async function loadAssignments() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const res = await fetch("/api/student/assignments", {
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

    if (!res.ok || !Array.isArray(data.assignments)) {
      showAlert(data.message || "دریافت تکالیف با خطا مواجه شد.");
      renderAssignments([]);
      updateSummary([]);
      return;
    }

    const assignments = normalizeAssignments(data.assignments);
    localStorage.setItem(ASSIGNMENTS_CACHE_KEY, JSON.stringify(assignments));
    updateSummary(assignments);
    renderAssignments(assignments);
  } catch {
    showAlert("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کن.");
    renderAssignments([]);
    updateSummary([]);
  }
}

loadAssignments();
