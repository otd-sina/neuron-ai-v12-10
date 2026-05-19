checkAuth();

const state = {
  grades: [],
  classes: [],
  creating: false,
};

const els = {
  title: document.getElementById("exam-title"),
  subject: document.getElementById("exam-subject"),
  grade: document.getElementById("exam-grade"),
  classSelect: document.getElementById("exam-class"),
  startTime: document.getElementById("exam-start-time"),
  duration: document.getElementById("exam-duration"),
  totalQuestions: document.getElementById("exam-total-questions"),
  focusArea: document.getElementById("exam-focus-area"),
  diffEasy: document.getElementById("diff-easy"),
  diffMedium: document.getElementById("diff-medium"),
  diffHard: document.getElementById("diff-hard"),
  diffGifted: document.getElementById("diff-gifted"),
  difficultySummary: document.getElementById("difficulty-summary"),
  error: document.getElementById("create-exam-error"),
  success: document.getElementById("create-exam-success"),
  generateButton: document.getElementById("generate-exam-btn"),
  loading: document.getElementById("generate-loading"),
  filterGrade: document.getElementById("exam-filter-grade"),
  filterClass: document.getElementById("exam-filter-class"),
  reloadExamsButton: document.getElementById("reload-exams-btn"),
  examsTableBody: document.getElementById("school-exams-table-body"),
};

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMatrix() {
  return {
    easy: Math.max(0, parseIntSafe(els.diffEasy.value, 0)),
    medium: Math.max(0, parseIntSafe(els.diffMedium.value, 0)),
    hard: Math.max(0, parseIntSafe(els.diffHard.value, 0)),
    gifted: Math.max(0, parseIntSafe(els.diffGifted.value, 0)),
  };
}

