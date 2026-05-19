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
  }[type] || type || "—";
}

function renderEmpty(target, message) {
  target.innerHTML = `<p class="empty-note">${message}</p>`;
}

function renderSummary(data) {
  const average = data.average || {};
  const attendance = data.attendance || {};
  const participation = data.participation || {};

  refs.summary.innerHTML = `
    <div class="gradebook-summary">
      <div class="grade-stat"><span class="stat-label">میانگین کلی</span><span class="stat-value">${formatValue(average.average_percentage, "%")}</span></div>
      <div class="grade-stat"><span class="stat-label">GPA</span><span class="stat-value">${formatValue(average.gpa)}</span></div>
      <div class="grade-stat"><span class="stat-label">نرخ حضور</span><span class="stat-value">${formatValue(attendance.attendance_rate, "%")}</span></div>
      <div class="grade-stat"><span class="stat-label">میانگین مشارکت</span><span class="stat-value">${formatValue(participation.average_score)} / 10</span></div>
    </div>
  `;
  refs.updated.textContent = "آخرین بروزرسانی: اکنون";
  refs.gradesCount.textContent = `${average.total_grades || 0} نمره`;
  refs.attendanceRate.textContent = `نرخ حضور: ${formatValue(attendance.attendance_rate, "%")}`;
  refs.participationAverage.textContent = `میانگین: ${formatValue(participation.average_score)} / 10`;
}

function renderSubjectAverages(subjectAverages) {
  const entries = Object.entries(subjectAverages || {});
  if (!entries.length) {
    renderEmpty(refs.subjects, "هنوز میانگین درسی ثبت نشده است.");
    return;
  }

  refs.subjects.innerHTML = `
    <div class="student-gradebook-table-wrap">
      <table class="student-gradebook-table">
        <thead><tr><th>درس</th><th>میانگین</th><th>GPA</th><th>تعداد</th></tr></thead>
        <tbody>
          ${entries.map(([subject, avg]) => `<tr><td>${subject}</td><td>${formatValue(avg.average_percentage, "%")}</td><td>${formatValue(avg.gpa)}</td><td>${avg.total_grades || 0}</td></tr>`).join("")}
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
          ${grades.map((grade) => `<tr><td>${grade.subject}</td><td>${grade.score} / ${grade.max_score}</td><td>${grade.percentage}%</td><td>${gradeTypeLabel(grade.grade_type)}</td><td>${formatDate(grade.exam_date)}</td></tr>`).join("")}
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
      ${records.map((record) => `<li class="mini-list-item"><p><strong>${attendanceLabel(record.status)}</strong></p><div class="mini-list-meta"><span>${formatDate(record.date)}</span><span>${record.notes || "بدون یادداشت"}</span></div></li>`).join("")}
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
      ${records.map((record) => `<li class="mini-list-item"><p><strong>${record.activity}</strong></p><div class="mini-list-meta"><span>${record.score} / 10</span><span>${formatDate(record.date)}</span><span>${record.notes || "بدون یادداشت"}</span></div></li>`).join("")}
    </ul>
  `;
}

function renderGradebook(data) {
  renderSummary(data);
  renderSubjectAverages(data.subject_averages);
  renderGrades(data.grades);
  renderAttendance(data.attendance_records || data.recent_attendance);
  renderParticipation(data.participation_records || data.recent_participation);
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
    const response = await fetch("/api/gradebook/student/my-grades", {
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
