let sessionId = null;
let typingEl = null;

const WIDGET_CONFIG = window.OBE_CHATBOT_CONFIG || {};
const API_BASE = (
  typeof WIDGET_CONFIG.apiBase === "string" && WIDGET_CONFIG.apiBase.trim()
    ? WIDGET_CONFIG.apiBase
    : window.location.origin
).replace(/\/+$/, "");
const API_ROOT = `${API_BASE}/api`;
const CHAT_USER_ID = (
  typeof WIDGET_CONFIG.userId === "string" && WIDGET_CONFIG.userId.trim()
    ? WIDGET_CONFIG.userId.trim()
    : "web_user"
);
const URL_REGEX = /(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/gi;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONSULTANT_TYPES = [
  "Architectural Design",
  "Interior Design",
  "Landscape",
  "Fit-out / Execution",
  "Engineering / Technical",
  "Other",
];
const PROJECTS_BASE_LINK = "https://obearchitects.com/obe/projectlists.php?category=";
const PROJECT_THUMB_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='220' viewBox='0 0 320 220'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%230f6fb5'/%3E%3Cstop offset='100%25' stop-color='%231a8ca3'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='220' fill='url(%23g)'/%3E%3Ccircle cx='260' cy='50' r='40' fill='rgba(255,255,255,0.18)'/%3E%3Ccircle cx='60' cy='180' r='56' fill='rgba(255,255,255,0.12)'/%3E%3C/svg%3E";
const THUMBS_BASE_PATH = `${API_ROOT}/static/chatbot/thumbs`;

function getCurrentScriptSrc() {
  if (document.currentScript && document.currentScript.src) {
    return document.currentScript.src;
  }

  const scriptTags = document.querySelectorAll("script[src]");
  const lastScript = scriptTags[scriptTags.length - 1];
  return lastScript && lastScript.src ? lastScript.src : `${window.location.origin}/widget.js`;
}

function ensureWidgetStyles() {
  if (document.querySelector('link[data-obe-widget="true"]')) {
    return;
  }

  const cssHref = (
    typeof WIDGET_CONFIG.cssUrl === "string" && WIDGET_CONFIG.cssUrl.trim()
      ? WIDGET_CONFIG.cssUrl
      : new URL("./widget.css", getCurrentScriptSrc()).toString()
  );

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssHref;
  link.dataset.obeWidget = "true";
  document.head.appendChild(link);
}

function ensureWidgetMarkup() {
  if (document.getElementById("launcher") && document.getElementById("panel")) {
    return;
  }

  const container = document.createElement("div");
  container.dataset.obeWidgetRoot = "true";
  container.innerHTML = `
    <button id="launcher" aria-label="Open chat" aria-expanded="false">Chat with OBE</button>
    <div id="panel" aria-hidden="true">
      <div id="panelHeader">
        <div class="brandDot"></div>
        <div>
          <div class="title">OBE Architects</div>
          <div class="subtitle">Design support assistant</div>
        </div>
      </div>
      <div id="chatBody">
        <div id="messages" aria-live="polite"></div>
        <div id="buttons"></div>
        <div id="leadFormHost"></div>
        <div id="form"></div>
      </div>
    </div>
  `;
  document.body.appendChild(container);
}

ensureWidgetStyles();
ensureWidgetMarkup();
const projectCategories = [
  // Add future categories by appending { id, title, imageKey?, link }.
  // Thumbnail files should be placed at `${THUMBS_BASE_PATH}/${imageKey || id}.jpg` (or .webp fallback).
  { id: "villas", title: "Villas", link: `${PROJECTS_BASE_LINK}villas` },
  { id: "commercial", title: "Commercial", link: `${PROJECTS_BASE_LINK}commercial` },
  { id: "education", title: "Education", link: `${PROJECTS_BASE_LINK}education` },
  { id: "sports", title: "Sports", link: `${PROJECTS_BASE_LINK}sports` },
  { id: "public_cultural", title: "Public & Cultural", imageKey: "public-and-clutural", link: `${PROJECTS_BASE_LINK}publicncultural` },
  { id: "mosques", title: "Mosques", link: `${PROJECTS_BASE_LINK}mosques` },
];

const panel = document.getElementById("panel");
const chatBody = document.getElementById("chatBody");
const launcher = document.getElementById("launcher");
const messagesEl = document.getElementById("messages");
const buttonsEl = document.getElementById("buttons");
const leadFormHostEl = document.getElementById("leadFormHost");
const formEl = document.getElementById("form");
const WHATSAPP_NUMBER = "201016662324";

const leadFormState = {
  values: {
    name: "",
    phone: "",
    email: "",
    consultant_type: "",
  },
  errors: {},
  submitError: "",
  isSubmitting: false,
  submitted: false,
  submittedLead: null,
};

launcher.onclick = async () => {
  const isOpen = panel.classList.toggle("is-open");
  panel.setAttribute("aria-hidden", String(!isOpen));
  launcher.setAttribute("aria-expanded", String(isOpen));

  if (isOpen && !sessionId) {
    await send({ text: null, button_id: null });
  }
};

function scrollToLatest() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function deriveLinkLabel(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();

    if (path.includes("project")) return "View Projects";
    if (path.includes("service")) return "View Services";
    if (path.includes("contact")) return "Contact Us";
    if (path.includes("about")) return "Learn About Us";

    const domain = parsed.hostname.replace(/^www\./i, "");
    return `Open ${domain}`;
  } catch {
    return "Open Link";
  }
}

