(function () {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  const chatWidget = document.getElementById("chatWidget");
  const chatLauncher = document.getElementById("chatLauncher");
  const chatPanel = document.getElementById("chatPanel");
  const chatCloseBtn = document.getElementById("chatCloseBtn");
  const chatResetBtn = document.getElementById("chatResetBtn");
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const suggestionButtons = document.querySelectorAll(".suggestion-chip");
  const openChatTriggers = document.querySelectorAll("[data-open-chat]");

  const WELCOME_TEXT =
    "Hi! I'm Hanzade's AI assistant. Ask me anything about her education at Boğaziçi University, coursework, projects, or technical skills.";

  let history = [];
  let isSending = false;

  function setChatOpen(open) {
    chatWidget.classList.toggle("is-open", open);
    chatLauncher.setAttribute("aria-expanded", String(open));
    chatPanel.setAttribute("aria-hidden", String(!open));
    if (open) {
      setTimeout(() => chatInput.focus(), 50);
    }
  }

  function renderFormattedText(container, text) {
    const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }

      const token = match[0];
      if (token.startsWith("**") && token.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        container.appendChild(strong);
      } else if (token.startsWith("`") && token.endsWith("`")) {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        container.appendChild(code);
      }
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function appendMessage(role, text, isError = false) {
    const bubble = document.createElement("div");
    bubble.className = `msg ${
      isError ? "msg-error" : role === "user" ? "msg-user" : "msg-bot"
    }`;
    if (role === "user" || isError) {
      bubble.textContent = text;
    } else {
      renderFormattedText(bubble, text);
    }
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  function appendTypingIndicator() {
    const bubble = document.createElement("div");
    bubble.className = "msg msg-bot";
    bubble.setAttribute("aria-label", "Assistant is typing");

    const dots = document.createElement("span");
    dots.className = "typing-dots";
    for (let i = 0; i < 3; i += 1) {
      dots.appendChild(document.createElement("span"));
    }

    bubble.appendChild(dots);
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  function resetConversation() {
    history = [];
    chatMessages.innerHTML = "";
    appendMessage("model", WELCOME_TEXT);
  }

  async function sendMessage(rawText) {
    const message = rawText.trim();
    if (!message || isSending) return;

    isSending = true;
    chatSendBtn.disabled = true;
    chatInput.value = "";

    appendMessage("user", message);
    const typingBubble = appendTypingIndicator();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });

      const data = await res.json().catch(() => ({}));
      typingBubble.remove();

      if (!res.ok || !data.reply) {
        appendMessage(
          "model",
          data.error || "Sorry, something went wrong. Please try again.",
          true
        );
      } else {
        appendMessage("model", data.reply);
        history.push({ role: "user", text: message });
        history.push({ role: "model", text: data.reply });
        if (history.length > 10) {
          history = history.slice(-10);
        }
      }
    } catch (_err) {
      typingBubble.remove();
      appendMessage(
        "model",
        "Network error while contacting the server. Please try again.",
        true
      );
    } finally {
      isSending = false;
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  chatLauncher.addEventListener("click", () => setChatOpen(true));
  chatCloseBtn.addEventListener("click", () => setChatOpen(false));
  chatResetBtn.addEventListener("click", resetConversation);

  openChatTriggers.forEach((btn) => {
    btn.addEventListener("click", () => {
      setChatOpen(true);
      const prefill = btn.getAttribute("data-prefill");
      if (prefill) {
        sendMessage(prefill);
      }
    });
  });

  suggestionButtons.forEach((chip) => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-question");
      if (q) {
        sendMessage(q);
      }
    });
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(chatInput.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && chatWidget.classList.contains("is-open")) {
      setChatOpen(false);
    }
  });

  resetConversation();
})();
