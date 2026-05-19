const loginForm = document.getElementById("student-login-form");
const nationalIdInput = document.getElementById("national-id");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const loginButtonText = document.getElementById("login-button-text");
const loginSpinner = document.getElementById("login-spinner");
const errorBox = document.getElementById("auth-error");
const forgotPasswordButton = document.getElementById("forgot-password");

const TOKEN_KEY = "student_token";
const STUDENT_KEY = "student_profile";
const NATIONAL_ID_REGEX = /^\d{10}$/;

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButtonText.textContent = isLoading ? "در حال ورود..." : "ورود";
  loginSpinner.classList.toggle("hidden", !isLoading);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function validateForm() {
  const nationalId = nationalIdInput.value.trim();
  const password = passwordInput.value;

  if (!NATIONAL_ID_REGEX.test(nationalId)) {
    return "کد ملی باید دقیقاً ۱۰ رقم باشد.";
  }

  if (password.length < 6) {
    return "رمز عبور باید حداقل ۶ کاراکتر باشد.";
  }

  return null;
}

function saveSession(data) {
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(STUDENT_KEY, JSON.stringify(data.student || {}));
}

async function redirectIfAuthenticated() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    return;
  }

  try {
    const res = await fetch("/api/student/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      window.location.replace("/student/dashboard");
      return;
    }

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STUDENT_KEY);
  } catch {
    // Keep user on login page in network errors.
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const validationError = validateForm();
  if (validationError) {
    showError(validationError);
    return;
  }

  setLoading(true);

  try {
    const res = await fetch("/api/student/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        national_id: nationalIdInput.value.trim(),
        password: passwordInput.value,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.token) {
      showError(data.message || "ورود انجام نشد. لطفاً دوباره تلاش کن.");
      return;
    }

    saveSession(data);
    window.location.href = "/student/dashboard";
  } catch {
    showError("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کن.");
  } finally {
    setLoading(false);
  }
});

forgotPasswordButton.addEventListener("click", () => {
  showError("برای بازیابی رمز عبور با مدیر مدرسه تماس بگیر.");
});

redirectIfAuthenticated();