function buildStructuredMessage(text) {
  if (!text) {
    return { text: "", buttons: [] };
  }

  const urls = [...text.matchAll(URL_REGEX)].map(match => match[0]);
  const uniqueUrls = [...new Set(urls)];
  const buttons = uniqueUrls.map(url => ({ label: deriveLinkLabel(url), url }));
  const normalizedText = text.replace(URL_REGEX, "").replace(/\s{2,}/g, " ").trim();

  return { text: normalizedText, buttons };
}

function normalizePhone(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[()\-.\s]/g, "");
  const withPlus = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (withPlus.includes("+") && !withPlus.startsWith("+")) return null;

  const digits = withPlus.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  return `+${digits}`;
}

function validateLeadValues(values) {
  const errors = {};
  const cleanName = values.name.trim();
  const cleanEmail = values.email.trim();
  const normalizedPhone = normalizePhone(values.phone);

  if (cleanName.length < 2) {
    errors.name = "Please enter your full name (at least 2 characters).";
  }

  if (!normalizedPhone) {
    errors.phone = "Please enter a valid international phone number (e.g., +971...).";
  }

  if (!EMAIL_REGEX.test(cleanEmail)) {
    errors.email = "Please enter a valid email address.";
  }

  return { errors, normalizedPhone, cleanName, cleanEmail };
}

function buildWhatsAppPrefillText(lead = null) {
  const lines = [
    "Hi, I just submitted the consultation form and want to contact you immediately.",
  ];

  if (lead && lead.name) lines.push(`Name: ${lead.name}`);
  if (lead && lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead && lead.email) lines.push(`Email: ${lead.email}`);

  return lines.join("\n");
}

function openWhatsApp(lead = null) {
  const text = buildWhatsAppPrefillText(lead);
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function trackCategoryClick(category, url, currentSessionId, currentUserId) {
  const payload = {
    event_name: "project_category_click",
    category,
    department: category,
    url,
    session_id: currentSessionId || null,
    user_id: currentUserId || null,
    source: "chatbot",
  };

  const endpoint = `${API_ROOT}/analytics/event`;

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
  } catch (_err) {
    // Fire-and-forget: avoid blocking link opening.
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget: ignore network errors.
  });
}

function createButtonComponent({ label, variant = "default", href = null, onClick = null }) {
  const el = href ? document.createElement("a") : document.createElement("button");
  el.className = `btn ${variant === "primary" ? "btnPrimary" : ""} ${href ? "btnLink" : ""}`.trim();
  el.textContent = label;

  if (href) {
    el.href = href;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    if (onClick) {
      el.addEventListener("click", onClick);
    }
  } else {
    el.type = "button";
    el.onclick = onClick;
  }

  return el;
}

function createMessageComponent({ role = "bot", text = "", buttons = [] }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;

  if (text) {
    const textEl = document.createElement("div");
    textEl.className = "msgText";
    textEl.textContent = text;
    wrapper.appendChild(textEl);
  }

  if (buttons.length > 0) {
    const actions = document.createElement("div");
    actions.className = "msgActions";

    buttons.forEach(button => {
      actions.appendChild(createButtonComponent({ label: button.label, href: button.url, variant: "primary" }));
    });

    wrapper.appendChild(actions);
  }

  return wrapper;
}

