const TOKEN_KEY = "student_token";

const refs = {
  alert: document.getElementById("student-gradebook-alert"),
  loading: document.getElementById("student-gradebook-loading"),
  content: document.getElementById("student-gradebook-content"),
  refresh: document.getElementById("gradebook-refresh"),
  updated: document.getElementById("student-gradebook-updated"),
  summary: document.getElementById("student-gradebook-summary"),
  subjects: document.getElementById("student-subject-averages"),
  gradesCount: document.getElementById("student-grades-count"),
  gradesTable: document.getElementById("student-grades-table"),
  attendanceRate: document.getElementById("student-attendance-rate"),
  attendanceTable: document.getElementById("student-attendance-table"),
  participationAverage: document.getElementById("student-participation-average"),
  participationTable: document.getElementById("student-participation-table"),
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function showAlert(message) {
  refs.alert.textContent = message;
  refs.alert.classList.remove("hidden");
}

function hideAlert() {
  refs.alert.textContent = "";
  refs.alert.classList.add("hidden");
}

function formatValue(value, suffix = "") {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function attendanceLabel(status) {
  return {
    present: "حاضر",
    absent: "غایب",
    late: "تأخیر",
    left_early: "خروج زودهنگام",
    excused: "غیبت موجه",
  }[status] || status || "—";
}

function gradeTypeLabel(type) {
  return {
    quiz: "کوییز",
    midterm: "میان‌ترم",
    final: "پایان‌ترم",
    homework: "تکلیف",
    project: "پروژه",
    exam: "آزمون",
    assignment: "تکلیف",
  }[type] || type || "—";
}

function renderEmpty(target, message) {
  target.innerHTML = `<p class="empty-note">${message}</p>`;
}

function renderSummary(data) {
  const gradeAverage = data.grade_average_percentage;
  const attendance = data.attendance_summary || {};
  const participation = data.participation_summary || {};

  refs.summary.innerHTML = `
    <div class="gradebook-summary">
      <div class="grade-stat"><span class="stat-label">میانگین کلی</span><span class="stat-value">${formatValue(gradeAverage, "%")}</span></div>
      <div class="grade-stat"><span class="stat-label">ارزیابی‌ها</span><span class="stat-value">${formatValue(data.assessment_count)}</span></div>
      <div class="grade-stat"><span class="stat-label">نرخ حضور</span><span class="stat-value">${formatValue(attendance.present_rate, "%")}</span></div>
      <div class="grade-stat"><span class="stat-label">میانگین مشارکت</span><span class="stat-value">${formatValue(participation.average_score)} / 5</span></div>
    </div>
  `;

  refs.gradesCount.textContent = `${data.assessment_count || 0} نمره`;
  refs.attendanceRate.textContent = `نرخ حضور: ${formatValue(attendance.present_rate, "%")}`;
  refs.participationAverage.textContent = `میانگین: ${formatValue(participation.average_score)} / 5`;
}

function renderSubjectAverages(subjectBreakdown) {
  if (!Array.isArray(subjectBreakdown) || !subjectBreakdown.length) {
    renderEmpty(refs.subjects, "هنوز میانگین درسی ثبت نشده است.");
    return;
  }

  refs.subjects.innerHTML = `
    <div class="student-gradebook-table-wrap">
      <table class="student-gradebook-table">
        <thead><tr><th>درس</th><th>میانگین</th><th>تعداد ارزیابی</th></tr></thead>
        <tbody>
          ${subjectBreakdown.map((item) => `<tr><td>${item.subject || "—"}</td><td>${formatValue(item.average_percentage, "%")}</td><td>${item.assessment_count || 0}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderGrades(grades) {
  if (!Array.isArray(grades) || !grades.length) {
    renderEmpty(refs.gradesTable, "هنوز نمره‌ای برای شما ثبت نشده است.");
    return;
  }

  refs.gradesTable.innerHTML = `
    <div class="student-gradebook-table-wrap">
      <table class="student-gradebook-table">
        <thead><tr><th>درس</th><th>نمره</th><th>درصد</th><th>نوع</th><th>تاریخ</th></tr></thead>
        <tbody>
          ${grades.map((grade) => `<tr><td>${grade.subject || "—"}</td><td>${formatValue(grade.score)} / ${formatValue(grade.max_score)}</td><td>${formatValue(grade.percentage, "%")}</td><td>${gradeTypeLabel(grade.assessment_type)}</td><td>${formatDate(grade.recorded_at)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAttendance(records) {
  if (!Array.isArray(records) || !records.length) {
    renderEmpty(refs.attendanceTable, "رکورد استثنایی ثبت نشده است؛ حضور شما در روزهای بدون رکورد، حاضر محاسبه می‌شود.");
    return;
  }

  refs.attendanceTable.innerHTML = `
    <ul class="mini-list">
      ${records.map((record) => `<li class="mini-list-item"><p><strong>${attendanceLabel(record.status)}</strong></p><div class="mini-list-meta"><span>${formatDate(record.date)}</span><span>${record.note || "بدون یادداشت"}</span></div></li>`).join("")}
    </ul>
  `;
}

function renderParticipation(records) {
  if (!Array.isArray(records) || !records.length) {
    renderEmpty(refs.participationTable, "هنوز رکورد مشارکت ثبت نشده است.");
    return;
  }

  refs.participationTable.innerHTML = `
    <ul class="mini-list">
      ${records.map((record) => `<li class="mini-list-item"><p><strong>امتیاز مشارکت</strong></p><div class="mini-list-meta"><span>${formatValue(record.score)} / 5</span><span>${formatDate(record.date)}</span><span>${record.note || "بدون یادداشت"}</span></div></li>`).join("")}
    </ul>
  `;
}

function renderGradebook(payload) {
  const report = payload.report_card || {};
  if (!report || typeof report !== "object") {
    renderEmpty(refs.summary, "اطلاعات کارنامه در دسترس نیست.");
    renderEmpty(refs.subjects, "اطلاعاتی برای نمایش وجود ندارد.");
    renderEmpty(refs.gradesTable, "اطلاعاتی برای نمایش وجود ندارد.");
    renderEmpty(refs.attendanceTable, "اطلاعاتی برای نمایش وجود ندارد.");
    renderEmpty(refs.participationTable, "اطلاعاتی برای نمایش وجود ندارد.");
    return;
  }
  renderSummary(report);
  renderSubjectAverages(report.subject_breakdown);
  renderGrades(report.recent_assessments);
  renderAttendance(payload.attendance_exceptions || []);
  renderParticipation(payload.participation_records || []);
}

async function loadGradebook() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();
  refs.refresh.disabled = true;
  refs.refresh.textContent = "در حال بروزرسانی...";

  try {
    const response = await fetch("/api/student/gradebook", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.replace("/student/login");
      return;
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || "کارنامه قابل دریافت نیست.");
    }

    renderGradebook(data);
    refs.updated.textContent = `آخرین بروزرسانی: ${new Intl.DateTimeFormat("fa-IR-u-ca-persian", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    refs.content.classList.remove("hidden");
  } catch (error) {
    showAlert(error.message || "خطا در دریافت کارنامه.");
  } finally {
    refs.loading.classList.add("hidden");
    refs.refresh.disabled = false;
    refs.refresh.textContent = "بروزرسانی";
  }
}

refs.refresh.addEventListener("click", loadGradebook);
loadGradebook();
