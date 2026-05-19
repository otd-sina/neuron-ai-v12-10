const TOKEN_KEY = "student_token";
const STUDENT_KEY = "student_profile";
const ASSIGNMENTS_CACHE_KEY = "student_assignments_cache_v1";
const EXAMS_CACHE_KEY = "student_exams_cache_v1";
const WEAK_TOPICS_KEY = "student_weak_topics_v1";
const GRADEBOOK_SUMMARY_KEY = "student_gradebook_summary_v1";

const greetingEl = document.getElementById("greeting");
const assignmentContentEl = document.getElementById("assignment-content");
const recentExamsContentEl = document.getElementById("recent-exams-content");
const weaknessChipsEl = document.getElementById("weakness-chips");
const dashboardAlertEl = document.getElementById("dashboard-alert");
const loadingStateEl = document.getElementById("loading-state");
const dashboardContentEl = document.getElementById("dashboard-content");
const assignmentHintEl = document.getElementById("assignment-count-hint");
const examHintEl = document.getElementById("exam-count-hint");
const gradebookHintEl = document.getElementById("gradebook-hint");
const gradebookContentEl = document.getElementById("gradebook-content");

const logoutButton = document.getElementById("logout-button");
const startTutoringButton = document.getElementById("start-tutoring-button");
const viewAllAssignmentsButton = document.getElementById("view-all-assignments");
const viewAllExamsButton = document.getElementById("view-all-exams");
const viewGradebookDetailsButton = document.getElementById("view-gradebook-details");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STUDENT_KEY);
}

function showAlert(message) {
  dashboardAlertEl.textContent = message;
  dashboardAlertEl.classList.remove("hidden");
}

function hideAlert() {
  dashboardAlertEl.textContent = "";
  dashboardAlertEl.classList.add("hidden");
}

function formatJalali(dateValue) {
  if (!dateValue) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateValue));
  } catch {
    return "—";
  }
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setGreeting(name) {
  const finalName = name || "دانش‌آموز عزیز";
  greetingEl.textContent = `سلام ${finalName}، آماده‌ی یادگیری هوشمند هستی؟`;
}

function normalizeAssignments(activeAssignments) {
  if (!Array.isArray(activeAssignments)) {
    return [];
  }

  return activeAssignments
    .map((assignment, index) => ({
      id: assignment.id ?? `assignment-${index}`,
      title: assignment.title || "تکلیف بدون عنوان",
      subject: assignment.subject_name || assignment.subject || "بدون درس",
      due_at: assignment.due_at,
      description: assignment.description || "",
    }))
    .sort((left, right) => Date.parse(left.due_at || "") - Date.parse(right.due_at || ""));
}

function normalizeExams(recentExams, latestExam) {
  const incoming = Array.isArray(recentExams) ? recentExams : [];
  const source = incoming.length
    ? incoming
    : latestExam
      ? [latestExam]
      : [];

  return source
    .map((exam, index) => ({
      id: exam.exam_id || exam.id || `exam-${index}`,
      subject: exam.subject || "آزمون",
      score: exam.score,
      total: exam.total ?? 20,
      created_at: exam.created_at,
      weak_points: Array.isArray(exam.weak_points) ? exam.weak_points : [],
    }))
    .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""));
}

function normalizeWeakTopics(weakTopics, exams) {
  const fromApi = Array.isArray(weakTopics) ? weakTopics.filter(Boolean) : [];
  if (fromApi.length) {
    return fromApi.slice(0, 8);
  }

  const fromExams = exams.flatMap((exam) => (Array.isArray(exam.weak_points) ? exam.weak_points : []));
  return Array.from(new Set(fromExams.filter(Boolean))).slice(0, 8);
}

function normalizeGradebookSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return {
      grade_average_percentage: null,
      attendance_rate: null,
      participation_average: null,
      performance_band: null,
      strongest_subject: null,
      weakest_subject: null,
      assessment_count: 0,
      absent_count: 0,
    };
  }

  return {
    grade_average_percentage: summary.grade_average_percentage ?? null,
    attendance_rate: summary.attendance_rate ?? null,
    participation_average: summary.participation_average ?? null,
    performance_band: summary.performance_band ?? null,
    strongest_subject: summary.strongest_subject || null,
    weakest_subject: summary.weakest_subject || null,
    assessment_count: Number.isFinite(Number(summary.assessment_count)) ? Number(summary.assessment_count) : 0,
    absent_count: Number.isFinite(Number(summary.absent_count)) ? Number(summary.absent_count) : 0,
  };
}