function matrixTotal(matrix) {
  return matrix.easy + matrix.medium + matrix.hard + matrix.gifted;
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("fa-IR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function hideMessages() {
  els.error.classList.add("is-hidden");
  els.error.textContent = "";
  els.success.classList.add("is-hidden");
  els.success.textContent = "";
}

function showError(message) {
  els.error.textContent = message;
  els.error.classList.remove("is-hidden");
}

function showSuccess(message) {
  els.success.textContent = message;
  els.success.classList.remove("is-hidden");
}

function setCreating(isCreating) {
  state.creating = isCreating;
  els.generateButton.disabled = isCreating;
  els.loading.classList.toggle("is-hidden", !isCreating);
}

function updateDifficultySummary() {
  const matrix = getMatrix();
  const totalFromMatrix = matrixTotal(matrix);
  const totalRequested = Math.max(1, parseIntSafe(els.totalQuestions.value, 1));

  els.totalQuestions.value = String(Math.min(50, totalRequested));
  els.diffEasy.value = String(matrix.easy);
  els.diffMedium.value = String(matrix.medium);
  els.diffHard.value = String(matrix.hard);
  els.diffGifted.value = String(matrix.gifted);

  const isMatch = totalFromMatrix === parseIntSafe(els.totalQuestions.value, 1);
  els.difficultySummary.textContent = `جمع ماتریس: ${totalFromMatrix} / تعداد کل: ${els.totalQuestions.value}`;
  els.difficultySummary.classList.toggle("ok", isMatch);
  els.difficultySummary.classList.toggle("warn", !isMatch);
}

function setDefaultStartTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  now.setSeconds(0);
  now.setMilliseconds(0);

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  els.startTime.value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

function populateClassOptions(targetSelect, gradeId, includeAllClassesOption) {
  const selectedGradeId = parseIntSafe(gradeId, 0);
  const filtered = selectedGradeId
    ? state.classes.filter((item) => item.grade_id === selectedGradeId)
    : state.classes;

  const options = [];
  if (includeAllClassesOption) {
    options.push('<option value="all">همه کلاس‌های این پایه</option>');
  }

  if (!filtered.length) {
    options.push('<option value="" disabled>کلاسی یافت نشد</option>');
  } else {
    for (const classObj of filtered) {
      options.push(`<option value="${classObj.id}">${classObj.name}</option>`);
    }
  }

  targetSelect.innerHTML = options.join("");
}

function renderFilterClassOptions(gradeId) {
  const selectedGradeId = parseIntSafe(gradeId, 0);
  const filtered = selectedGradeId
    ? state.classes.filter((item) => item.grade_id === selectedGradeId)
    : state.classes;

  const options = ['<option value="">همه کلاس‌ها</option>', '<option value="all_classes">فقط آزمون‌های عمومی پایه</option>'];

  for (const classObj of filtered) {
    options.push(`<option value="${classObj.id}">${classObj.name}</option>`);
  }

  els.filterClass.innerHTML = options.join("");
}

function renderGradeOptions() {
  const gradeOptions = ['<option value="">انتخاب پایه...</option>'];
  const filterOptions = ['<option value="">همه پایه‌ها</option>'];

  for (const grade of state.grades) {
    gradeOptions.push(`<option value="${grade.id}">${grade.name}</option>`);
    filterOptions.push(`<option value="${grade.id}">${grade.name}</option>`);
  }

  els.grade.innerHTML = gradeOptions.join("");
  els.filterGrade.innerHTML = filterOptions.join("");

  if (state.grades.length > 0) {
    els.grade.value = String(state.grades[0].id);
    populateClassOptions(els.classSelect, els.grade.value, true);
  } else {
    els.classSelect.innerHTML = '<option value="" disabled>ابتدا پایه بسازید</option>';
  }

  renderFilterClassOptions(els.filterGrade.value);
}

async function loadMetaData() {
  const [gradeResponse, classResponse] = await Promise.all([
    fetch("/api/grades"),
    fetch("/api/classes"),
  ]);

  if (!gradeResponse.ok || !classResponse.ok) {
    throw new Error("دریافت پایه‌ها و کلاس‌ها با خطا مواجه شد.");
  }

  const gradeData = await gradeResponse.json();
  const classData = await classResponse.json();

  state.grades = Array.isArray(gradeData.grades) ? gradeData.grades : [];
  state.classes = Array.isArray(classData.classes) ? classData.classes : [];

  renderGradeOptions();
}

function buildStatusBadge(status) {
  if (status === "live") {
    return '<span class="badge status-live">فعال</span>';
  }
  if (status === "scheduled") {
    return '<span class="badge status-scheduled">زمان‌بندی‌شده</span>';
  }
  if (status === "expired") {
    return '<span class="badge status-expired">پایان‌یافته</span>';
  }
  return '<span class="badge badge-gray">نامشخص</span>';
}

async function loadSchoolExams() {
  els.examsTableBody.innerHTML = '<tr><td colspan="9" class="empty-state-cell">در حال بارگذاری آزمون‌ها...</td></tr>';

  const params = new URLSearchParams();
  if (els.filterGrade.value) {
    params.set("grade_id", els.filterGrade.value);
  }

  if (els.filterClass.value === "all_classes") {
    params.set("class_id", "-1");
  } else if (els.filterClass.value) {
    params.set("class_id", els.filterClass.value);
  }

  const url = params.toString() ? `/api/school-exams?${params.toString()}` : "/api/school-exams";
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "بارگذاری آزمون‌های مدرسه ناموفق بود.");
  }

  const exams = Array.isArray(data.exams) ? data.exams : [];
  if (!exams.length) {
    els.examsTableBody.innerHTML = '<tr><td colspan="9" class="empty-state-cell">آزمونی ثبت نشده است.</td></tr>';
    return;
  }

  els.examsTableBody.innerHTML = exams
    .map((exam) => {
      const classLabel = exam.class_name || "همه کلاس‌ها";
      const gradeLabel = exam.grade_name || `پایه ${exam.grade_id ?? "-"}`;
      const examId = exam.id ?? exam.exam_id ?? "-";
      return `
        <tr>
          <td>${examId}</td>
          <td><strong>${exam.title || "—"}</strong></td>
          <td>${exam.subject || "—"}</td>
          <td>${gradeLabel}</td>
          <td>${classLabel}</td>
          <td>${formatDateTime(exam.start_time)}</td>
          <td>${exam.duration || "-"} دقیقه</td>
          <td>${buildStatusBadge(exam.status)}</td>
          <td>
            <button class="btn-delete-exam" data-exam-id="${examId}" title="حذف آزمون">🗑️</button>
          </td>
        </tr>
      `;
    })
    .join("");

  attachDeleteEventListeners();
}

