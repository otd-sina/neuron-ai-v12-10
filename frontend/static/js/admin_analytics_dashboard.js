(function () {
  const state = {
    students: [],
    stats: null,
    chartRows: [],
  };

  const refs = {
    refreshButton: document.getElementById("refresh-analytics"),
    lastUpdated: document.getElementById("last-updated"),
    statTotalStudents: document.getElementById("stat-total-students"),
    statAverageGpa: document.getElementById("stat-average-gpa"),
    statAtRisk: document.getElementById("stat-at-risk"),
    statTopWeakness: document.getElementById("stat-top-weakness"),
    statGradebookAverage: document.getElementById("stat-gradebook-average"),
    weakTopicsList: document.getElementById("weak-topics-list"),
    searchInput: document.getElementById("student-search"),
    gradeFilter: document.getElementById("grade-filter"),
    statusFilter: document.getElementById("status-filter"),
    studentsBody: document.getElementById("students-directory-body"),

    modal: document.getElementById("student-analytics-modal"),
    modalClose: document.getElementById("close-student-modal"),
    modalLoading: document.getElementById("student-modal-loading"),
    modalContent: document.getElementById("student-modal-content"),
    modalError: document.getElementById("student-modal-error"),
    modalSubtitle: document.getElementById("student-modal-subtitle"),
    modalGpa: document.getElementById("student-modal-gpa"),
    modalTotalExams: document.getElementById("student-modal-total-exams"),
    modalGrade: document.getElementById("student-modal-grade"),
    chartCanvas: document.getElementById("student-progress-chart"),
    chartEmpty: document.getElementById("chart-empty-note"),
    weaknessTags: document.getElementById("student-weakness-tags"),
    examHistoryBody: document.getElementById("student-exam-history-body"),
  };

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function formatGpa(value) {
    const num = toNumber(value);
    return num === null ? "—" : num.toFixed(2);
  }

  function formatPercentage(value) {
    const num = toNumber(value);
    return num === null ? "—" : `${num.toFixed(2)}%`;
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function updateLastUpdated() {
    refs.lastUpdated.textContent = `آخرین بروزرسانی: ${formatDateTime(new Date().toISOString())}`;
  }

  function getStudentStatus(gpaValue) {
    const gpa = toNumber(gpaValue);

    if (gpa === null) {
      return { key: "no-data", label: "بدون داده" };
    }
    if (gpa >= 3.5) {
      return { key: "excellent", label: "عالی" };
    }
    if (gpa >= 2.5) {
      return { key: "good", label: "خوب" };
    }
    if (gpa >= 1.5) {
      return { key: "warning", label: "نیاز به توجه" };
    }

    return { key: "danger", label: "بحرانی" };
  }

  function buildEmptyTable(message, colSpan) {
    refs.studentsBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.className = "empty-state-cell";
    cell.textContent = message;
    row.appendChild(cell);
    refs.studentsBody.appendChild(row);
  }

  function renderWeakTopics(topWeaknessTopics) {
    refs.weakTopicsList.innerHTML = "";

    if (!Array.isArray(topWeaknessTopics) || topWeaknessTopics.length === 0) {
      const item = document.createElement("li");
      item.className = "empty-state";
      item.textContent = "هنوز موضوع پرتکراری برای Needs Practice ثبت نشده است.";
      refs.weakTopicsList.appendChild(item);
      return;
    }

    topWeaknessTopics.forEach((entry) => {
      const item = document.createElement("li");

      const name = document.createElement("span");
      name.className = "weak-topic-name";
      name.textContent = entry.topic || "مبحث نامشخص";

      const count = document.createElement("span");
      count.className = "weak-topic-count";
      count.textContent = `${entry.count || 0} بار`;

      item.appendChild(name);
      item.appendChild(count);
      refs.weakTopicsList.appendChild(item);
    });
  }

  function populateGradeFilter() {
    const uniqueGrades = Array.from(
      new Set(
        state.students
          .map((student) => String(student.grade || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "fa"));

    refs.gradeFilter.innerHTML = '<option value="">همه پایه‌ها</option>';

    uniqueGrades.forEach((grade) => {
      const option = document.createElement("option");
      option.value = grade;
      option.textContent = grade;
      refs.gradeFilter.appendChild(option);
    });
  }

  function renderStudentsTable(students) {
    refs.studentsBody.innerHTML = "";

    if (!students.length) {
      buildEmptyTable("هیچ دانش‌آموزی با فیلتر انتخاب‌شده یافت نشد.", 8);
      return;
    }

    students.forEach((student) => {
      const status = getStudentStatus(student.current_gpa);
      const row = document.createElement("tr");

      const idCell = document.createElement("td");
      idCell.textContent = String(student.id ?? "—");

      const nameCell = document.createElement("td");
      nameCell.className = "analytics-name-cell";
      nameCell.textContent = student.full_name || "نام نامشخص";

      const gradeCell = document.createElement("td");
      gradeCell.textContent = student.grade || "نامشخص";

      const gpaCell = document.createElement("td");
      const gpaPill = document.createElement("span");
      gpaPill.className = "gpa-pill";
      gpaPill.textContent = formatGpa(student.current_gpa);
      gpaCell.appendChild(gpaPill);

      const examsCell = document.createElement("td");
      examsCell.textContent = String(student.total_exams ?? 0);

      const statusCell = document.createElement("td");
      const statusPill = document.createElement("span");
      statusPill.className = `status-pill ${status.key}`;
      statusPill.textContent = status.label;
      statusCell.appendChild(statusPill);

      const actionCell = document.createElement("td");
      actionCell.className = "analytics-actions-cell";
      
      const practiceButton = document.createElement("button");
      practiceButton.type = "button";
      practiceButton.className = "btn btn-outline btn-sm";
      practiceButton.dataset.studentId = String(student.id);
      practiceButton.dataset.source = "personal";
      practiceButton.textContent = "تحلیل تمرینی";
      practiceButton.title = "مشاهده تحلیل آزمون‌های تمرینی";
      
      const schoolButton = document.createElement("button");
      schoolButton.type = "button";
      schoolButton.className = "btn btn-outline btn-sm";
      schoolButton.dataset.studentId = String(student.id);
      schoolButton.dataset.source = "school";
      schoolButton.textContent = "تحلیل مدرسه";
      schoolButton.title = "مشاهده تحلیل آزمون‌های مدرسه";
      
      actionCell.appendChild(practiceButton);
      actionCell.appendChild(schoolButton);

      row.appendChild(idCell);
      row.appendChild(nameCell);
      row.appendChild(gradeCell);
      row.appendChild(gpaCell);
      row.appendChild(examsCell);
      row.appendChild(statusCell);
      row.appendChild(actionCell);

      refs.studentsBody.appendChild(row);
    });
  }

  function applyStudentFilters() {
    const query = refs.searchInput.value.trim().toLowerCase();
    const grade = refs.gradeFilter.value;
    const selectedStatus = refs.statusFilter.value;

    const filtered = state.students.filter((student) => {
      const name = String(student.full_name || "").toLowerCase();
      const studentGrade = String(student.grade || "");
      const status = getStudentStatus(student.current_gpa);

      if (query && !name.includes(query)) {
        return false;
      }
      if (grade && studentGrade !== grade) {
        return false;
      }
      if (selectedStatus && status.key !== selectedStatus) {
        return false;
      }

      return true;
    });

    renderStudentsTable(filtered);
  }

  function calculateAtRiskCount() {
    return state.students.filter((student) => {
      const gpa = toNumber(student.current_gpa);
      return gpa !== null && gpa < 2.5;
    }).length;
  }

  function renderStats(stats) {
    const topWeakness = Array.isArray(stats.top_weakness_topics) && stats.top_weakness_topics.length
      ? stats.top_weakness_topics[0].topic
      : "—";
    const gradebookAverage = stats?.gradebook_overview?.average_score_percentage;

    refs.statTotalStudents.textContent = String(stats.total_students ?? state.students.length ?? 0);
    refs.statAverageGpa.textContent = formatGpa(stats.average_gpa);
    refs.statTopWeakness.textContent = topWeakness;
    refs.statAtRisk.textContent = String(calculateAtRiskCount());
    if (refs.statGradebookAverage) {
      refs.statGradebookAverage.textContent = gradebookAverage === null || gradebookAverage === undefined
        ? "—"
        : `${Number(gradebookAverage).toFixed(2)}%`;
    }

    renderWeakTopics(stats.top_weakness_topics || []);
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (response.status === 401) {
      window.location.href = "/";
      throw new Error("احراز هویت نامعتبر است.");
    }

    if (!response.ok) {
      throw new Error(payload.message || `خطا در دریافت اطلاعات (${response.status})`);
    }

    return payload;
  }

  async function loadDashboardData() {
    refs.refreshButton.disabled = true;
    refs.refreshButton.textContent = "در حال بروزرسانی...";

    try {
      const [stats, studentsResponse] = await Promise.all([
        fetchJson("/api/admin/dashboard-stats"),
        fetchJson("/api/admin/students"),
      ]);

      state.stats = stats;
      state.students = Array.isArray(studentsResponse.students)
        ? studentsResponse.students.slice().sort((a, b) => {
            const gpaA = toNumber(a.current_gpa);
            const gpaB = toNumber(b.current_gpa);
            if (gpaA === null && gpaB === null) {
              return (a.id || 0) - (b.id || 0);
            }
            if (gpaA === null) {
              return 1;
            }
            if (gpaB === null) {
              return -1;
            }
            return gpaB - gpaA;
          })
        : [];

      populateGradeFilter();
      renderStats(state.stats);
      applyStudentFilters();
      updateLastUpdated();
    } catch (error) {
      buildEmptyTable("خطا در دریافت داده‌های دانش‌آموزان.", 7);
      refs.weakTopicsList.innerHTML = '<li class="empty-state">اطلاعات تحلیلی قابل دریافت نیست.</li>';
      showToast(error.message || "خطا در بارگذاری داشبورد", "error");
    } finally {
      refs.refreshButton.disabled = false;
      refs.refreshButton.textContent = "🔄 بروزرسانی داده‌ها";
    }
  }

  function closeStudentModal() {
    refs.modal.classList.remove("open");
    state.chartRows = [];
    clearBarChart();
  }

  function openStudentModal() {
    refs.modal.classList.add("open");
    refs.modalLoading.classList.remove("is-hidden");
    refs.modalContent.classList.add("is-hidden");
    refs.modalError.classList.add("is-hidden");
    refs.modalError.textContent = "";
    refs.chartEmpty.textContent = "برای این دانش‌آموز داده کافی جهت رسم نمودار وجود ندارد.";
    refs.chartEmpty.classList.add("is-hidden");
  }

  function renderWeaknessTags(weaknessBreakdown, fallbackWeaknesses) {
    refs.weaknessTags.innerHTML = "";

    const hasBreakdown = Array.isArray(weaknessBreakdown) && weaknessBreakdown.length > 0;

    if (hasBreakdown) {
      weaknessBreakdown.forEach((entry) => {
        const tag = document.createElement("span");
        tag.className = "weakness-tag";

        const count = document.createElement("small");
        count.className = "weakness-tag-count";
        count.textContent = `${entry.count || 0}×`;

        tag.textContent = entry.topic || "مبحث نامشخص";
        tag.appendChild(count);
        refs.weaknessTags.appendChild(tag);
      });
      return;
    }

    const weaknesses = Array.isArray(fallbackWeaknesses) ? fallbackWeaknesses : [];
    if (!weaknesses.length) {
      const emptyText = document.createElement("p");
      emptyText.className = "empty-state";
      emptyText.textContent = "نقطه ضعف ثبت‌شده‌ای برای این دانش‌آموز وجود ندارد.";
      refs.weaknessTags.appendChild(emptyText);
      return;
    }

    weaknesses.forEach((topic) => {
      const tag = document.createElement("span");
      tag.className = "weakness-tag";
      tag.textContent = String(topic || "مبحث نامشخص");
      refs.weaknessTags.appendChild(tag);
    });
  }

  function renderExamHistory(examHistory) {
    refs.examHistoryBody.innerHTML = "";

    if (!Array.isArray(examHistory) || examHistory.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty-state-cell";
      cell.textContent = "تاریخچه آزمونی برای نمایش وجود ندارد.";
      row.appendChild(cell);
      refs.examHistoryBody.appendChild(row);
      return;
    }

    examHistory.forEach((exam) => {
      const row = document.createElement("tr");

      const dateCell = document.createElement("td");
      dateCell.textContent = formatDate(exam.date);

      const subjectCell = document.createElement("td");
      subjectCell.textContent = exam.subject || "آزمون";

      const scoreCell = document.createElement("td");
      scoreCell.textContent = exam.score !== null && exam.score !== undefined ? String(exam.score) : "—";

      const percentageCell = document.createElement("td");
      percentageCell.textContent = formatPercentage(exam.percentage);

      row.appendChild(dateCell);
      row.appendChild(subjectCell);
      row.appendChild(scoreCell);
      row.appendChild(percentageCell);

      refs.examHistoryBody.appendChild(row);
    });
  }

  function getCanvasMetrics(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(240, rect.width || canvas.clientWidth || 240);
    const height = Math.max(170, rect.height || canvas.clientHeight || 220);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, width, height };
  }

  function clearBarChart() {
    const { ctx, width, height } = getCanvasMetrics(refs.chartCanvas);
    ctx.clearRect(0, 0, width, height);
  }

  function drawBarChart(rows) {
    const { ctx, width, height } = getCanvasMetrics(refs.chartCanvas);
    ctx.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.body);
    const isRtl = document.documentElement.dir === "rtl";
    const readVar = (name, fallback) => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };

    const chartPadding = {
      top: 12,
      right: 12,
      bottom: 34,
      left: 36,
    };

    const axisX = isRtl ? width - chartPadding.right : chartPadding.left;
    const oppositeEdge = isRtl ? chartPadding.left : width - chartPadding.right;
    const plotStart = Math.min(axisX, oppositeEdge);
    const plotEnd = Math.max(axisX, oppositeEdge);
    const plotWidth = plotEnd - plotStart;
    const plotHeight = height - chartPadding.top - chartPadding.bottom;
    if (plotWidth <= 0 || plotHeight <= 0) {
      return;
    }

    const yTicks = [0, 25, 50, 75, 100];

    ctx.lineWidth = 1;
    ctx.strokeStyle = readVar("--chart-grid-color", "rgba(148, 187, 237, 0.24)");
    ctx.fillStyle = readVar("--chart-label-color", "#9ec6f3");
    ctx.font = "11px Tahoma";
    ctx.textAlign = isRtl ? "left" : "right";
    ctx.textBaseline = "middle";

    yTicks.forEach((tick) => {
      const y = chartPadding.top + plotHeight - (tick / 100) * plotHeight;

      ctx.beginPath();
      ctx.moveTo(plotStart, y);
      ctx.lineTo(plotEnd, y);
      ctx.stroke();

      const tickLabelX = isRtl ? axisX + 6 : axisX - 6;
      ctx.fillText(`${tick}%`, tickLabelX, y);
    });

    ctx.strokeStyle = readVar("--chart-axis-color", "rgba(178, 210, 248, 0.5)");
    ctx.beginPath();
    ctx.moveTo(axisX, chartPadding.top);
    ctx.lineTo(axisX, chartPadding.top + plotHeight);
    ctx.lineTo(oppositeEdge, chartPadding.top + plotHeight);
    ctx.stroke();

    const maxBars = Math.min(rows.length, 12);
    const visibleRows = rows.slice(-maxBars);
    const slotWidth = plotWidth / maxBars;
    const barWidth = Math.min(36, slotWidth * 0.58);

    function fillRoundedBar(x, y, widthValue, heightValue) {
      const radius = Math.min(6, widthValue / 2, heightValue / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + widthValue - radius, y);
      ctx.quadraticCurveTo(x + widthValue, y, x + widthValue, y + radius);
      ctx.lineTo(x + widthValue, y + heightValue - radius);
      ctx.quadraticCurveTo(x + widthValue, y + heightValue, x + widthValue - radius, y + heightValue);
      ctx.lineTo(x + radius, y + heightValue);
      ctx.quadraticCurveTo(x, y + heightValue, x, y + heightValue - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
    }

    visibleRows.forEach((row, index) => {
      const value = Math.max(0, Math.min(100, toNumber(row.percentage) || 0));
      const barHeight = (value / 100) * plotHeight;
      const x = isRtl
        ? plotEnd - (index + 1) * slotWidth + (slotWidth - barWidth) / 2
        : plotStart + index * slotWidth + (slotWidth - barWidth) / 2;
      const y = chartPadding.top + plotHeight - barHeight;

      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, readVar("--chart-bar-start", "rgba(103, 232, 249, 0.95)"));
      gradient.addColorStop(1, readVar("--chart-bar-end", "rgba(59, 130, 246, 0.9)"));

      ctx.fillStyle = gradient;
      fillRoundedBar(x, y, barWidth, barHeight);

      ctx.fillStyle = readVar("--chart-value-color", "#d8ecff");
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${value.toFixed(0)}%`, x + barWidth / 2, y - 4);

      ctx.fillStyle = readVar("--chart-label-color", "#9ec6f3");
      ctx.textBaseline = "top";
      ctx.fillText(formatDate(row.date), x + barWidth / 2, chartPadding.top + plotHeight + 6);
    });
  }

  function normalizeChartRows(progressData) {
    if (!Array.isArray(progressData)) {
      return [];
    }

    return progressData
      .filter((item) => toNumber(item.percentage) !== null)
      .sort((a, b) => {
        const first = new Date(a.date || 0).getTime();
        const second = new Date(b.date || 0).getTime();
        return first - second;
      });
  }

  function renderProgressChart(progressData) {
    const rows = normalizeChartRows(progressData);
    state.chartRows = rows;

    if (!rows.length) {
      clearBarChart();
      refs.chartEmpty.classList.remove("is-hidden");
      return;
    }

    refs.chartEmpty.classList.add("is-hidden");
    drawBarChart(rows);
  }

  function redrawIfNeeded() {
    if (!refs.modal.classList.contains("open")) {
      return;
    }

    if (!state.chartRows.length) {
      clearBarChart();
      return;
    }

    drawBarChart(state.chartRows);
  }

  async function loadStudentAnalytics(studentId, source) {
    openStudentModal();

    try {
      const url = source 
        ? `/api/admin/students/${studentId}/analytics?source=${encodeURIComponent(source)}`
        : `/api/admin/students/${studentId}/analytics`;
      
      const payload = await fetchJson(url);
      const student = payload.student || {};
      
      // Update modal title to show source filter
      const sourceLabel = source === "personal" ? " (آزمون‌های تمرینی)" : source === "school" ? " (آزمون‌های مدرسه)" : "";
      refs.modalSubtitle.textContent = `${student.full_name || "دانش‌آموز"} • کد ${student.id || "—"}${sourceLabel}`;
      refs.modalGpa.textContent = formatGpa(payload.current_gpa);
      refs.modalTotalExams.textContent = String(Array.isArray(payload.exam_history) ? payload.exam_history.length : 0);
      refs.modalGrade.textContent = student.grade || "نامشخص";

      renderWeaknessTags(payload.weakness_breakdown, payload.weaknesses);
      renderExamHistory(payload.exam_history || []);

      refs.modalLoading.classList.add("is-hidden");
      refs.modalContent.classList.remove("is-hidden");

      requestAnimationFrame(() => {
        renderProgressChart(payload.progress_data || []);
      });
    } catch (error) {
      refs.modalLoading.classList.add("is-hidden");
      refs.modalError.textContent = error.message || "خطا در دریافت تحلیل دانش‌آموز.";
      refs.modalError.classList.remove("is-hidden");
    }
  }

  function bindEvents() {
    refs.refreshButton.addEventListener("click", loadDashboardData);

    refs.searchInput.addEventListener("input", applyStudentFilters);
    refs.gradeFilter.addEventListener("change", applyStudentFilters);
    refs.statusFilter.addEventListener("change", applyStudentFilters);

    refs.studentsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-student-id]");
      if (!button) {
        return;
      }

      const studentId = Number(button.dataset.studentId);
      const source = button.dataset.source || null;
      
      if (!Number.isFinite(studentId)) {
        return;
      }

      loadStudentAnalytics(studentId, source);
    });

    refs.modalClose.addEventListener("click", closeStudentModal);

    refs.modal.addEventListener("click", (event) => {
      if (event.target === refs.modal) {
        closeStudentModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && refs.modal.classList.contains("open")) {
        closeStudentModal();
      }
    });

    window.addEventListener("resize", () => {
      // Redraw chart to keep crisp bars and spacing after layout resize.
      redrawIfNeeded();
    });

    window.addEventListener("admin-theme-change", redrawIfNeeded);
  }

  function init() {
    checkAuth();
    bindEvents();
    loadDashboardData();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