function updateHints(assignments, exams, gradebookSummary) {
  assignmentHintEl.textContent = assignments.length
    ? `${assignments.length} تکلیف فعال`
    : "بدون تکلیف فعال";

  examHintEl.textContent = exams.length
    ? `${exams.length} نتیجه اخیر`
    : "هنوز نتیجه‌ای ثبت نشده";

  const assessments = Number(gradebookSummary?.assessment_count || 0);
  gradebookHintEl.textContent = assessments
    ? `${assessments} رکورد کارنامه`
    : "هنوز کارنامه‌ای ثبت نشده";
}

function renderAssignments(assignments) {
  const topAssignments = assignments.slice(0, 3);
  if (!topAssignments.length) {
    assignmentContentEl.innerHTML = '<p class="empty-note">در حال حاضر تکلیف فعالی ثبت نشده است.</p>';
    return;
  }

  assignmentContentEl.innerHTML = `
    <ul class="mini-list">
      ${topAssignments
        .map(
          (assignment) => `
            <li class="mini-list-item">
              <p><strong>${assignment.title}</strong></p>
              <div class="mini-list-meta">
                <span>${assignment.subject}</span>
                <span>مهلت: ${formatJalali(assignment.due_at)}</span>
              </div>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function renderRecentExams(exams) {
  const topExams = exams.slice(0, 3);
  if (!topExams.length) {
    recentExamsContentEl.innerHTML = '<p class="empty-note">هنوز نتیجه آزمونی برای نمایش ثبت نشده است.</p>';
    return;
  }

  recentExamsContentEl.innerHTML = `
    <ul class="mini-list">
      ${topExams
        .map((exam) => {
          const score = exam.score ?? "—";
          const total = exam.total ?? 20;
          return `
            <li class="mini-list-item">
              <p><strong>${exam.subject || "آزمون"}</strong></p>
              <div class="mini-list-meta">
                <span>نمره: ${score} / ${total}</span>
                <span>${formatJalali(exam.created_at)}</span>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function renderWeaknesses(topics) {
  if (!topics.length) {
    weaknessChipsEl.innerHTML = '<p class="empty-note">هنوز نقطه‌ضعف مشخصی ثبت نشده است.</p>';
    return;
  }

  weaknessChipsEl.innerHTML = topics
    .slice(0, 6)
    .map((topic) => `<span class="weakness-chip">${topic}</span>`)
    .join("");
}

function renderGradebookSummary(summary) {
  const participation = Number(summary.participation_average);
  const participationLabel = Number.isFinite(participation) ? `${participation.toFixed(2)} / 5` : "—";

  const performanceLabel = {
    excellent: "عالی",
    good: "خوب",
    needs_attention: "نیاز به توجه",
    at_risk: "در معرض افت",
    insufficient_data: "داده کافی نیست",
  }[summary.performance_band] || "—";

  const strongest = summary.strongest_subject || "ثبت نشده";
  const weakest = summary.weakest_subject || "ثبت نشده";
  const absences = Number(summary.absent_count || 0);

  gradebookContentEl.innerHTML = `
    <ul class="mini-list">
      <li class="mini-list-item">
        <p><strong>میانگین کارنامه:</strong> ${summary.grade_average_percentage === null ? "—" : `${Number(summary.grade_average_percentage).toFixed(2)}%`}</p>
        <div class="mini-list-meta">
          <span>وضعیت عملکرد: ${performanceLabel}</span>
          <span>حضور کلاس: ${summary.attendance_rate === null ? "—" : `${Number(summary.attendance_rate).toFixed(2)}%`}</span>
        </div>
      </li>
      <li class="mini-list-item">
        <p><strong>مشارکت کلاسی:</strong> ${participationLabel}</p>
        <div class="mini-list-meta">
          <span>بیشترین قوت: ${strongest}</span>
          <span>نیاز به تمرین: ${weakest}</span>
          <span>تعداد غیبت ثبت‌شده: ${absences}</span>
        </div>
      </li>
    </ul>
  `;
}

function cachePortalData(assignments, exams, weakTopics, gradebookSummary) {
  localStorage.setItem(ASSIGNMENTS_CACHE_KEY, JSON.stringify(assignments));
  localStorage.setItem(EXAMS_CACHE_KEY, JSON.stringify(exams));
  localStorage.setItem(WEAK_TOPICS_KEY, JSON.stringify(weakTopics));
  localStorage.setItem(GRADEBOOK_SUMMARY_KEY, JSON.stringify(gradebookSummary));
}

function applyCardAnimations() {
  const cards = document.querySelectorAll("[data-animate]");
  cards.forEach((card, index) => {
    card.style.setProperty("--card-order", index);
    card.classList.add("visible");
  });
}

function presentDashboard(student, assignments, exams, weakTopics, gradebookSummary) {
  setGreeting(student?.name || student?.full_name);
  updateHints(assignments, exams, gradebookSummary);
  renderAssignments(assignments);
  renderRecentExams(exams);
  renderWeaknesses(weakTopics);
  renderGradebookSummary(gradebookSummary);
  cachePortalData(assignments, exams, weakTopics, gradebookSummary);
  localStorage.setItem(STUDENT_KEY, JSON.stringify(student || {}));

  loadingStateEl.classList.add("hidden");
  dashboardContentEl.classList.remove("hidden");
  applyCardAnimations();
}

function renderCachedDashboard() {
  const cachedStudent = parseObjectCache(STUDENT_KEY) || {};
  const cachedAssignments = parseArrayCache(ASSIGNMENTS_CACHE_KEY);
  const cachedExams = parseArrayCache(EXAMS_CACHE_KEY);
  const cachedWeakTopics = parseArrayCache(WEAK_TOPICS_KEY);
  const cachedGradebookSummary = normalizeGradebookSummary(parseObjectCache(GRADEBOOK_SUMMARY_KEY));

  presentDashboard(cachedStudent, cachedAssignments, cachedExams, cachedWeakTopics, cachedGradebookSummary);
}

async function fetchDashboard() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const res = await fetch("/api/student/dashboard", {
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

    if (!res.ok || !data.dashboard) {
      showAlert(data.message || "اطلاعات داشبورد قابل دریافت نیست.");
      renderCachedDashboard();
      return;
    }

    const student = data.dashboard.student || {};
    const assignments = normalizeAssignments(data.dashboard.active_assignments || []);
    const exams = normalizeExams(data.dashboard.recent_exams, data.dashboard.latest_exam);
    const weakTopics = normalizeWeakTopics(data.dashboard.weak_topics, exams);
    const gradebookSummary = normalizeGradebookSummary(data.dashboard.gradebook_summary);
    presentDashboard(student, assignments, exams, weakTopics, gradebookSummary);
  } catch {
    showAlert("خطا در ارتباط با سرور. لطفاً دوباره تلاش کن.");
    renderCachedDashboard();
  } finally {
    loadingStateEl.classList.add("hidden");
  }
}

logoutButton.addEventListener("click", async () => {
  const token = getToken();

  if (!token) {
    clearSession();
    window.location.replace("/student/login");
    return;
  }

  logoutButton.disabled = true;
  logoutButton.textContent = "در حال خروج...";

  try {
    await fetch("/api/student/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Session is cleared locally even if the request fails.
  } finally {
    clearSession();
    window.location.replace("/student/login");
  }
});

startTutoringButton.addEventListener("click", () => {
  window.location.href = "/student/subjects";
});

viewAllAssignmentsButton.addEventListener("click", () => {
  window.location.href = "/student/assignments";
});

viewAllExamsButton.addEventListener("click", () => {
  window.location.href = "/student/exams";
});

fetchDashboard();


if (viewGradebookDetailsButton) {
  viewGradebookDetailsButton.addEventListener("click", () => {
    window.location.href = "/student/gradebook";
  });
}