function validateForm() {
  const title = els.title.value.trim();
  const subject = els.subject.value.trim();
  const gradeId = parseIntSafe(els.grade.value, 0);
  const classValue = els.classSelect.value;
  const focusArea = els.focusArea.value.trim();
  const duration = parseIntSafe(els.duration.value, 0);
  const totalQuestions = parseIntSafe(els.totalQuestions.value, 0);
  const matrix = getMatrix();
  const startRaw = els.startTime.value;

  if (!title || !subject || !focusArea || !startRaw) {
    return { error: "لطفاً همه فیلدهای ستاره‌دار را کامل کنید." };
  }

  if (!gradeId) {
    return { error: "انتخاب پایه الزامی است." };
  }

  if (duration < 1 || duration > 240) {
    return { error: "مدت آزمون باید بین ۱ تا ۲۴۰ دقیقه باشد." };
  }

  if (totalQuestions < 1 || totalQuestions > 50) {
    return { error: "تعداد کل سوال باید بین ۱ تا ۵۰ باشد." };
  }

  const matrixSum = matrixTotal(matrix);
  if (matrixSum !== totalQuestions) {
    return { error: "جمع ماتریس سختی باید دقیقاً با تعداد کل سوال برابر باشد." };
  }

  const localDate = new Date(startRaw);
  if (Number.isNaN(localDate.getTime())) {
    return { error: "زمان شروع آزمون معتبر نیست." };
  }

  const classId = classValue === "all" ? null : parseIntSafe(classValue, 0);
  if (classValue !== "all" && !classId) {
    return { error: "کلاس را انتخاب کنید یا گزینه همه کلاس‌ها را بزنید." };
  }

  return {
    payload: {
      title,
      subject,
      grade_id: gradeId,
      class_id: classId,
      start_time: localDate.toISOString(),
      duration,
      focus_area: focusArea,
      total_questions: totalQuestions,
      difficulty_matrix: matrix,
    },
  };
}

function clearFormAfterCreate() {
  els.title.value = "";
  els.subject.value = "";
  els.focusArea.value = "";
  setDefaultStartTime();
}

async function handleDeleteExam(examId) {
  const confirmed = confirm("آیا از حذف این آزمون مطمئن هستید؟");
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/school-exams/${examId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "حذف آزمون با خطا مواجه شد.");
    }

    showToast(data.message || "آزمون با موفقیت حذف شد ✅");
    await loadSchoolExams();
  } catch (errorObj) {
    showToast(errorObj.message || "خطا در حذف آزمون", "error");
  }
}

function attachDeleteEventListeners() {
  const deleteButtons = document.querySelectorAll(".btn-delete-exam");
  for (const button of deleteButtons) {
    button.addEventListener("click", () => {
      const examId = button.getAttribute("data-exam-id");
      if (examId) {
        handleDeleteExam(examId);
      }
    });
  }
}

async function handleCreateExam() {
  if (state.creating) {
    return;
  }

  hideMessages();
  const { payload, error } = validateForm();
  if (error) {
    showError(error);
    return;
  }

  setCreating(true);

  try {
    const response = await fetch("/api/school-exams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "ایجاد آزمون با خطا مواجه شد.");
    }

    showSuccess(`آزمون «${data.exam?.title || payload.title}» با شناسه ${data.exam?.id || "-"} ثبت شد.`);
    showToast("آزمون مدرسه با موفقیت ایجاد شد ✅");
    clearFormAfterCreate();
    updateDifficultySummary();
    await loadSchoolExams();
  } catch (errorObj) {
    showError(errorObj.message || "خطا در ایجاد آزمون مدرسه.");
    showToast(errorObj.message || "خطا در ایجاد آزمون", "error");
  } finally {
    setCreating(false);
  }
}

function attachEvents() {
  const difficultyInputs = [els.diffEasy, els.diffMedium, els.diffHard, els.diffGifted, els.totalQuestions];
  for (const input of difficultyInputs) {
    input.addEventListener("input", updateDifficultySummary);
  }

  els.grade.addEventListener("change", () => {
    populateClassOptions(els.classSelect, els.grade.value, true);
  });

  els.filterGrade.addEventListener("change", () => {
    renderFilterClassOptions(els.filterGrade.value);
    loadSchoolExams().catch((error) => {
      showToast(error.message || "خطا در بارگذاری آزمون‌ها", "error");
    });
  });

  els.filterClass.addEventListener("change", () => {
    loadSchoolExams().catch((error) => {
      showToast(error.message || "خطا در بارگذاری آزمون‌ها", "error");
    });
  });

  els.reloadExamsButton.addEventListener("click", () => {
    loadSchoolExams().catch((error) => {
      showToast(error.message || "خطا در بارگذاری آزمون‌ها", "error");
    });
  });

  els.generateButton.addEventListener("click", () => {
    handleCreateExam();
  });
}

async function init() {
  try {
    hideMessages();
    setDefaultStartTime();
    attachEvents();
    await loadMetaData();
    updateDifficultySummary();
    await loadSchoolExams();
  } catch (error) {
    showError(error.message || "راه‌اندازی صفحه با خطا مواجه شد.");
    showToast(error.message || "خطا در بارگذاری اطلاعات اولیه", "error");
  }
}

init();
