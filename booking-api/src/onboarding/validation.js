function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateOnboardingValue(inputKey, inputType, value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return {
      valid: false,
      value: "",
      message: "This field is required."
    };
  }
  if (inputType === "URL" && !isValidHttpUrl(text)) {
    return {
      valid: false,
      value: text,
      message: "Enter a valid http:// or https:// URL."
    };
  }
  if (inputKey === "contact_email") {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(text)) {
      return {
        valid: false,
        value: text,
        message: "Enter a valid email address."
      };
    }
  }
  return {
    valid: true,
    value: text,
    message: null
  };
}

export {
  isValidHttpUrl,
  validateOnboardingValue
};