function createDropdownComponent({ name, value, options, onChange, hasError }) {
  const select = document.createElement("select");
  select.name = name;
  if (hasError) {
    select.classList.add("leadInputError");
  }

  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = "Select consultant type (optional)";
  select.appendChild(firstOption);

  options.forEach(optionText => {
    const option = document.createElement("option");
    option.value = optionText;
    option.textContent = optionText;
    if (value === optionText) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.addEventListener("change", event => onChange(event.target.value));
  return select;
}

function createLeadFormFieldComponent({ label, input, errorText }) {
  const field = document.createElement("div");
  field.className = "leadField";

  const labelEl = document.createElement("label");
  labelEl.className = "leadLabel";
  labelEl.textContent = label;

  field.appendChild(labelEl);
  field.appendChild(input);

  if (errorText) {
    const error = document.createElement("div");
    error.className = "leadError";
    error.textContent = errorText;
    field.appendChild(error);
  }

  return field;
}

function createProjectCategoryCardComponent({ title, imageUrl, link }) {
  const card = document.createElement("article");
  card.className = "projectCard";

  const thumbFrame = document.createElement("div");
  thumbFrame.className = "projectThumbFrame";

  const thumb = document.createElement("img");
  thumb.className = "projectThumb";
  thumb.src = imageUrl || PROJECT_THUMB_PLACEHOLDER;
  thumb.alt = `${title} projects thumbnail`;
  thumb.loading = "lazy";
  thumb.decoding = "async";

  const body = document.createElement("div");
  body.className = "projectBody";

  const titleEl = document.createElement("div");
  titleEl.className = "projectTitle";
  titleEl.textContent = title;

  const cta = createButtonComponent({
    label: `View ${title} Projects`,
    href: link,
    variant: "primary",
    onClick: () => trackCategoryClick(title, link, sessionId, CHAT_USER_ID),
  });
  cta.classList.add("projectCta");

  body.appendChild(titleEl);
  body.appendChild(cta);
  thumbFrame.appendChild(thumb);
  card.appendChild(thumbFrame);
  card.appendChild(body);
  return card;
}

function getCategoryImageSources(categoryKey) {
  return [
    `${THUMBS_BASE_PATH}/${categoryKey}.jpg`,
    `${THUMBS_BASE_PATH}/${categoryKey}.webp`,
  ];
}

function attachThumbWithFallback(thumb, thumbFrame, categoryKey) {
  const sources = getCategoryImageSources(categoryKey);
  let index = 0;

  const loadCurrent = () => {
    thumb.src = sources[index];
  };

  thumb.onerror = () => {
    index += 1;
    if (index < sources.length) {
      loadCurrent();
      return;
    }

    thumbFrame.classList.add("projectThumbFallback");
    thumb.remove();
  };

  loadCurrent();
}

function isProjectCategoryButton(button) {
  return projectCategories.some(category => category.id === button.id);
}

function renderProjectCategoryCards(buttons) {
  const wrapper = document.createElement("div");
  wrapper.className = "projectCards";

  buttons.forEach(button => {
    const category = projectCategories.find(item => item.id === button.id);
    if (!category) return;

    wrapper.appendChild(
      createProjectCategoryCardComponent({
        title: category.title || button.label,
        imageUrl: null,
        link: category.link || PROJECTS_BASE_LINK,
      }),
    );

    const latestCard = wrapper.lastElementChild;
    if (!latestCard) return;
    const thumbFrame = latestCard.querySelector(".projectThumbFrame");
    const thumb = latestCard.querySelector(".projectThumb");
    if (!thumbFrame || !thumb) return;
    const categoryKey = category.imageKey || category.id;
    attachThumbWithFallback(thumb, thumbFrame, categoryKey);
  });

  const consultCta = createButtonComponent({
    label: "Request a consultation",
    variant: "primary",
    onClick: () => {
      showConsultationForm();
    },
  });
  consultCta.classList.add("projectMenuConsultCta");
  consultCta.setAttribute("aria-label", "Request a consultation");
  wrapper.appendChild(consultCta);

  buttonsEl.appendChild(wrapper);
}

function createLeadPostSubmitComponent() {
  const card = document.createElement("div");
  card.className = "leadForm leadSubmitCard";
  card.id = "consultation";

  const title = document.createElement("div");
  title.className = "leadFormTitle";
  title.textContent = "Submitted ✅";
  card.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "leadSubmitSubtitle";
  subtitle.textContent = "Want to contact immediately?";
  card.appendChild(subtitle);

  const action = createButtonComponent({
    label: "Open WhatsApp",
    variant: "primary",
    onClick: () => openWhatsApp(leadFormState.submittedLead),
  });
  action.classList.add("leadSubmitWhatsAppCta");
  action.setAttribute("aria-label", "Open WhatsApp chat");
  card.appendChild(action);

  return card;
}

function createLeadFormComponent() {
  if (leadFormState.submitted) {
    return createLeadPostSubmitComponent();
  }

  const card = document.createElement("div");
  card.className = "leadForm";
  card.id = "consultation";

  const title = document.createElement("div");
  title.className = "leadFormTitle";
  title.textContent = "Request a consultant";
  card.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "leadGrid";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Full name";
  nameInput.value = leadFormState.values.name;
  if (leadFormState.errors.name) {
    nameInput.classList.add("leadInputError");
  }
  nameInput.addEventListener("input", event => {
    leadFormState.values.name = event.target.value;
    delete leadFormState.errors.name;
  });

  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.placeholder = "+971...";
  phoneInput.value = leadFormState.values.phone;
  if (leadFormState.errors.phone) {
    phoneInput.classList.add("leadInputError");
  }
  phoneInput.addEventListener("input", event => {
    leadFormState.values.phone = event.target.value;
    delete leadFormState.errors.phone;
  });

  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.placeholder = "name@example.com";
  emailInput.value = leadFormState.values.email;
  if (leadFormState.errors.email) {
    emailInput.classList.add("leadInputError");
  }
  emailInput.addEventListener("input", event => {
    leadFormState.values.email = event.target.value;
    delete leadFormState.errors.email;
  });

  const consultantDropdown = createDropdownComponent({
    name: "consultant_type",
    value: leadFormState.values.consultant_type,
    options: CONSULTANT_TYPES,
    hasError: false,
    onChange: value => {
      leadFormState.values.consultant_type = value;
    },
  });

  grid.appendChild(createLeadFormFieldComponent({ label: "Full name *", input: nameInput, errorText: leadFormState.errors.name }));
  grid.appendChild(createLeadFormFieldComponent({ label: "Phone / WhatsApp *", input: phoneInput, errorText: leadFormState.errors.phone }));
  grid.appendChild(createLeadFormFieldComponent({ label: "Email *", input: emailInput, errorText: leadFormState.errors.email }));
  grid.appendChild(createLeadFormFieldComponent({ label: "Consultant type", input: consultantDropdown, errorText: "" }));

  card.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "leadActions";

  const cancelBtn = createButtonComponent({
    label: "Cancel",
    onClick: () => {
      leadFormState.submitted = false;
      leadFormState.submittedLead = null;
      leadFormHostEl.innerHTML = "";
      const buttons = buttonsEl.querySelectorAll("button");
      buttons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove("is-loading");
      });
    },
  });

  const submitBtn = createButtonComponent({ label: "Submit", variant: "primary" });
  submitBtn.disabled = leadFormState.isSubmitting;
  if (leadFormState.isSubmitting) {
    submitBtn.classList.add("is-loading");
  }

  submitBtn.onclick = async () => {
    leadFormState.submitError = "";
    const validation = validateLeadValues(leadFormState.values);
    leadFormState.errors = validation.errors;

    if (Object.keys(leadFormState.errors).length > 0) {
      renderLeadForm();
      return;
    }

    leadFormState.isSubmitting = true;
    renderLeadForm();

    try {
      const res = await fetch(`${API_ROOT}/consultation/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: validation.cleanName,
          phone: validation.normalizedPhone,
          email: validation.cleanEmail,
          consultant_type: leadFormState.values.consultant_type || null,
          source: "chatbot",
          session_id: sessionId,
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || (body && body.ok === false)) {
        throw new Error(`Lead API returned ${res.status}`);
      }

      addMessage("Thanks! Our team will contact you soon.", "bot");
      leadFormState.submittedLead = {
        name: validation.cleanName,
        phone: validation.normalizedPhone,
        email: validation.cleanEmail,
      };
      leadFormState.values = { name: "", phone: "", email: "", consultant_type: "" };
      leadFormState.errors = {};
      leadFormState.submitError = "";
      leadFormState.isSubmitting = false;
      leadFormState.submitted = true;
      renderLeadForm();
    } catch (_err) {
      leadFormState.submitted = false;
      leadFormState.isSubmitting = false;
      leadFormState.submitError = "Could not submit now. Please try again in a moment.";
      renderLeadForm();
    }
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  card.appendChild(actions);

  if (leadFormState.submitError) {
    const status = document.createElement("div");
    status.className = "leadStatus";
    status.textContent = leadFormState.submitError;
    card.appendChild(status);
  }

  return card;
}

function showConsultationForm() {
  leadFormState.submitted = false;
  leadFormState.submittedLead = null;
  renderLeadForm();
}

function renderLeadForm() {
  leadFormHostEl.innerHTML = "";
  leadFormHostEl.appendChild(createLeadFormComponent());
  const consultationEl = document.getElementById("consultation");
  if (consultationEl && typeof consultationEl.scrollIntoView === "function") {
    consultationEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  scrollToLatest();
}

function addMessage(text, role = "bot") {
  const structured = role === "bot" ? buildStructuredMessage(text) : { text, buttons: [] };
  messagesEl.appendChild(createMessageComponent({ role, text: structured.text, buttons: structured.buttons }));
  scrollToLatest();
}

function showTypingIndicator() {
  if (typingEl) return;

  typingEl = document.createElement("div");
  typingEl.className = "msg typing";
  typingEl.innerHTML = 'Typing<div class="typingDots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(typingEl);
  scrollToLatest();
}

function hideTypingIndicator() {
  if (!typingEl) return;
  typingEl.remove();
  typingEl = null;
}

function disableOptionButtons(clickedButton) {
  const allButtons = buttonsEl.querySelectorAll("button");
  allButtons.forEach(btn => {
    btn.disabled = true;
  });

  if (clickedButton) {
    clickedButton.classList.add("is-loading");
  }
}

async function send({ text, button_id, clientText = null, sourceButton = null }) {
  if (clientText) {
    addMessage(clientText, "user");
  }

  if (sourceButton) {
    disableOptionButtons(sourceButton);
  }

  showTypingIndicator();

  try {
    const res = await fetch(`${API_ROOT}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "web",
        user_id: CHAT_USER_ID,
        session_id: sessionId,
        text,
        button_id,
      }),
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const out = await res.json();
    sessionId = out.session_id;
    renderChatUi(out);
  } catch (err) {
    addMessage(`Connection error: ${err.message}. Check API/CORS config.`, "error");
  } finally {
    hideTypingIndicator();
  }
}

