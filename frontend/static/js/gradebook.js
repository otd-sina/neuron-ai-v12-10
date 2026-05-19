(function () {
  checkAuth();

  const ATTENDANCE_STATUSES = [
    { value: "present", label: "حاضر" },
    { value: "absent", label: "غایب" },
    { value: "late", label: "تاخیر" },
    { value: "left_early", label: "خروج زودهنگام" },
    { value: "excused", label: "موجه" },
  ];

  const PERFORMANCE_LABELS = {
    excellent: "عالی",
    good: "خوب",
    needs_attention: "نیازمند توجه",
    at_risk: "در معرض افت",
    insufficient_data: "داده کافی نیست",
  };

  const state = {
    grades: [],
    classes: [],
    students: [],
    attendanceSheet: null,
    participationSheet: null,
    recordsById: {},
    editingRecordId: null,
  };

  const refs = {
    refreshOverviewButton: document.getElementById("gradebook-refresh-overview"),

    statAverage: document.getElementById("gb-stat-average"),
    statAttendance: document.getElementById("gb-stat-attendance"),
    statParticipation: document.getElementById("gb-stat-participation"),
    statRecordCount: document.getElementById("gb-stat-record-count"),

    gradeFormGrade: document.getElementById("grade-form-grade"),
    gradeFormClass: document.getElementById("grade-form-class"),
    gradeFormStudent: document.getElementById("grade-form-student"),
    gradeFormSubject: document.getElementById("grade-form-subject"),
    gradeFormType: document.getElementById("grade-form-type"),
    gradeFormTitle: document.getElementById("grade-form-title"),
    gradeFormScore: document.getElementById("grade-form-score"),
    gradeFormMaxScore: document.getElementById("grade-form-max-score"),
    gradeFormWeight: document.getElementById("grade-form-weight"),
    gradeFormRecordedDate: document.getElementById("grade-form-recorded-date"),
    gradeFormTerm: document.getElementById("grade-form-term"),
    gradeFormNotes: document.getElementById("grade-form-notes"),
    gradeFormMode: document.getElementById("grade-form-mode"),
    gradeFormCancel: document.getElementById("grade-form-cancel"),
    gradeFormSubmit: document.getElementById("grade-form-submit"),

    recordsFilterGrade: document.getElementById("records-filter-grade"),
    recordsFilterClass: document.getElementById("records-filter-class"),
    recordsFilterStudent: document.getElementById("records-filter-student"),
    recordsFilterSubject: document.getElementById("records-filter-subject"),
    recordsFilterRefresh: document.getElementById("records-filter-refresh"),
    recordsBody: document.getElementById("grade-records-body"),

    attendanceClass: document.getElementById("attendance-class"),
    attendanceDate: document.getElementById("attendance-date"),
    attendanceLoad: document.getElementById("attendance-load"),
    attendanceSave: document.getElementById("attendance-save"),
    attendanceSummary: document.getElementById("attendance-summary"),
    attendanceBody: document.getElementById("attendance-body"),

    participationClass: document.getElementById("participation-class"),
    participationDate: document.getElementById("participation-date"),
    participationLoad: document.getElementById("participation-load"),
    participationSave: document.getElementById("participation-save"),
    participationSummary: document.getElementById("participation-summary"),
    participationBody: document.getElementById("participation-body"),

    reportClass: document.getElementById("report-class"),
    reportStudent: document.getElementById("report-student"),
    reportLoad: document.getElementById("report-load"),
    reportAverage: document.getElementById("report-average"),
    reportAttendance: document.getElementById("report-attendance"),
    reportParticipation: document.getElementById("report-participation"),
    reportBand: document.getElementById("report-band"),
    reportSubjectBody: document.getElementById("report-subject-body"),
    reportRecentBody: document.getElementById("report-recent-body"),

    classAnalyticsClass: document.getElementById("class-analytics-class"),
    classAnalyticsLoad: document.getElementById("class-analytics-load"),
    classAvgGrade: document.getElementById("class-avg-grade"),
    classAvgAttendance: document.getElementById("class-avg-attendance"),
    classAvgParticipation: document.getElementById("class-avg-participation"),
    classTotalStudents: document.getElementById("class-total-students"),
    classTopBody: document.getElementById("class-top-body"),
    classRiskBody: document.getElementById("class-risk-body"),
    classSubjectBody: document.getElementById("class-subject-body"),
  };

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "—";
    }

    try {
      return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(parsed);
    } catch {
      return value;
    }
  }

  function formatNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : "—";
  }

  function formatPercent(value) {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(2)}%` : "—";
  }

  function toInt(value) {
    const num = Number(value);
    if (!Number.isInteger(num)) {
      return null;
    }
    return num;
  }

  async function fetchJson(url, options = {}) {
    const nextOptions = {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    };

    const response = await fetch(url, nextOptions);

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (response.status === 401) {
      window.location.href = "/";
      throw new Error("نشست شما منقضی شده است.");
    }

    if (!response.ok) {
      throw new Error(payload.message || `خطا در دریافت اطلاعات (${response.status})`);
    }

    return payload;
  }

  function clearSelect(selectEl) {
    while (selectEl.firstChild) {
      selectEl.removeChild(selectEl.firstChild);
    }
  }

  function fillSelect(selectEl, items, placeholder, mapFn) {
    clearSelect(selectEl);

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);

    items.forEach((item) => {
      const mapped = mapFn(item);
      const option = document.createElement("option");
      option.value = String(mapped.value);
      option.textContent = mapped.label;
      selectEl.appendChild(option);
    });
  }

  function classesByGrade(gradeId) {
    if (!gradeId) {
      return state.classes.slice();
    }
    return state.classes.filter((item) => String(item.grade_id) === String(gradeId));
  }

  function studentsByClass(classId) {
    if (!classId) {
      return state.students.slice();
    }
    return state.students.filter((item) => String(item.class_id) === String(classId));
  }

  function gradeNameMap() {
    const map = {};
    state.grades.forEach((grade) => {
      map[grade.id] = grade.name;
    });
    return map;
  }

  function classNameMap() {
    const map = {};
    state.classes.forEach((classItem) => {
      map[classItem.id] = classItem.name;
    });
    return map;
  }

  function studentNameMap() {
    const map = {};
    state.students.forEach((student) => {
      map[student.id] = student.full_name;
    });
    return map;
  }

  function syncGradeFormSelectors() {
    const selectedGrade = refs.gradeFormGrade.value;
    const classItems = classesByGrade(selectedGrade);
    const previousClass = refs.gradeFormClass.value;

    fillSelect(refs.gradeFormClass, classItems, "انتخاب کلاس...", (item) => ({
      value: item.id,
      label: item.name,
    }));

    if (previousClass && classItems.some((item) => String(item.id) === previousClass)) {
      refs.gradeFormClass.value = previousClass;
    }

    const studentItems = studentsByClass(refs.gradeFormClass.value);
    const previousStudent = refs.gradeFormStudent.value;

    fillSelect(refs.gradeFormStudent, studentItems, "انتخاب دانش‌آموز...", (item) => ({
      value: item.id,
      label: item.full_name,
    }));

    if (previousStudent && studentItems.some((item) => String(item.id) === previousStudent)) {
      refs.gradeFormStudent.value = previousStudent;
    }
  }

  function syncRecordFilterSelectors() {
    const selectedGrade = refs.recordsFilterGrade.value;
    const classItems = classesByGrade(selectedGrade);
    const previousClass = refs.recordsFilterClass.value;

    fillSelect(refs.recordsFilterClass, classItems, "همه کلاس‌ها", (item) => ({
      value: item.id,
      label: item.name,
    }));

    if (previousClass && classItems.some((item) => String(item.id) === previousClass)) {
      refs.recordsFilterClass.value = previousClass;
    }

    const studentItems = studentsByClass(refs.recordsFilterClass.value);
    const previousStudent = refs.recordsFilterStudent.value;

    fillSelect(refs.recordsFilterStudent, studentItems, "همه دانش‌آموزان", (item) => ({
      value: item.id,
      label: item.full_name,
    }));

    if (previousStudent && studentItems.some((item) => String(item.id) === previousStudent)) {
      refs.recordsFilterStudent.value = previousStudent;
    }
  }

  function syncReportStudents() {
    const classId = refs.reportClass.value;
    const studentItems = studentsByClass(classId);
    const previousStudent = refs.reportStudent.value;

    fillSelect(refs.reportStudent, studentItems, "انتخاب دانش‌آموز", (item) => ({
      value: item.id,
      label: item.full_name,
    }));

    if (previousStudent && studentItems.some((item) => String(item.id) === previousStudent)) {
      refs.reportStudent.value = previousStudent;
    }
  }

  function populateStaticSelectors() {
    fillSelect(refs.gradeFormGrade, state.grades, "انتخاب پایه...", (item) => ({
      value: item.id,
      label: item.name,
    }));

    fillSelect(refs.recordsFilterGrade, state.grades, "همه پایه‌ها", (item) => ({
      value: item.id,
      label: item.name,
    }));

    fillSelect(refs.attendanceClass, state.classes, "انتخاب کلاس", (item) => ({
      value: item.id,
      label: item.name,
    }));

    fillSelect(refs.participationClass, state.classes, "انتخاب کلاس", (item) => ({
      value: item.id,
      label: item.name,
    }));

    fillSelect(refs.reportClass, state.classes, "انتخاب کلاس", (item) => ({
      value: item.id,
      label: item.name,
    }));

    fillSelect(refs.classAnalyticsClass, state.classes, "انتخاب کلاس", (item) => ({
      value: item.id,
      label: item.name,
    }));

    syncGradeFormSelectors();
    syncRecordFilterSelectors();
    syncReportStudents();
  }

  function renderOverview(overview) {
    const average = overview?.average_score_percentage;
    const attendance = overview?.attendance?.present_rate;
    const participation = overview?.participation?.average_score;
    const recordCount = overview?.total_grade_records;

    refs.statAverage.textContent = formatPercent(average);
    refs.statAttendance.textContent = formatPercent(attendance);
    refs.statParticipation.textContent = Number.isFinite(Number(participation))
      ? `${Number(participation).toFixed(2)} / 5`
      : "—";
    refs.statRecordCount.textContent = Number.isFinite(Number(recordCount))
      ? String(recordCount)
      : "0";
  }

  function buildRecordsQuery() {
    const params = new URLSearchParams();

    if (refs.recordsFilterClass.value) {
      params.set("class_id", refs.recordsFilterClass.value);
    }

    if (refs.recordsFilterStudent.value) {
      params.set("student_id", refs.recordsFilterStudent.value);
    }

    const subject = refs.recordsFilterSubject.value.trim();
    if (subject) {
      params.set("subject", subject);
    }

    return params.toString();
  }

  function renderRecordsTable(records) {
    const studentMap = studentNameMap();

    if (!Array.isArray(records) || records.length === 0) {
      refs.recordsBody.innerHTML = '<tr><td colspan="10" class="empty-state-cell">رکوردی برای نمایش وجود ندارد.</td></tr>';
      return;
    }

    refs.recordsBody.innerHTML = records
      .map((record) => {
        const studentName = studentMap[record.student_id] || `دانش‌آموز ${record.student_id}`;
        return `
          <tr>
            <td>${record.id}</td>
            <td>${formatDate(record.recorded_at)}</td>
            <td>${studentName}</td>
            <td>${record.subject || "—"}</td>
            <td>${record.assessment_type || "—"}</td>
            <td>${record.title || "—"}</td>
            <td>${formatNumber(record.score)} / ${formatNumber(record.max_score)}</td>
            <td>${formatPercent(record.percentage)}</td>
            <td>${formatNumber(record.weight)}</td>
            <td>
              <button type="button" class="btn btn-outline btn-sm" data-edit-record="${record.id}">✏️ ویرایش</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-record="${record.id}">🗑️ حذف</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function resetGradeFormMode() {
    state.editingRecordId = null;
    refs.gradeFormMode.textContent = "در حالت ثبت نمره جدید هستید.";
    refs.gradeFormSubmit.textContent = "💾 ثبت نمره";
    refs.gradeFormCancel.style.display = "none";
  }

  function populateGradeFormForEdit(recordId) {
    const record = state.recordsById[recordId];
    if (!record) {
      showToast("رکورد انتخاب‌شده برای ویرایش پیدا نشد.", "error");
      return;
    }

    const classItem = state.classes.find((item) => String(item.id) === String(record.class_id));
    refs.gradeFormGrade.value = classItem ? String(classItem.grade_id) : "";
    syncGradeFormSelectors();

    refs.gradeFormClass.value = String(record.class_id || "");
    syncGradeFormSelectors();
    refs.gradeFormStudent.value = String(record.student_id || "");
    refs.gradeFormSubject.value = record.subject || "";
    refs.gradeFormType.value = record.assessment_type || "quiz";
    refs.gradeFormTitle.value = record.title || "";
    refs.gradeFormScore.value = Number.isFinite(Number(record.score)) ? String(record.score) : "";
    refs.gradeFormMaxScore.value = Number.isFinite(Number(record.max_score)) ? String(record.max_score) : "20";
    refs.gradeFormWeight.value = Number.isFinite(Number(record.weight)) ? String(record.weight) : "1";
    refs.gradeFormRecordedDate.value = record.recorded_at || todayIso();
    refs.gradeFormTerm.value = record.term || "";
    refs.gradeFormNotes.value = record.notes || "";

    state.editingRecordId = recordId;
    refs.gradeFormMode.textContent = `در حال ویرایش رکورد #${recordId} هستید.`;
    refs.gradeFormSubmit.textContent = "💾 بروزرسانی نمره";
    refs.gradeFormCancel.style.display = "inline-flex";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderAttendanceSheet(sheet) {
    state.attendanceSheet = sheet;

    const counts = sheet.counts || {};
    refs.attendanceSummary.textContent = [
      `تعداد دانش‌آموز: ${sheet.total_students ?? 0}`,
      `حاضر: ${counts.present ?? 0}`,
      `غایب: ${counts.absent ?? 0}`,
      `تاخیر: ${counts.late ?? 0}`,
      `خروج زودهنگام: ${counts.left_early ?? 0}`,
      `موجه: ${counts.excused ?? 0}`,
    ].join(" | ");

    const students = Array.isArray(sheet.students) ? sheet.students : [];
    if (!students.length) {
      refs.attendanceBody.innerHTML = '<tr><td colspan="5" class="empty-state-cell">دانش‌آموزی برای این کلاس ثبت نشده است.</td></tr>';
      return;
    }

    refs.attendanceBody.innerHTML = students
      .map((student, index) => {
        const options = ATTENDANCE_STATUSES.map((status) => {
          const selected = status.value === student.status ? "selected" : "";
          return `<option value="${status.value}" ${selected}>${status.label}</option>`;
        }).join("");

        return `
          <tr data-student-id="${student.student_id}">
            <td>${index + 1}</td>
            <td>${student.full_name || "—"}</td>
            <td>${student.national_id || "—"}</td>
            <td>
              <select class="attendance-status-select">
                ${options}
              </select>
            </td>
            <td>
              <input class="attendance-note-input" type="text" value="${student.note || ""}" placeholder="اختیاری" />
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function collectAttendanceExceptions() {
    const rows = Array.from(refs.attendanceBody.querySelectorAll("tr[data-student-id]"));
    const exceptions = [];

    rows.forEach((row) => {
      const studentId = toInt(row.dataset.studentId);
      const statusSelect = row.querySelector(".attendance-status-select");
      const noteInput = row.querySelector(".attendance-note-input");

      if (!studentId || !statusSelect) {
        return;
      }

      const status = statusSelect.value;
      const note = noteInput ? noteInput.value.trim() : "";

      if (status !== "present") {
        exceptions.push({
          student_id: studentId,
          status,
          note,
        });
      }
    });

    return exceptions;
  }

  function renderParticipationSheet(sheet) {
    state.participationSheet = sheet;

    refs.participationSummary.textContent = [
      `تعداد دانش‌آموز: ${sheet.total_students ?? 0}`,
      `دارای امتیاز: ${sheet.scored_students ?? 0}`,
      `میانگین مشارکت: ${Number.isFinite(Number(sheet.average_score)) ? Number(sheet.average_score).toFixed(2) : "—"}`,
    ].join(" | ");

    const students = Array.isArray(sheet.students) ? sheet.students : [];
    if (!students.length) {
      refs.participationBody.innerHTML = '<tr><td colspan="4" class="empty-state-cell">دانش‌آموزی برای این کلاس ثبت نشده است.</td></tr>';
      return;
    }

    refs.participationBody.innerHTML = students
      .map((student, index) => {
        const scoreValue = student.score === null || student.score === undefined ? "" : student.score;
        return `
          <tr data-student-id="${student.student_id}">
            <td>${index + 1}</td>
            <td>${student.full_name || "—"}</td>
            <td>
              <input class="participation-input" type="number" min="0" max="5" step="0.25" value="${scoreValue}" placeholder="—" />
            </td>
            <td>
              <input class="participation-note-input" type="text" value="${student.note || ""}" placeholder="اختیاری" />
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function collectParticipationEntries() {
    const rows = Array.from(refs.participationBody.querySelectorAll("tr[data-student-id]"));
    const entries = [];

    rows.forEach((row) => {
      const studentId = toInt(row.dataset.studentId);
      const scoreInput = row.querySelector(".participation-input");
      const noteInput = row.querySelector(".participation-note-input");

      if (!studentId || !scoreInput) {
        return;
      }

      const rawScore = scoreInput.value.trim();
      if (!rawScore) {
        return;
      }

      const score = Number(rawScore);
      if (!Number.isFinite(score)) {
        return;
      }

      entries.push({
        student_id: studentId,
        score,
        note: noteInput ? noteInput.value.trim() : "",
      });
    });

    return entries;
  }

  function renderReportCard(reportCard) {
    refs.reportAverage.textContent = formatPercent(reportCard.grade_average_percentage);
    refs.reportAttendance.textContent = formatPercent(reportCard.attendance_summary?.present_rate);

    const participationAverage = reportCard.participation_summary?.average_score;
    refs.reportParticipation.textContent = Number.isFinite(Number(participationAverage))
      ? `${Number(participationAverage).toFixed(2)} / 5`
      : "—";

    refs.reportBand.textContent = PERFORMANCE_LABELS[reportCard.performance_band] || "—";

    const subjectRows = Array.isArray(reportCard.subject_breakdown) ? reportCard.subject_breakdown : [];
    if (!subjectRows.length) {
      refs.reportSubjectBody.innerHTML = '<tr><td colspan="3" class="empty-state-cell">برای این دانش‌آموز هنوز نمره‌ای ثبت نشده است.</td></tr>';
    } else {
      refs.reportSubjectBody.innerHTML = subjectRows
        .map((row) => `
          <tr>
            <td>${row.subject || "—"}</td>
            <td>${row.assessment_count ?? 0}</td>
            <td>${formatPercent(row.average_percentage)}</td>
          </tr>
        `)
        .join("");
    }

    const recentRows = Array.isArray(reportCard.recent_assessments) ? reportCard.recent_assessments : [];
    if (!recentRows.length) {
      refs.reportRecentBody.innerHTML = '<tr><td colspan="5" class="empty-state-cell">ارزیابی اخیری ثبت نشده است.</td></tr>';
    } else {
      refs.reportRecentBody.innerHTML = recentRows
        .map((item) => `
          <tr>
            <td>${formatDate(item.recorded_at)}</td>
            <td>${item.subject || "—"}</td>
            <td>${item.title || "—"}</td>
            <td>${formatNumber(item.score)} / ${formatNumber(item.max_score)}</td>
            <td>${formatPercent(item.percentage)}</td>
          </tr>
        `)
        .join("");
    }
  }

  function renderSimpleStudentRows(bodyEl, rows, emptyMessage) {
    if (!Array.isArray(rows) || rows.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="3" class="empty-state-cell">${emptyMessage}</td></tr>`;
      return;
    }

    bodyEl.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>${row.full_name || "—"}</td>
            <td>${formatPercent(row.grade_average_percentage)}</td>
            <td>${formatPercent(row.attendance_rate)}</td>
          </tr>
        `,
      )
      .join("");
  }

  function renderClassSubjectRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      refs.classSubjectBody.innerHTML = '<tr><td colspan="3" class="empty-state-cell">اطلاعاتی برای این کلاس ثبت نشده است.</td></tr>';
      return;
    }

    refs.classSubjectBody.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>${row.subject || "—"}</td>
            <td>${row.assessment_count ?? 0}</td>
            <td>${formatPercent(row.average_percentage)}</td>
          </tr>
        `,
      )
      .join("");
  }

  function renderClassAnalytics(analytics) {
    refs.classAvgGrade.textContent = formatPercent(analytics.average_grade_percentage);
    refs.classAvgAttendance.textContent = formatPercent(analytics.average_attendance_rate);

    const participationAverage = analytics.average_participation_score;
    refs.classAvgParticipation.textContent = Number.isFinite(Number(participationAverage))
      ? `${Number(participationAverage).toFixed(2)} / 5`
      : "—";

    refs.classTotalStudents.textContent = Number.isFinite(Number(analytics.total_students))
      ? String(analytics.total_students)
      : "0";

    renderSimpleStudentRows(refs.classTopBody, analytics.top_performers, "برترین دانش‌آموزی برای نمایش وجود ندارد.");
    renderSimpleStudentRows(
      refs.classRiskBody,
      analytics.students_requiring_support,
      "دانش‌آموزی در وضعیت ریسک ثبت نشده است.",
    );
    renderClassSubjectRows(analytics.subject_performance);
  }

  async function loadOverview() {
    const response = await fetchJson("/api/gradebook/analytics/overview");
    renderOverview(response.overview || {});
  }

  async function loadRecords() {
    refs.recordsFilterRefresh.disabled = true;

    try {
      const query = buildRecordsQuery();
      const suffix = query ? `?${query}` : "";
      const response = await fetchJson(`/api/gradebook/records${suffix}`);
      const records = Array.isArray(response.records) ? response.records : [];
      state.recordsById = {};
      records.forEach((record) => {
        if (record && Number.isInteger(Number(record.id))) {
          state.recordsById[Number(record.id)] = record;
        }
      });
      renderRecordsTable(records);
    } finally {
      refs.recordsFilterRefresh.disabled = false;
    }
  }

  async function submitGradeRecord() {
    const classId = toInt(refs.gradeFormClass.value);
    const studentId = toInt(refs.gradeFormStudent.value);
    const score = Number(refs.gradeFormScore.value);
    const maxScore = Number(refs.gradeFormMaxScore.value);
    const weight = Number(refs.gradeFormWeight.value || "1");

    if (!classId || !studentId) {
      showToast("کلاس و دانش‌آموز را انتخاب کنید.", "error");
      return;
    }

    if (!refs.gradeFormSubject.value.trim() || !refs.gradeFormTitle.value.trim()) {
      showToast("درس و عنوان ارزیابی الزامی است.", "error");
      return;
    }

    if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
      showToast("مقادیر نمره معتبر نیست.", "error");
      return;
    }

    refs.gradeFormSubmit.disabled = true;
    refs.gradeFormSubmit.textContent = state.editingRecordId ? "در حال بروزرسانی..." : "در حال ثبت...";

    try {
      const isEditing = Number.isInteger(state.editingRecordId);
      const payload = {
        class_id: classId,
        student_id: studentId,
        subject: refs.gradeFormSubject.value.trim(),
        title: refs.gradeFormTitle.value.trim(),
        assessment_type: refs.gradeFormType.value,
        score,
        max_score: maxScore,
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
        term: refs.gradeFormTerm.value.trim(),
        notes: refs.gradeFormNotes.value.trim(),
      };

      if (refs.gradeFormRecordedDate.value) {
        payload.recorded_at = refs.gradeFormRecordedDate.value;
      } else if (!isEditing) {
        payload.recorded_at = null;
      }

      await fetchJson(
        isEditing ? `/api/gradebook/records/${state.editingRecordId}` : "/api/gradebook/records",
        {
          method: isEditing ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );

      showToast(isEditing ? "رکورد نمره بروزرسانی شد." : "نمره با موفقیت ثبت شد.");
      refs.gradeFormSubject.value = "";
      refs.gradeFormScore.value = "";
      refs.gradeFormTitle.value = "";
      refs.gradeFormTerm.value = "";
      refs.gradeFormNotes.value = "";
      resetGradeFormMode();
      await Promise.all([loadRecords(), loadOverview()]);
    } catch (error) {
      showToast(error.message || "خطا در ثبت یا بروزرسانی نمره", "error");
    } finally {
      refs.gradeFormSubmit.disabled = false;
      if (state.editingRecordId) {
        refs.gradeFormSubmit.textContent = "💾 بروزرسانی نمره";
      } else {
        refs.gradeFormSubmit.textContent = "💾 ثبت نمره";
      }
    }
  }

  async function deleteRecord(recordId) {
    if (!window.confirm("آیا از حذف این رکورد مطمئن هستید؟")) {
      return;
    }

    try {
      await fetchJson(`/api/gradebook/records/${recordId}`, { method: "DELETE" });
      showToast("رکورد نمره حذف شد.");
      if (state.editingRecordId === recordId) {
        resetGradeFormMode();
      }
      await Promise.all([loadRecords(), loadOverview()]);
    } catch (error) {
      showToast(error.message || "خطا در حذف رکورد", "error");
    }
  }

  async function loadAttendance() {
    const classId = toInt(refs.attendanceClass.value);
    if (!classId) {
      showToast("ابتدا کلاس را انتخاب کنید.", "error");
      return;
    }

    refs.attendanceLoad.disabled = true;
    refs.attendanceLoad.textContent = "در حال بارگذاری...";

    try {
      const date = refs.attendanceDate.value || todayIso();
      const response = await fetchJson(
        `/api/gradebook/attendance/sheet?class_id=${classId}&attendance_date=${encodeURIComponent(date)}`,
      );
      renderAttendanceSheet(response.sheet || {});
    } catch (error) {
      showToast(error.message || "خطا در بارگذاری حضور و غیاب", "error");
    } finally {
      refs.attendanceLoad.disabled = false;
      refs.attendanceLoad.textContent = "📥 بارگذاری کلاس";
    }
  }

  async function saveAttendance() {
    const classId = toInt(refs.attendanceClass.value);
    if (!classId) {
      showToast("ابتدا کلاس را انتخاب کنید.", "error");
      return;
    }

    const attendanceDate = refs.attendanceDate.value || todayIso();
    const exceptions = collectAttendanceExceptions();

    refs.attendanceSave.disabled = true;
    refs.attendanceSave.textContent = "در حال ذخیره...";

    try {
      const response = await fetchJson("/api/gradebook/attendance/sheet", {
        method: "POST",
        body: JSON.stringify({
          class_id: classId,
          attendance_date: attendanceDate,
          exceptions,
        }),
      });

      renderAttendanceSheet(response.sheet || {});
      showToast("حضور و غیاب کلاس ذخیره شد.");
      await Promise.all([loadOverview(), loadClassAnalyticsIfSelected(), loadReportIfSelected()]);
    } catch (error) {
      showToast(error.message || "خطا در ذخیره حضور و غیاب", "error");
    } finally {
      refs.attendanceSave.disabled = false;
      refs.attendanceSave.textContent = "💾 ذخیره حضور و غیاب کلاس";
    }
  }

  async function loadParticipation() {
    const classId = toInt(refs.participationClass.value);
    if (!classId) {
      showToast("ابتدا کلاس را انتخاب کنید.", "error");
      return;
    }

    refs.participationLoad.disabled = true;
    refs.participationLoad.textContent = "در حال بارگذاری...";

    try {
      const date = refs.participationDate.value || todayIso();
      const response = await fetchJson(
        `/api/gradebook/participation/sheet?class_id=${classId}&participation_date=${encodeURIComponent(date)}`,
      );
      renderParticipationSheet(response.sheet || {});
    } catch (error) {
      showToast(error.message || "خطا در بارگذاری مشارکت", "error");
    } finally {
      refs.participationLoad.disabled = false;
      refs.participationLoad.textContent = "📥 بارگذاری کلاس";
    }
  }

  async function saveParticipation() {
    const classId = toInt(refs.participationClass.value);
    if (!classId) {
      showToast("ابتدا کلاس را انتخاب کنید.", "error");
      return;
    }

    refs.participationSave.disabled = true;
    refs.participationSave.textContent = "در حال ذخیره...";

    try {
      const response = await fetchJson("/api/gradebook/participation/sheet", {
        method: "POST",
        body: JSON.stringify({
          class_id: classId,
          participation_date: refs.participationDate.value || todayIso(),
          entries: collectParticipationEntries(),
        }),
      });

      renderParticipationSheet(response.sheet || {});
      showToast("امتیاز مشارکت کلاس ذخیره شد.");
      await Promise.all([loadOverview(), loadClassAnalyticsIfSelected(), loadReportIfSelected()]);
    } catch (error) {
      showToast(error.message || "خطا در ذخیره مشارکت", "error");
    } finally {
      refs.participationSave.disabled = false;
      refs.participationSave.textContent = "💾 ذخیره مشارکت کلاس";
    }
  }

  async function loadReport() {
    const studentId = toInt(refs.reportStudent.value);
    if (!studentId) {
      showToast("ابتدا دانش‌آموز را انتخاب کنید.", "error");
      return;
    }

    refs.reportLoad.disabled = true;
    refs.reportLoad.textContent = "در حال بارگذاری...";

    try {
      const classId = refs.reportClass.value;
      const suffix = classId ? `?class_id=${encodeURIComponent(classId)}` : "";
      const response = await fetchJson(`/api/gradebook/report-card/${studentId}${suffix}`);
      renderReportCard(response.report_card || {});
    } catch (error) {
      showToast(error.message || "خطا در دریافت کارنامه", "error");
    } finally {
      refs.reportLoad.disabled = false;
      refs.reportLoad.textContent = "📄 نمایش کارنامه";
    }
  }

  async function loadClassAnalytics() {
    const classId = toInt(refs.classAnalyticsClass.value);
    if (!classId) {
      showToast("ابتدا کلاس را انتخاب کنید.", "error");
      return;
    }

    refs.classAnalyticsLoad.disabled = true;
    refs.classAnalyticsLoad.textContent = "در حال بارگذاری...";

    try {
      const response = await fetchJson(`/api/gradebook/class-analytics/${classId}`);
      renderClassAnalytics(response.analytics || {});
    } catch (error) {
      showToast(error.message || "خطا در دریافت تحلیل کلاس", "error");
    } finally {
      refs.classAnalyticsLoad.disabled = false;
      refs.classAnalyticsLoad.textContent = "📊 نمایش تحلیل کلاس";
    }
  }

  async function loadClassAnalyticsIfSelected() {
    if (!refs.classAnalyticsClass.value) {
      return;
    }
    await loadClassAnalytics();
  }

  async function loadReportIfSelected() {
    if (!refs.reportStudent.value) {
      return;
    }
    await loadReport();
  }

  function attachListeners() {
    refs.gradeFormGrade.addEventListener("change", syncGradeFormSelectors);
    refs.gradeFormClass.addEventListener("change", syncGradeFormSelectors);

    refs.recordsFilterGrade.addEventListener("change", syncRecordFilterSelectors);
    refs.recordsFilterClass.addEventListener("change", syncRecordFilterSelectors);
    refs.recordsFilterRefresh.addEventListener("click", loadRecords);

    refs.gradeFormSubmit.addEventListener("click", submitGradeRecord);
    refs.gradeFormCancel.addEventListener("click", resetGradeFormMode);
    refs.refreshOverviewButton.addEventListener("click", loadOverview);

    refs.attendanceLoad.addEventListener("click", loadAttendance);
    refs.attendanceSave.addEventListener("click", saveAttendance);

    refs.participationLoad.addEventListener("click", loadParticipation);
    refs.participationSave.addEventListener("click", saveParticipation);

    refs.reportClass.addEventListener("change", syncReportStudents);
    refs.reportLoad.addEventListener("click", loadReport);

    refs.classAnalyticsLoad.addEventListener("click", loadClassAnalytics);

    refs.recordsBody.addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-edit-record]");
      if (editButton) {
        const recordId = toInt(editButton.getAttribute("data-edit-record"));
        if (recordId) {
          populateGradeFormForEdit(recordId);
        }
        return;
      }

      const button = event.target.closest("[data-delete-record]");
      if (!button) {
        return;
      }

      const recordId = toInt(button.getAttribute("data-delete-record"));
      if (!recordId) {
        return;
      }

      deleteRecord(recordId);
    });
  }

  async function loadBootstrap() {
    const payload = await fetchJson("/api/gradebook/bootstrap");
    state.grades = Array.isArray(payload.grades) ? payload.grades : [];
    state.classes = Array.isArray(payload.classes) ? payload.classes : [];
    state.students = Array.isArray(payload.students) ? payload.students : [];

    populateStaticSelectors();

    refs.attendanceDate.value = todayIso();
    refs.participationDate.value = todayIso();
    refs.gradeFormRecordedDate.value = todayIso();
  }

  async function init() {
    try {
      attachListeners();
      resetGradeFormMode();
      await loadBootstrap();
      await Promise.all([loadOverview(), loadRecords()]);

      if (refs.attendanceClass.value) {
        await loadAttendance();
      }
      if (refs.participationClass.value) {
        await loadParticipation();
      }
      if (refs.classAnalyticsClass.value) {
        await loadClassAnalytics();
      }
    } catch (error) {
      showToast(error.message || "خطا در راه‌اندازی صفحه دفتر نمرات", "error");
    }
  }

  init();
})();
