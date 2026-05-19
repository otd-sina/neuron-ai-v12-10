const TOKEN_KEY = "student_token";
const STUDENT_KEY = "student_profile";

const profileCardEl = document.getElementById("profile-card");
const profileAlertEl = document.getElementById("profile-alert");
const profileTitleEl = document.getElementById("profile-title");
const logoutButton = document.getElementById("profile-logout-button");

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STUDENT_KEY);
}

function showAlert(message) {
  profileAlertEl.textContent = message;
  profileAlertEl.classList.remove("hidden");
}

function hideAlert() {
  profileAlertEl.textContent = "";
  profileAlertEl.classList.add("hidden");
}

function readStudentFromLocal() {
  try {
    const raw = localStorage.getItem(STUDENT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatJalali(dateValue) {
  if (!dateValue) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateValue));
  } catch {
    return "—";
  }
}

function renderProfile(student) {
  const name = student.name || student.full_name || "دانش‌آموز";
  profileTitleEl.textContent = `پروفایل ${name}`;
  profileCardEl.innerHTML = `
    <div class="profile-row"><span>نام و نام خانوادگی</span><strong>${name}</strong></div>
    <div class="profile-row"><span>کد ملی</span><strong>${student.national_id || "—"}</strong></div>
    <div class="profile-row"><span>شماره تماس</span><strong>${student.phone || "—"}</strong></div>
    <div class="profile-row"><span>پایه تحصیلی</span><strong>${student.grade_name || student.grade_id || "—"}</strong></div>
    <div class="profile-row"><span>کلاس</span><strong>${student.class_name || student.class_id || "—"}</strong></div>
    <div class="profile-row"><span>مدرسه</span><strong>${student.school_name || "ثبت نشده"}</strong></div>
    <div class="profile-row"><span>تاریخ عضویت</span><strong>${formatJalali(student.created_at)}</strong></div>
  `;
}

async function loadProfile() {
  const token = getToken();
  if (!token) {
    window.location.replace("/student/login");
    return;
  }

  hideAlert();

  try {
    const res = await fetch("/api/student/me", {
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

    if (!res.ok || !data.student) {
      const fallback = readStudentFromLocal();
      if (fallback) {
        renderProfile(fallback);
      }
      showAlert(data.message || "نمایش اطلاعات پروفایل با خطا مواجه شد.");
      return;
    }

    localStorage.setItem(STUDENT_KEY, JSON.stringify(data.student));
    renderProfile(data.student);
  } catch {
    const fallback = readStudentFromLocal();
    if (fallback) {
      renderProfile(fallback);
      showAlert("ارتباط با سرور برقرار نشد. اطلاعات ذخیره‌شده نمایش داده شد.");
      return;
    }
    showAlert("اتصال به سرور برقرار نشد و داده‌ای برای نمایش وجود ندارد.");
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

loadProfile();