function renderOptionButtons(buttons = []) {
  buttonsEl.innerHTML = "";

  const projectButtons = buttons.filter(isProjectCategoryButton);
  const nonProjectButtons = buttons.filter(button => !isProjectCategoryButton(button));

  if (projectButtons.length > 0) {
    renderProjectCategoryCards(projectButtons);
  }

  nonProjectButtons.forEach(button => {
    const option = createButtonComponent({
      label: button.label,
      onClick: async () => {
        if (button.id === "consult") {
          addMessage(button.label, "user");
          disableOptionButtons(option);
          await new Promise(resolve => setTimeout(resolve, 300));
          option.classList.remove("is-loading");
          showConsultationForm();
          return;
        }

        leadFormHostEl.innerHTML = "";
        send({ text: null, button_id: button.id, clientText: button.label, sourceButton: option });
      },
    });

    buttonsEl.appendChild(option);
  });
}

function renderLegacyForm(out) {
  formEl.innerHTML = "";
  if (!out.form) return;

  const note = document.createElement("div");
  note.className = "formLabel";
  note.textContent = "Please use Request a Consultation to submit your details.";
  formEl.appendChild(note);
}

function renderMessages(messages = []) {
  messages.forEach(message => {
    addMessage(message.text, "bot");
  });
}

function renderChatUi(out) {
  renderMessages(out.messages || []);
  renderOptionButtons(out.buttons || []);
  renderLegacyForm(out);
  scrollToLatest();
}
