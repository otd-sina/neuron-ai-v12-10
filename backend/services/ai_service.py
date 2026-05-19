import json
import logging
import re
import time
from typing import Any

OPENAI_API_KEY = "sk-q5TOTikGYWPtdhD7btsuVOZnV1SgmchFtHGWh3o9dO1yTrOt"
OPENAI_MODEL = "gpt-4o"
MAX_RETRIES = 3
RETRY_DELAYS_SECONDS = (1, 2, 4)

_logger = logging.getLogger("neuron.ai_service")
_openai_client = None


def _normalize_grade_label(grade: Any) -> str:
    if grade is None:
        return "نامشخص"

    if isinstance(grade, int):
        return f"پایه {grade}"

    grade_text = str(grade).strip()
    return grade_text or "نامشخص"


def _performance_level_text(past_performance: dict | None) -> str:
    if not isinstance(past_performance, dict):
        return "اطلاعات عملکرد قبلی در دسترس نیست."

    avg_score = past_performance.get("avg_score")
    if isinstance(avg_score, (int, float)):
        if avg_score >= 85:
            return "دانش‌آموز عملکرد قوی دارد؛ سطح پاسخ‌ها را چالشی‌تر و عمیق‌تر نگه دار."
        if avg_score >= 70:
            return "دانش‌آموز عملکرد متوسط دارد؛ تعادل بین سادگی و عمق را رعایت کن."
        return "دانش‌آموز به پشتیبانی بیشتر نیاز دارد؛ توضیح را ساده، گام‌به‌گام و دلگرم‌کننده ارائه کن."

    return "امتیاز میانگین مشخص نیست؛ پاسخ متعادل و آموزشی ارائه کن."


def generate_system_prompt(
    grade: Any,
    subject: str,
    bot_type: str,
    past_performance: dict | None = None,
) -> str:
    grade_label = _normalize_grade_label(grade)
    subject_label = (subject or "درس انتخاب‌شده").strip()
    performance_text = _performance_level_text(past_performance)

    base_prompt = f"""
تو یک دستیار آموزشی حرفه‌ای برای دانش‌آموزان ایرانی هستی.
همیشه و فقط به زبان فارسی روان پاسخ بده.
سطح پاسخ باید متناسب با {grade_label} باشد.
موضوع اصلی گفت‌وگو: {subject_label}.
لحن تو باید مهربان، تشویق‌کننده، دقیق و آموزشی باشد.
از مثال‌های قابل‌فهم برای دانش‌آموز ایرانی استفاده کن.
اگر پرسش نامرتبط با درس بود، کاربر را مودبانه به موضوع درسی برگردان.
{performance_text}
""".strip()

    if bot_type == "exam_generator":
        return (
            base_prompt
            + "\n\n"
            + """

نقش ویژه تو: آزمون‌ساز هوشمند.
- باید سوال‌های چهارگزینه‌ای استاندارد بسازی.
- هر سوال دقیقاً ۴ گزینه با کلیدهای A, B, C, D داشته باشد.
- فقط یک گزینه صحیح باشد.
- خروجی باید معتبر، شفاف و بدون ابهام باشد.
- سطح سختی و تعداد سوال را دقیقاً رعایت کن.
- خروجی نهایی را فقط در قالب JSON ارائه کن.
""".strip()
        )

    if bot_type == "homework_helper":
        return (
            base_prompt
            + "\n\n"
            + """

نقش ویژه تو: مربی تکلیف.
- پاسخ مستقیم نهایی نده.
- راهنمایی مرحله‌به‌مرحله، نکته و سوال هدایت‌گر ارائه کن.
- اگر دانش‌آموز درخواست جواب قطعی کرد، مودبانه رد کن و مسیر حل را توضیح بده.
""".strip()
        )

    return (
        base_prompt
        + "\n\n"
        + """

نقش ویژه تو: معلم هوشمند عمومی.
- پاسخ‌ها را شفاف و مرحله‌به‌مرحله توضیح بده.
- تا حد امکان از مثال کوتاه و کاربردی استفاده کن.
""".strip()
    )


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("کتابخانه openai نصب نیست.") from exc
        _openai_client = OpenAI(
            base_url="https://api.gapgpt.app/v1",
            api_key=OPENAI_API_KEY,
        )
    return _openai_client


def _extract_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    text_parts.append(text_value)
        return "\n".join(part for part in text_parts if part).strip()

    return ""


def _error_code_from_exception(error_text: str) -> str:
    lowered = error_text.lower()
    if "rate limit" in lowered or "429" in lowered:
        return "rate_limited"
    if "timeout" in lowered:
        return "timeout"
    if "authentication" in lowered or "api key" in lowered or "401" in lowered:
        return "auth_error"
    return "api_error"


def call_openai_api(
    system_prompt: str,
    user_message: str,
    temperature: float = 0.35,
    max_tokens: int = 1200,
) -> dict:
    client = None
    try:
        client = _get_openai_client()
    except Exception as exc:
        error_text = str(exc)
        _logger.exception("OpenAI client initialization failed: %s", error_text)
        return {
            "success": False,
            "error_code": "client_init_failed",
            "error": "اتصال به سرویس هوش مصنوعی در حال حاضر در دسترس نیست.",
        }

    last_error = "خطای نامشخص"

    for attempt in range(MAX_RETRIES):
        try:
            completion = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )

            if not completion.choices:
                return {
                    "success": False,
                    "error_code": "empty_response",
                    "error": "پاسخ معتبری از سرویس هوش مصنوعی دریافت نشد.",
                }

            message = completion.choices[0].message
            content = _extract_message_content(message.content)
            if not content:
                return {
                    "success": False,
                    "error_code": "empty_content",
                    "error": "پاسخ متنی معتبری از سرویس هوش مصنوعی دریافت نشد.",
                }

            usage = getattr(completion, "usage", None)
            prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
            completion_tokens = getattr(usage, "completion_tokens", None) if usage else None
            total_tokens = getattr(usage, "total_tokens", None) if usage else None
            _logger.info(
                "OpenAI usage model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                OPENAI_MODEL,
                prompt_tokens,
                completion_tokens,
                total_tokens,
            )

            return {
                "success": True,
                "model": OPENAI_MODEL,
                "content": content,
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                },
            }
        except Exception as exc:
            last_error = str(exc)
            error_code = _error_code_from_exception(last_error)
            _logger.warning(
                "OpenAI API call failed (attempt=%s/%s, code=%s): %s",
                attempt + 1,
                MAX_RETRIES,
                error_code,
                last_error,
            )
            should_retry = error_code in {"timeout", "rate_limited", "api_error"} and attempt < MAX_RETRIES - 1
            if should_retry:
                time.sleep(RETRY_DELAYS_SECONDS[min(attempt, len(RETRY_DELAYS_SECONDS) - 1)])
                continue
            return {
                "success": False,
                "error_code": error_code,
                "error": "در حال حاضر امکان دریافت پاسخ از سرویس هوش مصنوعی وجود ندارد.",
            }

    return {
        "success": False,
        "error_code": _error_code_from_exception(last_error),
        "error": "در حال حاضر امکان دریافت پاسخ از سرویس هوش مصنوعی وجود ندارد.",
    }


def extract_json_payload(raw_text: str) -> dict | list | None:
    text = (raw_text or "").strip()
    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fenced_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*```", text)
    if fenced_match:
        candidate = fenced_match.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None

    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidate = text[first_brace : last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None

    return None
